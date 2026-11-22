/**
 * Accounts for the admin panel (spec: Admin panel > Players): every player,
 * disabled ones too, with when they were last here and their chips this
 * season, and disabling or re-enabling an account. A disabled player cannot
 * sign in, leaves the leaderboard and the online list, and is left out of a
 * season's final standings; their chips stay where they are, so enabling
 * them again puts everything back.
 */
import { and, eq, sql } from 'drizzle-orm'

import { users, wallets } from '../../../db/schema/core.ts'
import type { AdminPlayerView } from '../../../shared/features/admin.ts'
import { userChannel } from '../../../shared/events.ts'
import type { Tier } from '../../../shared/tiers.ts'
import { destroyAllSessions } from '../../lib/auth.ts'
import type { Executor, Tx } from '../../lib/db.ts'
import { conflict, notFound } from '../../lib/errors.ts'
import type { AfterCommit } from '../../lib/idempotency.ts'
import { liveEvent, publish } from '../../lib/live.ts'
import { auditEvent, logAction } from './audit.ts'

const lastSeen = sql<Date | null>`(
  select max(s.last_seen_at) from sessions s where s.user_id = ${users.id}
)`.mapWith((value: string | Date | null) => (value === null ? null : new Date(value)))

function playerColumns() {
  return {
    id: users.id,
    username: users.username,
    displayName: users.displayName,
    avatar: users.avatar,
    avatarColor: users.avatarColor,
    role: users.role,
    createdAt: users.createdAt,
    disabledAt: users.disabledAt,
    lastSeenAt: lastSeen,
    balance: wallets.balance,
    vault: wallets.vault,
    tier: wallets.tier,
  }
}

type PlayerRow = {
  id: string
  username: string
  displayName: string
  avatar: string
  avatarColor: string
  role: AdminPlayerView['role']
  createdAt: Date
  disabledAt: Date | null
  lastSeenAt: Date | null
  balance: bigint | null
  vault: bigint | null
  tier: Tier | null
}

function toView(row: PlayerRow): AdminPlayerView {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatar: row.avatar,
    avatarColor: row.avatarColor,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    disabledAt: row.disabledAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    wallet:
      row.balance === null || row.vault === null
        ? null
        : { balance: Number(row.balance), vault: Number(row.vault), tier: row.tier ?? 'base' },
  }
}

/** Every account, active ones first, by name. */
export async function adminPlayers(
  executor: Executor,
  seasonId: number | null,
): Promise<AdminPlayerView[]> {
  const found = await executor
    .select(playerColumns())
    .from(users)
    .leftJoin(wallets, and(eq(wallets.userId, users.id), eq(wallets.seasonId, seasonId ?? -1)))
    .orderBy(sql`${users.disabledAt} is not null`, sql`lower(${users.displayName})`, users.id)
  return found.map(toView)
}

/** One account, as the panel lists it. */
export async function adminPlayer(
  executor: Executor,
  seasonId: number | null,
  userId: string,
): Promise<AdminPlayerView> {
  const [row] = await executor
    .select(playerColumns())
    .from(users)
    .leftJoin(wallets, and(eq(wallets.userId, users.id), eq(wallets.seasonId, seasonId ?? -1)))
    .where(eq(users.id, userId))
  if (!row) throw notFound('There is no such player.')
  return toView(row)
}

/** Locks a player's account row for the rest of the transaction. */
export async function lockPlayer(tx: Tx, userId: string) {
  const [row] = await tx
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .for('update')
  if (!row) throw notFound('There is no such player.')
  return row
}

export interface StatusChange {
  actorId: string
  userId: string
  reason?: string
  seasonId: number | null
}

/**
 * Disables an account: it cannot sign in, its sessions end now, and it
 * leaves the leaderboard. Never your own, so the site always keeps an admin.
 */
export async function disablePlayer(
  tx: Tx,
  change: StatusChange,
  afterCommit: AfterCommit,
): Promise<AdminPlayerView> {
  if (change.userId === change.actorId) {
    throw conflict('You cannot disable your own account.', 'self')
  }
  const player = await lockPlayer(tx, change.userId)
  if (player.disabledAt) throw conflict(`${player.displayName} is already disabled.`, 'disabled')
  await tx
    .update(users)
    .set({ disabledAt: sql`now()` })
    .where(eq(users.id, player.id))
  await destroyAllSessions(tx, player.id)
  const entry = await logAction(tx, {
    actorId: change.actorId,
    action: 'player.disabled',
    target: player.username,
    after: { userId: player.id },
    reason: change.reason,
  })
  afterCommit(() =>
    publish([
      auditEvent(entry),
      liveEvent(userChannel(player.id), 'notification', {
        text: 'An admin disabled your account, so you have been signed out.',
        tone: 'bad',
      }),
    ]),
  )
  return adminPlayer(tx, change.seasonId, player.id)
}

/** Lets a disabled account sign in again, with its chips as they were. */
export async function enablePlayer(
  tx: Tx,
  change: StatusChange,
  afterCommit: AfterCommit,
): Promise<AdminPlayerView> {
  const player = await lockPlayer(tx, change.userId)
  if (!player.disabledAt) throw conflict(`${player.displayName} is not disabled.`, 'enabled')
  await tx.update(users).set({ disabledAt: null }).where(eq(users.id, player.id))
  const entry = await logAction(tx, {
    actorId: change.actorId,
    action: 'player.enabled',
    target: player.username,
    after: { userId: player.id },
    reason: change.reason,
  })
  afterCommit(() => publish([auditEvent(entry)]))
  return adminPlayer(tx, change.seasonId, player.id)
}
