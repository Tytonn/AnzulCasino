/**
 * The wallet and the ledger (spec rules 2 to 4). Every chip that moves goes
 * through these functions, inside a transaction:
 *
 *   await db().transaction(async (tx) => {
 *     await debit(tx, { seasonId, userId, amount: stake, reason: 'bet', refType: 'game_round', refId: round.id })
 *   })
 *
 * Each call locks the wallet row first (SELECT ... FOR UPDATE), checks the
 * balance, changes it and writes exactly one ledger row per account it
 * touches, so a wallet's balance always equals the sum of its ledger rows.
 * Several wallets are always locked in user id order, so two transfers can
 * never deadlock.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'

import { ledger, netWorthSnapshots, wallets } from '../../db/schema/core.ts'
import { chipCount } from '../../shared/chips.ts'
import type { LedgerAccount, LedgerReason } from '../../shared/ledger.ts'
import type { Tier } from '../../shared/tiers.ts'
import { type Executor, rows, type Tx } from './db.ts'
import { ApiError } from './errors.ts'

export interface Wallet {
  seasonId: number
  userId: string
  balance: bigint
  vault: bigint
  tier: Tier
}

export function netWorth(wallet: Pick<Wallet, 'balance' | 'vault'>): bigint {
  return wallet.balance + wallet.vault
}

export interface Movement {
  reason: LedgerReason
  /** What caused it, for History: ('game_round', 42), ('steal', 7), ... */
  refType?: string
  refId?: string | number
  meta?: Record<string, unknown>
}

export interface Change extends Movement {
  seasonId: number
  userId: string
  /** Hundredths, greater than zero. */
  amount: bigint
  /** Defaults to the wallet. */
  account?: LedgerAccount
}

export interface Balances {
  balance: bigint
  vault: bigint
  tier: Tier
  /** The ledger row written for this change. Live events use it as their version. */
  ledgerId: number
}

export class InsufficientFunds extends ApiError {
  constructor(available: bigint, account: LedgerAccount = 'wallet') {
    super(
      400,
      'insufficient_funds',
      account === 'vault'
        ? `Your vault only has ${chipCount(available)}.`
        : `You only have ${chipCount(available)}.`,
      { available: Number(available) },
    )
  }
}

function noWallet(): ApiError {
  return new ApiError(
    409,
    'no_wallet',
    'You are not in this season yet. Reload the page, and if it keeps happening, ask the admin.',
  )
}

function positive(amount: bigint) {
  if (typeof amount !== 'bigint' || amount <= 0n) {
    throw new Error(`Chip amounts must be bigint hundredths above zero, got ${String(amount)}`)
  }
}

const walletColumns = {
  seasonId: wallets.seasonId,
  userId: wallets.userId,
  balance: wallets.balance,
  vault: wallets.vault,
  tier: wallets.tier,
}

/**
 * A wallet's latest ledger id, for a query on `wallets`: the version its live
 * events carry, so a browser can tell fetched state from older news. Zero
 * before any chips have moved.
 */
export const walletVersion = sql<number>`(
  select coalesce(max(${ledger.id}), 0) from ${ledger}
  where ${ledger.seasonId} = ${wallets.seasonId} and ${ledger.userId} = ${wallets.userId}
)`.mapWith(Number)

/** Locks a wallet for the rest of the transaction and returns it. */
export async function lockWallet(tx: Tx, seasonId: number, userId: string): Promise<Wallet> {
  const [wallet] = await tx
    .select(walletColumns)
    .from(wallets)
    .where(and(eq(wallets.seasonId, seasonId), eq(wallets.userId, userId)))
    .for('update')
  if (!wallet) throw noWallet()
  return wallet
}

/**
 * Locks several wallets in user id order (the deadlock-free order) and
 * returns them by user id. A transaction that touches more than one wallet
 * calls this first, before debit, credit or anything else that locks.
 * Postgres sorts before it locks, so the rows are locked in that order.
 */
export async function lockWallets(
  tx: Tx,
  seasonId: number,
  userIds: string[],
): Promise<Map<string, Wallet>> {
  const unique = [...new Set(userIds)].sort()
  if (unique.length === 0) return new Map()
  const locked = await tx
    .select(walletColumns)
    .from(wallets)
    .where(and(eq(wallets.seasonId, seasonId), inArray(wallets.userId, unique)))
    .orderBy(wallets.userId)
    .for('update')
  if (locked.length !== unique.length) throw noWallet()
  return new Map(locked.map((w) => [w.userId, w]))
}

/** Reads a wallet without locking it. For display, never for spending. */
export async function readWallet(
  executor: Executor,
  seasonId: number,
  userId: string,
): Promise<(Wallet & { version: number }) | null> {
  const [wallet] = await executor
    .select({ ...walletColumns, version: walletVersion })
    .from(wallets)
    .where(and(eq(wallets.seasonId, seasonId), eq(wallets.userId, userId)))
  return wallet ?? null
}

async function apply(
  tx: Tx,
  change: Change,
  delta: bigint,
  netWorthMoves: boolean,
): Promise<Balances> {
  const account = change.account ?? 'wallet'
  const column = account === 'wallet' ? wallets.balance : wallets.vault
  const [updated] = await tx
    .update(wallets)
    .set({
      [account === 'wallet' ? 'balance' : 'vault']: sql`${column} + ${delta}`,
      ...(netWorthMoves ? { netWorthAt: sql`now()` } : {}),
    })
    .where(and(eq(wallets.seasonId, change.seasonId), eq(wallets.userId, change.userId)))
    .returning({ balance: wallets.balance, vault: wallets.vault, tier: wallets.tier })
  if (!updated) throw noWallet()

  const [row] = await tx
    .insert(ledger)
    .values({
      seasonId: change.seasonId,
      userId: change.userId,
      account,
      delta,
      balanceAfter: account === 'wallet' ? updated.balance : updated.vault,
      reason: change.reason,
      refType: change.refType ?? null,
      refId: change.refId === undefined ? null : String(change.refId),
      meta: change.meta ?? null,
    })
    .returning({ id: ledger.id })

  if (netWorthMoves)
    await snapshot(tx, change.seasonId, change.userId, updated.balance + updated.vault)
  return { ...updated, ledgerId: row?.id as number }
}

/** Hourly net-worth points for charts, written as chips move (no timers). */
async function snapshot(tx: Tx, seasonId: number, userId: string, worth: bigint) {
  await tx
    .insert(netWorthSnapshots)
    .values({ seasonId, userId, at: sql`date_trunc('hour', now())`, netWorth: worth })
    .onConflictDoUpdate({
      target: [netWorthSnapshots.seasonId, netWorthSnapshots.userId, netWorthSnapshots.at],
      set: { netWorth: worth },
    })
}

/**
 * Takes chips out of a player's wallet (or vault). Locks it, refuses to go
 * below zero, writes one ledger row with a negative delta.
 */
export async function debit(tx: Tx, change: Change): Promise<Balances> {
  positive(change.amount)
  const account = change.account ?? 'wallet'
  const wallet = await lockWallet(tx, change.seasonId, change.userId)
  const available = account === 'wallet' ? wallet.balance : wallet.vault
  if (available < change.amount) throw new InsufficientFunds(available, account)
  return apply(tx, change, -change.amount, true)
}

/** Adds chips to a player's wallet (or vault). Locks it, writes one ledger row. */
export async function credit(tx: Tx, change: Change): Promise<Balances> {
  positive(change.amount)
  await lockWallet(tx, change.seasonId, change.userId)
  return apply(tx, change, change.amount, true)
}

export interface Transfer {
  seasonId: number
  fromUserId: string
  toUserId: string
  amount: bigint
  /** Such as steal_out / steal_in, or fine_out / fine_in. */
  outReason: LedgerReason
  inReason: LedgerReason
  refType?: string
  refId?: string | number
  meta?: Record<string, unknown>
}

/**
 * Moves chips from one player's wallet to another's (steals and fines). Locks
 * both wallets, lower user id first, then writes two ledger rows.
 */
export async function transfer(tx: Tx, t: Transfer): Promise<{ from: Balances; to: Balances }> {
  positive(t.amount)
  if (t.fromUserId === t.toUserId) throw new Error('transfer() needs two different players')
  const locked = await lockWallets(tx, t.seasonId, [t.fromUserId, t.toUserId])
  const from = locked.get(t.fromUserId) as Wallet
  if (from.balance < t.amount) throw new InsufficientFunds(from.balance)
  const ref = { refType: t.refType, refId: t.refId, meta: t.meta }
  const fromBalances = await apply(
    tx,
    { seasonId: t.seasonId, userId: t.fromUserId, amount: t.amount, reason: t.outReason, ...ref },
    -t.amount,
    true,
  )
  const toBalances = await apply(
    tx,
    { seasonId: t.seasonId, userId: t.toUserId, amount: t.amount, reason: t.inReason, ...ref },
    t.amount,
    true,
  )
  return { from: fromBalances, to: toBalances }
}

/**
 * Moves chips between a player's own wallet and vault (vault_deposit,
 * vault_withdraw). Net worth does not change. Two ledger rows, one per account.
 */
export async function moveBetweenAccounts(
  tx: Tx,
  move: {
    seasonId: number
    userId: string
    amount: bigint
    from: LedgerAccount
    reason: 'vault_deposit' | 'vault_withdraw'
    refType?: string
    refId?: string | number
  },
): Promise<{ balance: bigint; vault: bigint }> {
  positive(move.amount)
  const wallet = await lockWallet(tx, move.seasonId, move.userId)
  const to: LedgerAccount = move.from === 'wallet' ? 'vault' : 'wallet'
  const available = move.from === 'wallet' ? wallet.balance : wallet.vault
  if (available < move.amount) throw new InsufficientFunds(available, move.from)
  const base = {
    seasonId: move.seasonId,
    userId: move.userId,
    amount: move.amount,
    reason: move.reason,
    refType: move.refType,
    refId: move.refId,
  }
  await apply(tx, { ...base, account: move.from }, -move.amount, false)
  const after = await apply(tx, { ...base, account: to }, move.amount, false)
  return { balance: after.balance, vault: after.vault }
}

/**
 * Wallets whose balance or vault differs from the sum of their ledger rows.
 * Always empty; the tests and the admin's health check call it.
 */
export async function ledgerMismatches(
  executor: Executor,
  seasonId: number,
): Promise<{ userId: string; account: LedgerAccount; stored: bigint; ledgerSum: bigint }[]> {
  const found = await rows<{
    user_id: string
    account: LedgerAccount
    stored: string
    ledger_sum: string
  }>(
    executor,
    sql`
      select w.user_id, a.account, a.stored, coalesce(l.total, 0) as ledger_sum
      from wallets w
      cross join lateral (values ('wallet', w.balance), ('vault', w.vault)) as a(account, stored)
      left join lateral (
        select sum(delta) as total from ledger
        where season_id = w.season_id and user_id = w.user_id and account = a.account
      ) l on true
      where w.season_id = ${seasonId} and a.stored <> coalesce(l.total, 0)`,
  )
  return found.map((r) => ({
    userId: r.user_id,
    account: r.account,
    stored: BigInt(r.stored),
    ledgerSum: BigInt(r.ledger_sum),
  }))
}
