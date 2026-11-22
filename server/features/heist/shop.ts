/**
 * What the heist lane sells in the Shop, and the vault (spec: Shields, Vault,
 * Shop). Each purchase or move is one keyed transaction that locks the
 * player's wallet first, checks the limits by the database clock, and moves
 * chips only through server/lib/wallet.ts:
 *
 * - A shield charge: 2% of the wallet, at least 30 chips, removed from the
 *   game. At most `shield_max_charges` held and `shield_weekly_limit` bought
 *   per season week.
 * - The extra steal attempt: one per game day, at its config price.
 * - A vault move: one per game day, deposit or withdrawal, the vault holding
 *   at most `vault_cap_pct` of net worth at the moment of a deposit.
 *
 * None of them run in the final day of the season.
 */
import { chipCount } from '../../../shared/chips.ts'
import type { ConfigValues } from '../../../shared/config.ts'
import { userChannel } from '../../../shared/events.ts'
import {
  attemptsAllowed,
  type ExtraAttemptResponse,
  extraAttemptPrice,
  shieldPrice,
  type ShieldResponse,
  parseVaultAmount,
  type VaultMoveInput,
  type VaultResponse,
  vaultMoveProblem,
} from '../../../shared/features/heist.ts'
import { gameDay } from '../../../shared/game-day.ts'
import { seasonPhase } from '../../../shared/seasons.ts'
import type { Wire } from '../../../shared/wire.ts'
import { shieldPurchases } from '../../../db/schema/core.ts'
import { loadConfig } from '../../lib/config.ts'
import { dbNow, type Tx } from '../../lib/db.ts'
import { ApiError, badRequest, conflict } from '../../lib/errors.ts'
import type { RouteContext } from '../../lib/http.ts'
import { chipTransaction } from '../../lib/idempotency.ts'
import { liveEvent, publish, walletEvents } from '../../lib/live.ts'
import type { Season } from '../../lib/seasons.ts'
import { debit, lockWallet, moveBetweenAccounts, readWallet } from '../../lib/wallet.ts'
import { lockDaily, lockShield, shieldsBoughtThisWeek, updateDaily, updateShield } from './state.ts'

type Ctx = RouteContext<unknown, 'user'>

/** Refuses anything heist sells or moves outside the season's open days. */
function requireOpen(season: Season, now: Date, cfg: ConfigValues, what: string): void {
  const phase = seasonPhase(season, now, cfg.final_freeze_hours)
  if (phase === 'open') return
  if (phase === 'final_day') {
    throw conflict(
      `${what} closed for the final ${cfg.final_freeze_hours} hours of the season.`,
      'final_day',
    )
  }
  throw conflict('There is no season running right now.', 'no_season')
}

/** The wallet as the top bar takes it, read inside the transaction. */
async function walletAfter(tx: Tx, seasonId: number, userId: string) {
  const after = await readWallet(tx, seasonId, userId)
  if (!after) throw new Error('The wallet went missing.')
  return {
    seasonId,
    balance: Number(after.balance),
    vault: Number(after.vault),
    version: after.version,
    tier: after.tier,
  }
}

function cannotAfford(what: string, price: bigint, balance: bigint): ApiError {
  return new ApiError(
    400,
    'insufficient_funds',
    `${what} costs ${chipCount(price)} and you have ${chipCount(balance)}.`,
  )
}

// ---------------------------------------------------------------- shields

export function buyShield(ctx: Ctx, season: Season): Promise<Wire<ShieldResponse>> {
  const userId = ctx.user.id
  return chipTransaction(ctx, async (tx, afterCommit) => {
    const now = await dbNow(tx)
    const cfg = await loadConfig(tx)
    requireOpen(season, now, cfg, 'Shields are')

    const wallet = await lockWallet(tx, season.id, userId)
    const shield = await lockShield(tx, season.id, userId)
    if (shield.charges >= cfg.shield_max_charges) {
      throw conflict(
        `You already hold ${shield.charges} shield ${shield.charges === 1 ? 'charge' : 'charges'}, the most you can hold.`,
        'shield_max',
      )
    }
    const bought = await shieldsBoughtThisWeek(tx, season, userId, now)
    if (bought >= cfg.shield_weekly_limit) {
      throw conflict(
        `You have bought ${bought} shield ${bought === 1 ? 'charge' : 'charges'} this season week, the most allowed. More when the next week starts.`,
        'shield_week',
      )
    }
    const price = shieldPrice(wallet.balance, cfg)
    if (wallet.balance < price) throw cannotAfford('A shield charge', price, wallet.balance)

    const [purchase] = await tx
      .insert(shieldPurchases)
      .values({ seasonId: season.id, userId, price })
      .returning({ id: shieldPurchases.id })
    const after = await debit(tx, {
      seasonId: season.id,
      userId,
      amount: price,
      reason: 'shield_purchase',
      refType: 'shield_purchase',
      refId: purchase?.id,
    })
    const charges = shield.charges + 1
    await updateShield(tx, season.id, userId, { charges })

    afterCommit(() =>
      publish([
        ...walletEvents(season.id, userId, after),
        liveEvent(userChannel(userId), 'heist.changed', { what: 'shield' }, after.ledgerId),
      ]),
    )
    const { tier: _tier, ...wire } = await walletAfter(tx, season.id, userId)
    return { charges, price: Number(price), shieldsThisWeek: bought + 1, wallet: wire }
  })
}

// ---------------------------------------------------------------- the extra steal attempt

export function buyExtraAttempt(ctx: Ctx, season: Season): Promise<Wire<ExtraAttemptResponse>> {
  const userId = ctx.user.id
  return chipTransaction(ctx, async (tx, afterCommit) => {
    const now = await dbNow(tx)
    const cfg = await loadConfig(tx)
    requireOpen(season, now, cfg, 'Steals are')

    const wallet = await lockWallet(tx, season.id, userId)
    const day = gameDay(now)
    const mine = (await lockDaily(tx, season.id, [userId], day)).get(userId)
    if (!mine) throw new Error('The daily row was not made.')
    if (mine.extraStealBought) {
      throw conflict(
        'You already bought today’s extra steal attempt. There is one per game day.',
        'extra_bought',
      )
    }
    const price = extraAttemptPrice(wallet.balance, cfg)
    if (wallet.balance < price) throw cannotAfford('The extra attempt', price, wallet.balance)

    const after = await debit(tx, {
      seasonId: season.id,
      userId,
      amount: price,
      reason: 'steal_attempt_purchase',
      refType: 'game_day',
      refId: day,
    })
    await updateDaily(tx, season.id, userId, day, { extraStealBought: true })

    afterCommit(() =>
      publish([
        ...walletEvents(season.id, userId, after),
        liveEvent(userChannel(userId), 'heist.changed', { what: 'extra' }, after.ledgerId),
      ]),
    )
    const { tier: _tier, ...wire } = await walletAfter(tx, season.id, userId)
    return {
      attemptsAllowed: attemptsAllowed(cfg.steal_attempts_per_day, true),
      price: Number(price),
      wallet: wire,
    }
  })
}

// ---------------------------------------------------------------- the vault

export function moveVault(
  ctx: RouteContext<VaultMoveInput, 'user'>,
  season: Season,
): Promise<Wire<VaultResponse>> {
  const userId = ctx.user.id
  const { direction } = ctx.input
  return chipTransaction(ctx, async (tx, afterCommit) => {
    const now = await dbNow(tx)
    const cfg = await loadConfig(tx)
    requireOpen(season, now, cfg, 'Vault moves are')

    const wallet = await lockWallet(tx, season.id, userId)
    const day = gameDay(now)
    const mine = (await lockDaily(tx, season.id, [userId], day)).get(userId)
    if (!mine) throw new Error('The daily row was not made.')
    if (mine.vaultMoved) {
      throw conflict(
        'You already moved chips in or out of your vault today. The next move opens at 4:00 AM Central.',
        'vault_moved',
      )
    }

    const deposit = direction === 'deposit'
    const { balance, vault } = wallet
    const parsed = parseVaultAmount(ctx.input.amount, direction, balance, vault, cfg.vault_cap_pct)
    if (!parsed.ok) throw badRequest(parsed.error)
    const { amount } = parsed
    const problem = vaultMoveProblem(direction, amount, balance, vault, cfg.vault_cap_pct)
    if (problem?.code === 'vault_full') throw conflict(problem.message, problem.code)
    if (problem)
      throw badRequest(problem.message, problem.code === 'zero' ? undefined : problem.code)

    await moveBetweenAccounts(tx, {
      seasonId: season.id,
      userId,
      amount,
      from: deposit ? 'wallet' : 'vault',
      reason: deposit ? 'vault_deposit' : 'vault_withdraw',
      refType: 'game_day',
      refId: day,
    })
    await updateDaily(tx, season.id, userId, day, { vaultMoved: true })

    const after = await walletAfter(tx, season.id, userId)
    afterCommit(() =>
      publish([
        ...walletEvents(season.id, userId, {
          balance: BigInt(after.balance),
          vault: BigInt(after.vault),
          tier: after.tier,
          ledgerId: after.version,
        }),
        liveEvent(userChannel(userId), 'heist.changed', { what: 'vault' }, after.version),
      ]),
    )
    const { tier: _tier, ...wire } = after
    return { direction, amount: Number(amount), wallet: wire }
  })
}
