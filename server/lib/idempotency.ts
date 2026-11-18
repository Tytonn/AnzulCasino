/**
 * Idempotency keys (spec rule 5). Every chip-moving request carries a key the
 * browser made for that one intent (`crypto.randomUUID()`), in the
 * Idempotency-Key header. The first request with a key does the work. A
 * repeat returns the first result and changes nothing, even when both arrive
 * at the same moment.
 *
 *   route({
 *     method: 'POST',
 *     path: '/api/coinflip/play',
 *     auth: 'user',
 *     idempotent: true,
 *     input: PlayInput,
 *     run: (ctx) =>
 *       chipTransaction(ctx, async (tx, afterCommit) => {
 *         await debit(tx, { ... })
 *         afterCommit(() => publish(...)) // after the commit, never on a repeat
 *         return { round }
 *       }),
 *   })
 *
 * The key is claimed with the transaction's first statement, before any
 * wallet lock. A second request with the same key waits on that claim: if
 * the first commits, the second returns its stored response; if the first
 * fails, nothing happened, so the key is free and the second runs. This
 * relies on Postgres's default READ COMMITTED isolation, which every
 * transaction here uses.
 */
import { and, eq, sql } from 'drizzle-orm'

import { idempotencyKeys } from '../../db/schema/core.ts'
import type { Wire } from '../../shared/wire.ts'
import { db, type Executor, type Tx } from './db.ts'
import { ApiError } from './errors.ts'
import { toWire } from './json.ts'

/** What the browser may send as a key: a UUID fits. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/
export const IDEMPOTENCY_HEADER = 'idempotency-key'
/** Keys older than this are deleted; nobody retries a request a day later. */
const KEEP_HOURS = 24

export interface Claim {
  userId: string
  key: string
  /** The action that used the key, such as "POST /api/coinflip/play". */
  scope: string
}

export type ClaimResult = { status: 'new' } | { status: 'repeat'; response: unknown }

function keyReused(): ApiError {
  return new ApiError(
    409,
    'idempotency_key_reused',
    'That request key was already used for something else. Reload the page and try again.',
  )
}

/**
 * Claims a key for the current transaction. Call it first in the
 * transaction. Returns `repeat` with the stored response when an earlier
 * request with this key committed.
 */
export async function claimKey(tx: Tx, claim: Claim): Promise<ClaimResult> {
  const inserted = await tx
    .insert(idempotencyKeys)
    .values({ userId: claim.userId, key: claim.key, scope: claim.scope })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key })
  if (inserted.length > 0) return { status: 'new' }

  // A committed request used this key. Under READ COMMITTED this new
  // statement sees its row.
  const [existing] = await tx
    .select({ scope: idempotencyKeys.scope, response: idempotencyKeys.response })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, claim.userId), eq(idempotencyKeys.key, claim.key)))
  if (!existing || existing.scope !== claim.scope) throw keyReused()
  return { status: 'repeat', response: existing.response }
}

/** Stores the response a repeat of this key will get. Same transaction as the claim. */
export async function saveResponse(tx: Tx, claim: Claim, response: unknown): Promise<void> {
  await tx
    .update(idempotencyKeys)
    .set({ response: response ?? null })
    .where(and(eq(idempotencyKeys.userId, claim.userId), eq(idempotencyKeys.key, claim.key)))
}

/** Registers work to run once the transaction has committed, such as a live publish. */
export type AfterCommit = (task: () => Promise<unknown>) => void

/** The parts of a route's context that chipTransaction needs. */
export interface ChipRequest {
  user: { id: string } | null
  idempotencyKey: string | null
  action: string
  waitUntil(promise: Promise<unknown>): void
}

/**
 * Runs a chip-moving request once per idempotency key, in one transaction.
 * Returns the result as the browser receives it (chip amounts as numbers),
 * the same on the first run and on every repeat. Tasks passed to
 * `afterCommit` run after the commit, and only on the first run.
 */
export async function chipTransaction<T>(
  ctx: ChipRequest,
  work: (tx: Tx, afterCommit: AfterCommit) => Promise<T>,
): Promise<Wire<T>> {
  if (!ctx.user) throw new Error(`${ctx.action}: chipTransaction needs a logged-in player`)
  if (!ctx.idempotencyKey) {
    throw new Error(`${ctx.action}: chip-moving routes must be declared with idempotent: true`)
  }
  const claim: Claim = { userId: ctx.user.id, key: ctx.idempotencyKey, scope: ctx.action }
  const tasks: (() => Promise<unknown>)[] = []

  const outcome = await db().transaction(async (tx) => {
    const claimed = await claimKey(tx, claim)
    if (claimed.status === 'repeat') {
      return { repeat: true, response: claimed.response as Wire<T> }
    }
    const response = toWire(await work(tx, (task) => void tasks.push(task)))
    await saveResponse(tx, claim, response)
    return { repeat: false, response }
  })

  if (!outcome.repeat) for (const task of tasks) ctx.waitUntil(Promise.resolve().then(task))
  return outcome.response
}

/** Deletes old keys. The API calls it now and then, so no timer wakes the database. */
export async function sweepOldKeys(executor: Executor): Promise<void> {
  await executor.execute(
    sql`delete from idempotency_keys where created_at < now() - make_interval(hours => ${KEEP_HOURS})`,
  )
}
