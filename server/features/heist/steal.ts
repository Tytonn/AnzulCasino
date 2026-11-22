/**
 * One steal attempt (spec: Steal rules), in one transaction:
 *
 * 1. Lock both wallets, lower user id first, then both players' daily rows
 *    and the target's shields row (the lock order in state.ts).
 * 2. Check the target can be robbed right now, by the database clock:
 *    shared/features/heist.ts `checkTarget`, the same rules the browser shows.
 * 3. Use the attempt. A shield charge blocks it; otherwise the success roll
 *    is drawn now, never earlier (rule 7). A success moves chips from the
 *    target's wallet to the thief's, a failure fines the thief.
 * 4. Save the attempt, write the ledger rows, post in chat, and after the
 *    commit tell everyone: the feed, both wallets, and the target alone.
 *
 * Refused attempts change nothing and do not use an attempt. A repeated
 * idempotency key returns the first answer.
 */
import { and, eq } from 'drizzle-orm'

import { steals, wallets } from '../../../db/schema/core.ts'
import { chipCount } from '../../../shared/chips.ts'
import { userChannel } from '../../../shared/events.ts'
import {
  attemptsAllowed,
  blockMessage,
  capLeft,
  checkTarget,
  type StealResponse,
  type StealInput,
  stealFine,
} from '../../../shared/features/heist.ts'
import { gameDay } from '../../../shared/game-day.ts'
import { seasonPhase } from '../../../shared/seasons.ts'
import type { StealOutcome } from '../../../shared/steals.ts'
import type { Wire } from '../../../shared/wire.ts'
import { systemPost } from '../../lib/chat.ts'
import { loadConfig } from '../../lib/config.ts'
import { dbNow, type Tx } from '../../lib/db.ts'
import { type ApiError, conflict, notFound } from '../../lib/errors.ts'
import type { RouteContext } from '../../lib/http.ts'
import { chipTransaction } from '../../lib/idempotency.ts'
import { liveEvent, type Outgoing, publish, walletEvents } from '../../lib/live.ts'
import { chance } from '../../lib/rng.ts'
import { type Season, standings } from '../../lib/seasons.ts'
import { lockWallets, readWallet, transfer } from '../../lib/wallet.ts'
import {
  lockDaily,
  lockShield,
  netWorthAtReset,
  type StealRow,
  stealColumns,
  stealView,
  triedToday,
  updateDaily,
  updateShield,
} from './state.ts'

const HOUR_MS = 3_600_000
const WHOLE = 10_000

/** A refusal in plain words, with a code the browser can tell apart. */
function refused(reason: string, message: string): ApiError {
  return reason === 'unknown' ? notFound(message) : conflict(message, `steal_${reason}`)
}

/** "2:59:58" or "45m", for how long a target stays immune. */
function shortDuration(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** The chat post for an attempt: plain text, names as players chose them. */
function postBody(
  outcome: StealOutcome,
  thief: string,
  target: string,
  amount: bigint,
  fine: bigint,
): string {
  if (outcome === 'success') return `${thief} robbed ${target} for ${chipCount(amount)}.`
  if (outcome === 'blocked') return `${target}'s shield blocked a steal by ${thief}.`
  return fine > 0n
    ? `${thief} tried to rob ${target} and got caught, paying ${target} a ${chipCount(fine)} fine.`
    : `${thief} tried to rob ${target} and got caught.`
}

async function walletExists(tx: Tx, seasonId: number, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ userId: wallets.userId })
    .from(wallets)
    .where(and(eq(wallets.seasonId, seasonId), eq(wallets.userId, userId)))
    .limit(1)
  return row !== undefined
}

export async function attemptSteal(
  ctx: RouteContext<StealInput, 'user'>,
  season: Season,
): Promise<Wire<StealResponse>> {
  const thiefId = ctx.user.id
  const { targetId } = ctx.input
  if (targetId === thiefId) throw refused('self', blockMessage('self'))

  return chipTransaction(ctx, async (tx, afterCommit) => {
    const now = await dbNow(tx)
    const cfg = await loadConfig(tx)
    const phase = seasonPhase(season, now, cfg.final_freeze_hours)
    const context = {
      freezeHours: cfg.final_freeze_hours,
      floor: cfg.steal_floor,
      minTake: cfg.steal_min_take,
    }
    if (phase !== 'open') {
      const reason = phase === 'final_day' ? 'freeze' : 'no_season'
      throw refused(reason, blockMessage(reason, context))
    }
    // A wallet is never deleted, so checking before the lock is safe.
    if (!(await walletExists(tx, season.id, targetId))) {
      throw refused('unknown', blockMessage('unknown'))
    }

    // Lock order: both wallets (lower id first), both daily rows, the target's shields.
    const locked = await lockWallets(tx, season.id, [thiefId, targetId])
    const day = gameDay(now)
    const daily = await lockDaily(tx, season.id, [thiefId, targetId], day)
    const shield = await lockShield(tx, season.id, targetId)
    const thiefWallet = locked.get(thiefId)
    const thiefDay = daily.get(thiefId)
    const targetDay = daily.get(targetId)
    if (!thiefWallet || !thiefDay || !targetDay) throw new Error('A locked row went missing.')

    // Ranks at the moment of the attempt. Disabled players are not on the board.
    const board = await standings(tx, season.id)
    const thiefRow = board.find((s) => s.userId === thiefId)
    const targetRow = board.find((s) => s.userId === targetId)
    const thiefRank = thiefRow?.rank ?? board.length + 1
    const name = targetRow?.displayName ?? 'That player'

    // The target's cap counts from their net worth at the daily reset, saved once a day.
    let atReset = targetDay.netWorthAtReset
    if (atReset === null) {
      atReset = await netWorthAtReset(tx, season.id, targetId, now)
      await updateDaily(tx, season.id, targetId, day, { netWorthAtReset: atReset })
    }
    const left = capLeft(atReset, targetDay.stolenToday, cfg.daily_loss_cap_pct)
    const allowed = attemptsAllowed(cfg.steal_attempts_per_day, thiefDay.extraStealBought)

    const check = checkTarget({
      phase,
      thief: { id: thiefId, rank: thiefRank },
      target: targetRow
        ? {
            id: targetId,
            rank: targetRow.rank,
            balance: targetRow.balance,
            netWorth: targetRow.netWorth,
          }
        : null,
      attemptsLeft: allowed - thiefDay.stealAttemptsUsed,
      triedToday: await triedToday(tx, season.id, thiefId, targetId, day),
      immuneUntil: shield.immuneUntil?.getTime() ?? null,
      now: now.getTime(),
      capLeft: left,
      cfg,
    })
    if (!check.ok) {
      throw refused(
        check.reason,
        blockMessage(check.reason, {
          ...context,
          name,
          canBuyExtra: !thiefDay.extraStealBought,
          immuneFor: shield.immuneUntil
            ? shortDuration(shield.immuneUntil.getTime() - now.getTime())
            : undefined,
        }),
      )
    }

    // From here the attempt counts.
    await updateDaily(tx, season.id, thiefId, day, {
      stealAttemptsUsed: thiefDay.stealAttemptsUsed + 1,
    })
    const immunity = new Date(now.getTime() + cfg.immunity_hours * HOUR_MS)
    let outcome: StealOutcome
    let amount = 0n
    let fine = 0n
    if (shield.charges > 0) {
      outcome = 'blocked'
      await updateShield(tx, season.id, targetId, {
        charges: shield.charges - 1,
        immuneUntil: immunity,
      })
    } else if (chance(cfg.steal_success_pct, WHOLE)) {
      // Drawn at this moment, after every check (rule 7).
      outcome = 'success'
      amount = check.amount
      await updateShield(tx, season.id, targetId, { immuneUntil: immunity })
      await updateDaily(tx, season.id, targetId, day, {
        stolenToday: targetDay.stolenToday + amount,
      })
    } else {
      outcome = 'failed'
      fine = stealFine(thiefWallet.balance, cfg)
    }

    const [saved] = await tx
      .insert(steals)
      .values({
        seasonId: season.id,
        thiefId,
        targetId,
        gameDay: day,
        outcome,
        amount,
        fine,
        thiefRank,
        targetRank: targetRow?.rank ?? board.length + 1,
      })
      .returning(stealColumns)
    const row = saved as StealRow

    const news: Outgoing[] = []
    const ref = { refType: 'steal', refId: row.id }
    if (outcome === 'success') {
      const moved = await transfer(tx, {
        seasonId: season.id,
        fromUserId: targetId,
        toUserId: thiefId,
        amount,
        outReason: 'steal_out',
        inReason: 'steal_in',
        ...ref,
      })
      news.push(...walletEvents(season.id, thiefId, moved.to))
      news.push(...walletEvents(season.id, targetId, moved.from))
    } else if (fine > 0n) {
      const moved = await transfer(tx, {
        seasonId: season.id,
        fromUserId: thiefId,
        toUserId: targetId,
        amount: fine,
        outReason: 'fine_out',
        inReason: 'fine_in',
        ...ref,
      })
      news.push(...walletEvents(season.id, thiefId, moved.from))
      news.push(...walletEvents(season.id, targetId, moved.to))
    }

    const thiefName = thiefRow?.displayName ?? ctx.user.displayName
    const post = await systemPost(tx, postBody(outcome, thiefName, name, amount, fine), {
      tone: outcome === 'success' ? 'win' : outcome === 'failed' ? 'loss' : 'info',
      userId: thiefId,
      category: 'game',
    })

    const immuneUntil = outcome === 'failed' ? null : immunity.toISOString()
    const view = stealView(row)
    const target = userChannel(targetId)
    const forTarget =
      outcome === 'success'
        ? liveEvent(
            target,
            'robbed',
            { stealId: row.id, thiefId, amount, immuneUntil: immunity.toISOString() },
            row.id,
          )
        : outcome === 'blocked'
          ? liveEvent(
              target,
              'shield.blocked',
              {
                stealId: row.id,
                thiefId,
                charges: shield.charges - 1,
                immuneUntil: immunity.toISOString(),
              },
              row.id,
            )
          : liveEvent(target, 'steal.foiled', { stealId: row.id, thiefId, fine }, row.id)

    afterCommit(() =>
      publish([
        post,
        liveEvent('feed', 'steal.result', { ...view, immuneUntil }, row.id),
        ...news,
        // The thief's other tabs learn of it from the feed, like everyone else.
        forTarget,
      ]),
    )

    const after = await readWallet(tx, season.id, thiefId)
    if (!after) throw new Error('The thief has no wallet.')
    return {
      steal: view,
      wallet: {
        seasonId: season.id,
        balance: Number(after.balance),
        vault: Number(after.vault),
        version: after.version,
      },
      immuneUntil,
      attemptsUsed: thiefDay.stealAttemptsUsed + 1,
    }
  })
}
