/**
 * Chips the admin moves (spec: Admin panel > Chips; Economy > Giveaways):
 * manual adjustments with a required reason, and giveaways to chosen players
 * or a pot split between them. There is no quiet path: every chip goes
 * through the ledger (`admin_adjust` or `giveaway`) in the same transaction
 * as its audit row and its chat post, and the players hear about it.
 */
import { asc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { seasons, users } from '../../../db/schema/core.ts'
import { chipCount } from '../../../shared/chips.ts'
import { userChannel } from '../../../shared/events.ts'
import {
  adjustNoticeText,
  adjustPostText,
  type AdjustInput,
  giveawayNoticeText,
  giveawayPostText,
  type GiveawayInput,
  type GiveawayResponse,
  giveawayShares,
  type AdminPlayerView,
} from '../../../shared/features/admin.ts'
import { systemPost } from '../../lib/chat.ts'
import type { Tx } from '../../lib/db.ts'
import { badRequest, conflict } from '../../lib/errors.ts'
import type { AfterCommit } from '../../lib/idempotency.ts'
import { liveEvent, type Outgoing, publish, walletEvents } from '../../lib/live.ts'
import { joinSeason, type Season } from '../../lib/seasons.ts'
import {
  type Balances,
  credit,
  debit,
  lockWallet,
  lockWallets,
  readWallet,
} from '../../lib/wallet.ts'
import { auditEvent, logAction } from './audit.ts'
import { adminPlayer, lockPlayer } from './players.ts'

export interface Actor {
  id: string
  displayName: string
}

/**
 * Refuses once the season's end has passed by the transaction's clock: its
 * standings are being frozen, so its chips are final (spec: the end is exact).
 */
async function requireSeasonOpen(tx: Tx, season: Season): Promise<void> {
  const [row] = await tx
    .select({ open: sql<boolean>`now() < ${seasons.endsAt}` })
    .from(seasons)
    .where(eq(seasons.id, season.id))
  if (!row?.open) {
    throw conflict(`${season.name} has ended, so its chips are final.`, 'season_over')
  }
}

/**
 * Gives a player who has no wallet in the season yet their starting chips,
 * as their next visit would. A disabled account is never given one.
 */
async function ensureWallet(
  tx: Tx,
  season: Season,
  player: { id: string; displayName: string; disabledAt: Date | null },
  news: Outgoing[],
): Promise<void> {
  if (await readWallet(tx, season.id, player.id)) return
  if (player.disabledAt) {
    throw conflict(`${player.displayName} is disabled and has no chips this season.`, 'no_wallet')
  }
  const joined = await joinSeason(tx, season, player.id)
  if (joined) news.push(...walletEvents(season.id, player.id, joined))
}

/** A manual adjustment, up or down, to one player's wallet or vault. */
export async function adjustChips(
  tx: Tx,
  season: Season,
  actor: Actor,
  input: AdjustInput,
  afterCommit: AfterCommit,
): Promise<{ player: AdminPlayerView }> {
  await requireSeasonOpen(tx, season)
  const news: Outgoing[] = []
  const player = await lockPlayer(tx, input.userId)
  await ensureWallet(tx, season, player, news)
  const wallet = await lockWallet(tx, season.id, player.id)
  const account = input.account
  const amount = BigInt(input.amount)
  const before = account === 'wallet' ? wallet.balance : wallet.vault
  const self = player.id === actor.id
  if (amount < 0n && before < -amount) {
    const whose = self ? 'You have' : `${player.displayName} has`
    throw badRequest(
      `${whose} only ${chipCount(before)} in the ${account}, so that is the most you can take.`,
      'insufficient_funds',
    )
  }

  const movement = {
    seasonId: season.id,
    userId: player.id,
    account,
    reason: 'admin_adjust' as const,
    refType: 'admin',
    meta: { by: actor.id, note: input.reason },
  }
  const after: Balances =
    amount > 0n
      ? await credit(tx, { ...movement, amount })
      : await debit(tx, { ...movement, amount: -amount })
  const value = account === 'wallet' ? after.balance : after.vault

  const post = await systemPost(
    tx,
    adjustPostText({
      admin: actor.displayName,
      player: player.displayName,
      self,
      amount,
      account,
      reason: input.reason,
    }),
    {
      tone: 'info',
      userId: player.id,
      admin: {
        kind: 'adjust',
        by: actor.id,
        userId: player.id,
        account,
        amount: Number(amount),
        reason: input.reason,
      },
    },
  )
  const entry = await logAction(tx, {
    actorId: actor.id,
    action: 'chips.adjusted',
    target: player.username,
    // Numbers, so the audit log reads like the API (writeAudit would store bigint as text).
    before: { userId: player.id, account, value: Number(before) },
    after: { userId: player.id, account, value: Number(value), delta: Number(amount) },
    reason: input.reason,
    seasonId: season.id,
  })

  news.push(...walletEvents(season.id, player.id, after), post, auditEvent(entry))
  if (!self) {
    news.push(
      liveEvent(userChannel(player.id), 'notification', {
        text: adjustNoticeText(actor.displayName, amount, account, input.reason),
        tone: amount > 0n ? 'good' : 'bad',
      }),
    )
  }
  afterCommit(() => publish(news))
  return { player: await adminPlayer(tx, season.id, player.id) }
}

/**
 * A giveaway: the same chips to each player named (or everyone in the
 * season), or a pot split between them, each share rounded down to a
 * hundredth. One `giveaway` ledger row per player, one chat post with names
 * and amounts, and a note to each of them.
 */
export async function giveChips(
  tx: Tx,
  season: Season,
  actor: Actor,
  input: GiveawayInput,
  afterCommit: AfterCommit,
): Promise<GiveawayResponse> {
  await requireSeasonOpen(tx, season)
  const everyone = input.to === 'everyone'
  const columns = {
    id: users.id,
    username: users.username,
    displayName: users.displayName,
    disabledAt: users.disabledAt,
  }
  // Locked in id order, the order every multi-player transaction uses.
  const players = everyone
    ? await tx
        .select(columns)
        .from(users)
        .where(isNull(users.disabledAt))
        .orderBy(asc(users.id))
        .for('update')
    : await tx
        .select(columns)
        .from(users)
        .where(inArray(users.id, input.to as string[]))
        .orderBy(asc(users.id))
        .for('update')
  if (!everyone && players.length !== (input.to as string[]).length) {
    throw badRequest(
      'One of those players no longer exists. Reload and pick again.',
      'unknown_player',
    )
  }
  const disabled = players.find((p) => p.disabledAt)
  if (disabled) {
    throw conflict(
      `${disabled.displayName} is disabled. Enable them first, or leave them out.`,
      'disabled',
    )
  }
  if (players.length === 0) throw conflict('There is nobody to give chips to yet.', 'nobody')

  const amount = BigInt(input.amount)
  const { share, total } = giveawayShares(amount, players.length, input.split)
  if (share <= 0n) {
    throw badRequest(
      `${chipCount(amount)} is too little to split between ${players.length} players. Each share needs at least 0.01.`,
      'too_small',
    )
  }

  const news: Outgoing[] = []
  for (const player of players) await ensureWallet(tx, season, player, news)
  await lockWallets(
    tx,
    season.id,
    players.map((p) => p.id),
  )
  const note = input.note ?? null
  const recipients: { userId: string; amount: number }[] = []
  for (const player of players) {
    const after = await credit(tx, {
      seasonId: season.id,
      userId: player.id,
      amount: share,
      reason: 'giveaway',
      refType: 'admin',
      meta: { by: actor.id, ...(note ? { note } : {}) },
    })
    recipients.push({ userId: player.id, amount: Number(share) })
    news.push(...walletEvents(season.id, player.id, after))
    if (player.id !== actor.id) {
      news.push(
        liveEvent(userChannel(player.id), 'notification', {
          text: giveawayNoticeText(actor.displayName, share, note),
          tone: 'good',
        }),
      )
    }
  }

  const names = players
    .map((p) => p.displayName)
    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
  const post = await systemPost(
    tx,
    giveawayPostText({
      admin: actor.displayName,
      names,
      everyone,
      split: input.split,
      amount,
      share,
      note,
    }),
    {
      tone: 'info',
      ...(players.length === 1 && players[0] ? { userId: players[0].id } : {}),
      admin: {
        kind: 'giveaway',
        by: actor.id,
        split: input.split,
        everyone,
        share: Number(share),
        total: Number(total),
        recipients,
        note,
      },
    },
  )
  const entry = await logAction(tx, {
    actorId: actor.id,
    action: 'giveaway.given',
    target: everyone
      ? 'everyone'
      : players.length === 1
        ? (players[0]?.username ?? 'one player')
        : `${players.length} players`,
    after: {
      split: input.split,
      everyone,
      amount: Number(amount),
      share: Number(share),
      total: Number(total),
      recipients,
    },
    reason: note ?? undefined,
    seasonId: season.id,
  })
  news.push(post, auditEvent(entry))
  afterCommit(() => publish(news))
  return { share: Number(share), total: Number(total), recipients }
}
