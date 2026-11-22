/**
 * The public audit log (spec: Admin and trust > The audit page). Every admin
 * action writes a row with writeAudit() in the same transaction as the action;
 * this file turns rows into what the Audit page shows (names resolved by the
 * players' current names), lists them in pages, and gives each new row the
 * live event that puts it on every open Audit page.
 */
import { and, desc, eq, gt, inArray, like, lt, or, type SQL, sql } from 'drizzle-orm'

import { auditLog, config, seasons, users } from '../../../db/schema/core.ts'
import { configWireValue, isConfigKey, parseConfigValue } from '../../../shared/config.ts'
import {
  AUDIT_KIND_PREFIXES,
  AUDIT_PAGE_SIZE,
  type AuditEntryView,
  auditKind,
  type AuditKind,
  type AuditPage,
  type AuditPerson,
  type PendingChangeView,
} from '../../../shared/features/admin.ts'
import { nextReset } from '../../../shared/game-day.ts'
import { type AuditEntry, writeAudit } from '../../lib/audit.ts'
import { loadConfig } from '../../lib/config.ts'
import { type Executor, rows, type Tx } from '../../lib/db.ts'
import { liveEvent, type Outgoing } from '../../lib/live.ts'

type AuditRow = typeof auditLog.$inferSelect

const personColumns = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  avatar: users.avatar,
  avatarColor: users.avatarColor,
}

/** Actions whose target is a player's username. */
const USERNAME_TARGETS = [
  'reset_code.created',
  'player.disabled',
  'player.enabled',
  'chips.adjusted',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Every player id an entry names: in its before and after, and its giveaway recipients. */
function mentionedIds(row: AuditRow): string[] {
  const ids: string[] = []
  if (row.actorId) ids.push(row.actorId)
  for (const side of [row.before, row.after]) {
    if (!isRecord(side)) continue
    if (typeof side.userId === 'string') ids.push(side.userId)
    if (Array.isArray(side.recipients)) {
      for (const r of side.recipients)
        if (isRecord(r) && typeof r.userId === 'string') ids.push(r.userId)
    }
  }
  return ids
}

function seasonIdOf(row: AuditRow): number | null {
  if (row.seasonId !== null) return row.seasonId
  const match = /^season:(\d+)$/.exec(row.target ?? '')
  return match ? Number(match[1]) : null
}

/** Rows as the Audit page shows them, with everyone they name. Two small queries. */
export async function auditViews(executor: Executor, found: AuditRow[]): Promise<AuditEntryView[]> {
  const ids = [...new Set(found.flatMap(mentionedIds))]
  const names = [
    ...new Set(
      found
        .filter((r) => r.target && USERNAME_TARGETS.includes(r.action))
        .map((r) => (r.target as string).toLowerCase()),
    ),
  ]
  const seasonIds = [...new Set(found.map(seasonIdOf).filter((id): id is number => id !== null))]

  const conditions: SQL[] = []
  if (ids.length) conditions.push(inArray(users.id, ids))
  if (names.length) conditions.push(inArray(sql`lower(${users.username})`, names))
  const people = conditions.length
    ? await executor
        .select(personColumns)
        .from(users)
        .where(or(...conditions))
    : []
  const byId = new Map(people.map((p) => [p.id, p]))
  const byName = new Map(people.map((p) => [p.username.toLowerCase(), p]))

  const seasonRows = seasonIds.length
    ? await executor
        .select({ id: seasons.id, name: seasons.name })
        .from(seasons)
        .where(inArray(seasons.id, seasonIds))
    : []
  const seasonById = new Map(seasonRows.map((s) => [s.id, s]))

  return found.map((row) => {
    const named: Record<string, AuditPerson> = {}
    for (const id of mentionedIds(row)) {
      const person = byId.get(id)
      if (person) named[id] = person
    }
    if (row.target && USERNAME_TARGETS.includes(row.action)) {
      const person = byName.get(row.target.toLowerCase())
      if (person) named[person.id] = person
    }
    const seasonId = seasonIdOf(row)
    return {
      id: row.id,
      at: row.createdAt.toISOString(),
      action: row.action,
      kind: auditKind(row.action),
      actor: (row.actorId && byId.get(row.actorId)) || null,
      target: row.target,
      before: row.before,
      after: row.after,
      reason: row.reason,
      season: (seasonId !== null && seasonById.get(seasonId)) || null,
      people: named,
    }
  })
}

/**
 * Writes an admin action to the audit log and returns it as the Audit page
 * shows it, for the live event. Call it inside the action's transaction.
 */
export async function logAction(tx: Tx, entry: AuditEntry): Promise<AuditEntryView> {
  await writeAudit(tx, entry)
  // The id this session's insert just took, whatever other sessions are doing.
  const [last] = await rows<{ id: string }>(
    tx,
    sql`select currval(pg_get_serial_sequence('audit_log', 'id'))::text as id`,
  )
  const [row] = await tx
    .select()
    .from(auditLog)
    .where(eq(auditLog.id, Number(last?.id)))
  if (!row) throw new Error('The audit row was not written.')
  const [view] = await auditViews(tx, [row])
  if (!view) throw new Error('The audit row could not be read back.')
  return view
}

/** The live news of an audit row, for every open Audit page. */
export function auditEvent(entry: AuditEntryView): Outgoing {
  return liveEvent('feed', 'audit.logged', entry, entry.id)
}

function kindFilter(kind: AuditKind): SQL | undefined {
  return or(...AUDIT_KIND_PREFIXES[kind].map((prefix) => like(auditLog.action, `${prefix}%`)))
}

/** Two wire values are the same setting value. */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Setting changes that wait for the next daily reset, soonest first: the
 * newest scheduled value of each key, left out when it only puts back the
 * value in force (a change that was taken back).
 */
export async function pendingChanges(executor: Executor): Promise<PendingChangeView[]> {
  const found = await executor
    .selectDistinctOn([config.key], {
      key: config.key,
      value: config.value,
      effectiveAt: config.effectiveAt,
      updatedBy: config.updatedBy,
      reason: config.description,
    })
    .from(config)
    .where(gt(config.effectiveAt, sql`now()`))
    .orderBy(config.key, desc(config.effectiveAt), desc(config.id))
  if (found.length === 0) return []

  const values = await loadConfig(executor)
  const actorIds = [...new Set(found.map((r) => r.updatedBy).filter((id): id is string => !!id))]
  const actors = actorIds.length
    ? await executor.select(personColumns).from(users).where(inArray(users.id, actorIds))
    : []
  const byId = new Map(actors.map((a) => [a.id, a]))

  const pending: PendingChangeView[] = []
  for (const row of found) {
    if (!isConfigKey(row.key)) continue
    const parsed = parseConfigValue(row.key, row.value)
    if (!parsed.ok) continue
    const value = configWireValue(parsed.value)
    const current = configWireValue(values[row.key])
    if (sameValue(value, current)) continue
    pending.push({
      key: row.key,
      value,
      current,
      effectiveAt: row.effectiveAt.toISOString(),
      by: (row.updatedBy && byId.get(row.updatedBy)) || null,
      reason: row.reason,
    })
  }
  return pending.sort(
    (a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || a.key.localeCompare(b.key),
  )
}

/** GET /api/admin/audit: newest first, a page at a time, with what is coming up. */
export async function auditPage(
  executor: Executor,
  options: { before?: number; limit?: number; kind?: AuditKind },
  now: Date,
): Promise<AuditPage> {
  const limit = options.limit ?? AUDIT_PAGE_SIZE
  const found = await executor
    .select()
    .from(auditLog)
    .where(
      and(
        options.before === undefined ? undefined : lt(auditLog.id, options.before),
        options.kind ? kindFilter(options.kind) : undefined,
      ),
    )
    .orderBy(desc(auditLog.id))
    .limit(limit + 1)
  const entries = await auditViews(executor, found.slice(0, limit))
  return {
    entries,
    more: found.length > limit,
    // Only the first page carries what is coming up.
    pending: options.before === undefined ? await pendingChanges(executor) : [],
    nextReset: nextReset(now).toISOString(),
  }
}

export { personColumns }
