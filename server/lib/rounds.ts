/**
 * The round helper (spec: The room model). Every game's rounds go through
 * it, so the stake, the payout, the ledger, idempotency, big bets, the
 * ticker, chat posts and room news work the same in every room:
 *
 *   route({
 *     method: 'POST',
 *     path: '/api/coinflip/play',
 *     auth: 'user',
 *     idempotent: true,
 *     input: PlayInput,
 *     run: (ctx) =>
 *       playTransaction(ctx, coinflip, async (play) => {
 *         const round = await play.start({ bet: ctx.input.bet, detail: { call: ctx.input.call } })
 *         const side = flip() // draw late: after the stake is taken
 *         const settled = await play.settle(round, { payout, detail, summary: 'Heads' })
 *         return play.result(settled)
 *       }),
 *   })
 *
 * A round's life: `start` takes the stake (one open round per player per
 * game), `act` saves each move, `raise` takes more stake (a double down),
 * `lower` hands part of it back (one bet taken off the table), and `settle`
 * pays out, or `refund` hands the stake back. Each step is
 * published to the room after the commit, and the response carries the same
 * view, so the player animates without waiting for the echo.
 *
 * `detail` is the game's public state: enough to draw the round and to
 * replay it. `secret` is anything hidden that must exist before it is shown
 * (a hole card, a crash point). It never leaves the server and is cleared at
 * settle. Draw everything else late, at the moment it is revealed.
 */
import { and, desc, eq, gt, lt, or, sql } from 'drizzle-orm'

import { gameRounds, users } from '../../db/schema/core.ts'
import type { SystemMeta } from '../../shared/chat.ts'
import { formatChips, formatMultiplier } from '../../shared/chips.ts'
import type { ConfigValues } from '../../shared/config.ts'
import { checkBetAmount, parseBetAmount } from '../../shared/bet-amount.ts'
import { roomChannel, type RoundSummary } from '../../shared/events.ts'
import type { RoundStatus } from '../../shared/rounds.ts'
import { roundVersion } from '../../shared/rounds.ts'
import type { Wire } from '../../shared/wire.ts'
import { systemPost } from './chat.ts'
import { loadConfig } from './config.ts'
import { db, type Executor, type Tx } from './db.ts'
import { ApiError, badRequest } from './errors.ts'
import { type AfterCommit, chipTransaction, type ChipRequest } from './idempotency.ts'
import { liveEvent, type Outgoing, publish, type Publishable, walletEvents } from './live.ts'
import { isUniqueViolation } from './pg-errors.ts'
import { currentSeason, requireBetsOpen } from './seasons.ts'
import { type Balances, credit, debit, lockWallet, readWallet } from './wallet.ts'

// ---------------------------------------------------------------- games

/** A game as the server knows it. */
export interface ServerGame {
  /** Its id: the room (/room/<id>), the channel (room:<id>), the API (/api/<id>/*), rounds' `game`. */
  id: string
  /** Its name in chat posts, such as "Coin flip". */
  name: string
}

const GAME_ID = /^[a-z][a-z0-9-]{1,30}$/

/** Declares a game for the round helper. */
export function defineServerGame(game: ServerGame): ServerGame {
  if (!GAME_ID.test(game.id))
    throw new Error(`Game ids are lowercase words with dashes: ${game.id}`)
  return game
}

// ---------------------------------------------------------------- rounds

/** A round as the server holds it. `D` is the game's public detail, `S` its secret. */
export interface Round<D = unknown, S = unknown> {
  id: number
  seasonId: number
  userId: string
  game: string
  status: RoundStatus
  stake: bigint
  payout: bigint | null
  /** Display only, as stored: "1.9600". Payouts are always bigint math. */
  multiplier: string | null
  detail: D
  secret: S | null
  summary: string | null
  bigBet: boolean
  allIn: boolean
  steps: number
  sharedRoundId: number | null
  startedAt: Date
  settledAt: Date | null
  actedAt: Date
}

const roundColumns = {
  id: gameRounds.id,
  seasonId: gameRounds.seasonId,
  userId: gameRounds.userId,
  game: gameRounds.game,
  status: gameRounds.status,
  stake: gameRounds.stake,
  payout: gameRounds.payout,
  multiplier: gameRounds.multiplier,
  detail: gameRounds.detail,
  secret: gameRounds.secret,
  summary: gameRounds.summary,
  bigBet: gameRounds.bigBet,
  allIn: gameRounds.allIn,
  steps: gameRounds.steps,
  sharedRoundId: gameRounds.sharedRoundId,
  startedAt: gameRounds.startedAt,
  settledAt: gameRounds.settledAt,
  actedAt: gameRounds.actedAt,
}

type RoundRow = Pick<typeof gameRounds.$inferSelect, keyof typeof roundColumns>

function toRound<D, S>(row: RoundRow): Round<D, S> {
  return { ...row, detail: row.detail as D, secret: row.secret as S | null }
}

/** A round as browsers see it: no secret. Chip amounts become numbers on the wire. */
export interface RoundOut<D = unknown> {
  id: number
  game: string
  userId: string
  status: RoundStatus
  stake: bigint
  payout: bigint | null
  /** Hundredths of a multiplier. */
  multiplier: number | null
  detail: D
  summary: string | null
  bigBet: boolean
  allIn: boolean
  steps: number
  startedAt: string
  settledAt: string | null
}

/** The public view of a round, for responses and room events. Leaves the secret out. */
export function roundView<D>(round: Round<D, unknown>): RoundOut<D> {
  return {
    id: round.id,
    game: round.game,
    userId: round.userId,
    status: round.status,
    stake: round.stake,
    payout: round.payout,
    multiplier: round.multiplier === null ? null : Math.round(Number(round.multiplier) * 100),
    detail: round.detail,
    summary: round.summary,
    bigBet: round.bigBet,
    allIn: round.allIn,
    steps: round.steps,
    startedAt: round.startedAt.toISOString(),
    settledAt: round.settledAt?.toISOString() ?? null,
  }
}

function roomEvent(
  name: 'round.started' | 'round.action' | 'round.settled',
  round: Round<unknown, unknown>,
): Outgoing {
  return liveEvent(roomChannel(round.game), name, roundView(round), roundVersion(round))
}

// ---------------------------------------------------------------- the transaction

/**
 * One transaction's round work: the transaction, the config in force when it
 * began (every step of the request uses the same values), and the live
 * events to publish once it commits.
 */
export interface RoundTx {
  tx: Tx
  config: ConfigValues
  /** Queues events to publish after the commit. Never published if the transaction fails. */
  emit(...events: Outgoing[]): void
}

/**
 * Keeps only each player's latest wallet and leaderboard news: a bet and its
 * payout in one request then move the top bar and the leaderboard once.
 */
export function latestWalletNews(events: readonly Outgoing[]): Outgoing[] {
  const keyOf = (e: Outgoing) =>
    e.name === 'wallet.updated' || e.name === 'standing.changed'
      ? `${e.channel}|${e.name}|${String((e.envelope.data as { userId?: string }).userId ?? '')}`
      : null
  const last = new Map<string, number>()
  events.forEach((e, i) => {
    const key = keyOf(e)
    if (key) last.set(key, i)
  })
  return events.filter((e, i) => {
    const key = keyOf(e)
    return key === null || last.get(key) === i
  })
}

/** Wraps a transaction for the round helper. Its events go out through `afterCommit`. */
export async function roundTx(tx: Tx, afterCommit: AfterCommit): Promise<RoundTx> {
  const config = await loadConfig(tx)
  const queued: Outgoing[] = []
  afterCommit(() => publish(latestWalletNews(queued)))
  return { tx, config, emit: (...events) => void queued.push(...events) }
}

/**
 * Round work that no player's request keyed, such as finishing an idle round
 * or settling a shared round, in its own transaction. Its events are
 * published after the commit.
 */
export async function roundTransaction<T>(
  waitUntil: (promise: Promise<unknown>) => void,
  work: (rt: RoundTx) => Promise<T>,
): Promise<T> {
  const tasks: (() => Promise<unknown>)[] = []
  const result = await db().transaction(async (tx) =>
    work(await roundTx(tx, (task) => void tasks.push(task))),
  )
  for (const task of tasks) waitUntil(task())
  return result
}

// ---------------------------------------------------------------- start

export interface StartInput<D, S> {
  game: ServerGame
  seasonId: number
  userId: string
  /**
   * What the player typed in the bet box ("250", "2.5k", "half", "all"),
   * resolved against the locked wallet so "all" is the balance right now.
   * Or an exact amount of chips.
   */
  bet: string | bigint
  detail: D
  secret?: S
  /** For games with one round for the whole table: the shared round this bet joins. */
  sharedRoundId?: number
}

/** The stake a bet resolves to, checked against the wallet and the bet limits. */
function resolveBet(bet: string | bigint, balance: bigint, config: ConfigValues): bigint {
  const limits = { minBet: config.min_bet, maxBetPct: config.max_bet_pct }
  let amount: bigint
  if (typeof bet === 'bigint') {
    amount = bet
  } else {
    const parsed = parseBetAmount(bet, balance, limits)
    if (!parsed.ok) throw badRequest(parsed.error, 'bad_bet')
    amount = parsed.amount
  }
  const problem = checkBetAmount(amount, balance, limits)
  if (problem) throw badRequest(problem, 'bad_bet')
  return amount
}

/** Whether a stake is big enough for the room to notice (spec: Big bets get noticed). */
function isBigBet(stake: bigint, netWorth: bigint, config: ConfigValues): boolean {
  return stake * 10_000n >= netWorth * BigInt(config.big_bet_pct)
}

/**
 * Takes the stake and opens a round. Refuses when the season takes no bets,
 * the bet is outside the limits, or the player already has a round open in
 * this game.
 */
export async function startRound<D, S = never>(
  rt: RoundTx,
  input: StartInput<D, S>,
): Promise<{ round: Round<D, S>; wallet: Balances }> {
  const { tx, config } = rt
  await requireBetsOpen(tx, input.seasonId)
  const wallet = await lockWallet(tx, input.seasonId, input.userId)
  const stake = resolveBet(input.bet, wallet.balance, config)
  const allIn = stake === wallet.balance
  const bigBet = allIn || isBigBet(stake, wallet.balance + wallet.vault, config)

  let row: RoundRow | undefined
  try {
    ;[row] = await tx
      .insert(gameRounds)
      .values({
        seasonId: input.seasonId,
        userId: input.userId,
        game: input.game.id,
        stake,
        detail: input.detail ?? {},
        secret: input.secret ?? null,
        bigBet,
        allIn,
        sharedRoundId: input.sharedRoundId ?? null,
      })
      .returning(roundColumns)
  } catch (error) {
    if (isUniqueViolation(error, 'game_rounds_one_open_key')) {
      throw new ApiError(
        409,
        'round_open',
        'You already have a round going here. Finish it first, or reload the page to see it.',
      )
    }
    throw error
  }
  const round = toRound<D, S>(row as RoundRow)

  const after = await debit(tx, {
    seasonId: input.seasonId,
    userId: input.userId,
    amount: stake,
    reason: 'bet',
    refType: 'game_round',
    refId: round.id,
  })
  rt.emit(roomEvent('round.started', round), ...walletEvents(input.seasonId, input.userId, after))
  return { round, wallet: after }
}

// ---------------------------------------------------------------- finding rounds

/** Locks the player's open round in a game, or returns null when there is none. */
export async function lockOpenRound<D, S = never>(
  tx: Tx,
  where: { game: string; seasonId: number; userId: string },
): Promise<Round<D, S> | null> {
  const [row] = await tx
    .select(roundColumns)
    .from(gameRounds)
    .where(
      and(
        eq(gameRounds.seasonId, where.seasonId),
        eq(gameRounds.userId, where.userId),
        eq(gameRounds.game, where.game),
        eq(gameRounds.status, 'open'),
      ),
    )
    .for('update')
  return row ? toRound<D, S>(row) : null
}

/** Locks a round by id, or returns null. `skipLocked` passes over a round another request holds. */
export async function lockRound<D, S = never>(
  tx: Tx,
  id: number,
  options: { skipLocked?: boolean } = {},
): Promise<Round<D, S> | null> {
  const query = tx.select(roundColumns).from(gameRounds).where(eq(gameRounds.id, id))
  const [row] = await (options.skipLocked
    ? query.for('update', { skipLocked: true })
    : query.for('update'))
  return row ? toRound<D, S>(row) : null
}

/** Reads a round without locking it. For display; never decide an outcome from it. */
export async function readRound<D, S = never>(
  executor: Executor,
  id: number,
): Promise<Round<D, S> | null> {
  const [row] = await executor.select(roundColumns).from(gameRounds).where(eq(gameRounds.id, id))
  return row ? toRound<D, S>(row) : null
}

function closed(): ApiError {
  return new ApiError(409, 'round_closed', 'That round is already over.')
}

function requireOpen(round: Round<unknown, unknown>) {
  if (round.status !== 'open') throw closed()
}

// ---------------------------------------------------------------- moves

export interface RoundChange<D, S> {
  detail: D
  /** Leave out to keep the secret, null to clear it. */
  secret?: S | null
}

/** Saves a move in an open round and tells the room. Lock the round first. */
export async function actRound<D, S = never>(
  rt: RoundTx,
  round: Round<D, S>,
  change: RoundChange<D, S>,
): Promise<Round<D, S>> {
  requireOpen(round)
  const [row] = await rt.tx
    .update(gameRounds)
    .set({
      detail: change.detail ?? {},
      ...(change.secret === undefined ? {} : { secret: change.secret }),
      steps: sql`${gameRounds.steps} + 1`,
      actedAt: sql`now()`,
    })
    .where(and(eq(gameRounds.id, round.id), eq(gameRounds.status, 'open')))
    .returning(roundColumns)
  if (!row) throw closed()
  const updated = toRound<D, S>(row)
  rt.emit(roomEvent('round.action', updated))
  return updated
}

/**
 * Takes more stake into an open round, such as a double down or a split.
 * The extra is checked only against the wallet, not the bet limits: it
 * follows a bet that already passed them.
 */
export async function raiseStake<D, S = never>(
  rt: RoundTx,
  round: Round<D, S>,
  input: RoundChange<D, S> & { amount: bigint },
): Promise<{ round: Round<D, S>; wallet: Balances }> {
  requireOpen(round)
  if (input.amount <= 0n) throw badRequest('Raise by more than zero.', 'bad_bet')
  const before = await lockWallet(rt.tx, round.seasonId, round.userId)
  const after = await debit(rt.tx, {
    seasonId: round.seasonId,
    userId: round.userId,
    amount: input.amount,
    reason: 'bet',
    refType: 'game_round',
    refId: round.id,
  })
  const stake = round.stake + input.amount
  const allIn = round.allIn || after.balance === 0n
  const bigBet = round.bigBet || allIn || isBigBet(stake, before.balance + before.vault, rt.config)
  const [row] = await rt.tx
    .update(gameRounds)
    .set({
      stake,
      allIn,
      bigBet,
      detail: input.detail ?? {},
      ...(input.secret === undefined ? {} : { secret: input.secret }),
      steps: sql`${gameRounds.steps} + 1`,
      actedAt: sql`now()`,
    })
    .where(and(eq(gameRounds.id, round.id), eq(gameRounds.status, 'open')))
    .returning(roundColumns)
  if (!row) throw closed()
  const updated = toRound<D, S>(row)
  rt.emit(roomEvent('round.action', updated), ...walletEvents(round.seasonId, round.userId, after))
  return { round: updated, wallet: after }
}

/**
 * Hands part of an open round's stake back and keeps the round open, such as
 * one bet taken off a roulette table before betting closes. To hand back the
 * whole stake, refund the round. What is left is not checked against the bet
 * limits: it is what remains of bets that passed them.
 */
export async function lowerStake<D, S = never>(
  rt: RoundTx,
  round: Round<D, S>,
  input: RoundChange<D, S> & { amount: bigint },
): Promise<{ round: Round<D, S>; wallet: Balances }> {
  requireOpen(round)
  if (input.amount <= 0n) throw badRequest('Lower by more than zero.', 'bad_bet')
  if (input.amount >= round.stake) {
    throw badRequest('That would hand back the whole bet. Refund the round instead.', 'bad_bet')
  }
  const after = await credit(rt.tx, {
    seasonId: round.seasonId,
    userId: round.userId,
    amount: input.amount,
    reason: 'refund',
    refType: 'game_round',
    refId: round.id,
  })
  const stake = round.stake - input.amount
  const [row] = await rt.tx
    .update(gameRounds)
    .set({
      stake,
      // Chips went back to the wallet, so this is no longer everything the player had.
      allIn: false,
      // Measured as when a bet is placed: against what the player held before staking it.
      bigBet: isBigBet(stake, after.balance + after.vault + stake, rt.config),
      detail: input.detail ?? {},
      ...(input.secret === undefined ? {} : { secret: input.secret }),
      steps: sql`${gameRounds.steps} + 1`,
      actedAt: sql`now()`,
    })
    .where(and(eq(gameRounds.id, round.id), eq(gameRounds.status, 'open')))
    .returning(roundColumns)
  if (!row) throw closed()
  const updated = toRound<D, S>(row)
  rt.emit(roomEvent('round.action', updated), ...walletEvents(round.seasonId, round.userId, after))
  return { round: updated, wallet: after }
}

// ---------------------------------------------------------------- the end

export interface Outcome<D> {
  /**
   * Everything paid back, stake included, in chips: 0 for a loss, the
   * stake for a push, twice the stake for an even-money win. Round down
   * (shared/chips.ts mulDiv) before passing it.
   */
  payout: bigint
  /** The final public state, enough to replay the round. */
  detail: D
  /** One line for the ticker and History, such as "Heads" or "Blackjack". */
  summary: string
  /**
   * The multiplier to show, when it is not simply payout / stake, such as a
   * crash cash-out point. Display only.
   */
  multiplier?: number
}

const MULTIPLIER_SCALE = 10_000n

/** payout / stake to four decimals, rounded down, as numeric text. */
function ratio(payout: bigint, stake: bigint): string {
  const scaled = (payout * MULTIPLIER_SCALE) / stake
  const whole = scaled / MULTIPLIER_SCALE
  const rest = (scaled % MULTIPLIER_SCALE).toString().padStart(4, '0')
  return `${whole}.${rest}`
}

/**
 * Pays out and closes a round. Writes the payout to the ledger, publishes
 * the result to the room, the ticker and the leaderboard, and posts big wins
 * and big losses in chat. Lock the round first.
 */
export async function settleRound<D, S = never>(
  rt: RoundTx,
  game: ServerGame,
  round: Round<D, S>,
  outcome: Outcome<D>,
): Promise<{ round: Round<D, S>; wallet: Balances | null }> {
  requireOpen(round)
  if (outcome.payout < 0n) throw new Error('A payout cannot be negative')
  const summary = outcome.summary.trim().slice(0, 120)
  const multiplier =
    outcome.multiplier === undefined
      ? ratio(outcome.payout, round.stake)
      : Math.max(0, outcome.multiplier).toFixed(4)

  const [row] = await rt.tx
    .update(gameRounds)
    .set({
      status: 'settled',
      payout: outcome.payout,
      multiplier,
      detail: outcome.detail ?? {},
      summary,
      secret: null,
      steps: sql`${gameRounds.steps} + 1`,
      actedAt: sql`now()`,
      settledAt: sql`now()`,
    })
    .where(and(eq(gameRounds.id, round.id), eq(gameRounds.status, 'open')))
    .returning(roundColumns)
  if (!row) throw closed()
  const settled = toRound<D, S>(row)

  let wallet: Balances | null = null
  if (outcome.payout > 0n) {
    wallet = await credit(rt.tx, {
      seasonId: round.seasonId,
      userId: round.userId,
      amount: outcome.payout,
      reason: 'payout',
      refType: 'game_round',
      refId: round.id,
    })
  }

  const view = roundView(settled)
  const ticker: Publishable<RoundSummary> = {
    seasonId: settled.seasonId,
    roundId: settled.id,
    game: settled.game,
    userId: settled.userId,
    stake: settled.stake,
    payout: outcome.payout,
    net: outcome.payout - settled.stake,
    multiplier: view.multiplier,
    summary,
    bigBet: settled.bigBet,
  }
  rt.emit(
    roomEvent('round.settled', settled),
    liveEvent('feed', 'round.settled', ticker, settled.id),
  )
  if (wallet) rt.emit(...walletEvents(round.seasonId, round.userId, wallet))

  const post = await bigResultPost(rt, game, settled, view.multiplier ?? 0)
  if (post) rt.emit(post)
  return { round: settled, wallet }
}

/**
 * The chat post for a big result (spec: Results travel), or null. A big win
 * pays big_win_times the stake or more, or wins an all-in. A big loss loses
 * a big bet.
 */
async function bigResultPost(
  rt: RoundTx,
  game: ServerGame,
  round: Round<unknown, unknown>,
  multiplier: number,
): Promise<Outgoing | null> {
  const payout = round.payout ?? 0n
  const won = payout > round.stake
  const bigWin = won && (round.allIn || payout >= round.stake * BigInt(rt.config.big_win_times))
  const bigLoss = payout < round.stake && round.bigBet
  if (!bigWin && !bigLoss) return null

  const [player] = await rt.tx
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, round.userId))
  const name = player?.name ?? 'Someone'
  let body: string
  if (bigWin) {
    const net = formatChips(payout - round.stake)
    body = round.allIn
      ? `${name} went all in on ${game.name} and won ${net}`
      : `${name} won ${net} on ${game.name}, ${formatMultiplier(multiplier)} the bet`
  } else {
    const lost = formatChips(round.stake - payout)
    body = round.allIn
      ? `${name} went all in on ${game.name} and lost ${lost}`
      : `${name} lost ${lost} on ${game.name}`
  }
  const meta: SystemMeta = {
    tone: bigWin ? 'win' : 'loss',
    userId: round.userId,
    roundId: round.id,
    game: round.game,
  }
  return systemPost(rt.tx, body, meta)
}

/**
 * Closes a round without a result and hands the whole stake back, such as
 * a russian roulette lobby nobody joined. It leaves the ticker and chat
 * alone. Lock the round first.
 */
export async function refundRound<D, S = never>(
  rt: RoundTx,
  round: Round<D, S>,
  outcome: { detail: D; summary: string },
): Promise<{ round: Round<D, S>; wallet: Balances }> {
  requireOpen(round)
  const [row] = await rt.tx
    .update(gameRounds)
    .set({
      status: 'void',
      payout: round.stake,
      multiplier: ratio(1n, 1n),
      detail: outcome.detail ?? {},
      summary: outcome.summary.trim().slice(0, 120),
      secret: null,
      steps: sql`${gameRounds.steps} + 1`,
      actedAt: sql`now()`,
      settledAt: sql`now()`,
    })
    .where(and(eq(gameRounds.id, round.id), eq(gameRounds.status, 'open')))
    .returning(roundColumns)
  if (!row) throw closed()
  const voided = toRound<D, S>(row)
  const wallet = await credit(rt.tx, {
    seasonId: round.seasonId,
    userId: round.userId,
    amount: round.stake,
    reason: 'refund',
    refType: 'game_round',
    refId: round.id,
  })
  rt.emit(roomEvent('round.settled', voided), ...walletEvents(round.seasonId, round.userId, wallet))
  return { round: voided, wallet }
}

// ---------------------------------------------------------------- one player's request

/** What a play or action endpoint returns: the round and the player's wallet after it. */
export interface PlayOut<D = unknown> {
  round: RoundOut<D>
  wallet: { seasonId: number; balance: bigint; vault: bigint; version: number }
}

/**
 * One player's request in one game: the round helper bound to the player,
 * the season and the transaction. `playTransaction` hands it to you.
 */
export class Play {
  readonly rt: RoundTx
  readonly game: ServerGame
  readonly seasonId: number
  readonly userId: string
  private wallet: Balances | null = null

  constructor(rt: RoundTx, game: ServerGame, seasonId: number, userId: string) {
    this.rt = rt
    this.game = game
    this.seasonId = seasonId
    this.userId = userId
  }

  get tx(): Tx {
    return this.rt.tx
  }

  /** Config as it was when the request began. Store what a round depends on in its detail. */
  get config(): ConfigValues {
    return this.rt.config
  }

  private track(wallet: Balances | null) {
    if (wallet) this.wallet = wallet
  }

  private mine(round: Round<unknown, unknown>) {
    if (round.userId !== this.userId || round.game !== this.game.id) {
      throw new Error(`Round ${round.id} is not this player's ${this.game.id} round`)
    }
  }

  /** Takes the stake and opens a round. */
  async start<D, S = never>(input: Omit<StartInput<D, S>, 'game' | 'seasonId' | 'userId'>) {
    const { round, wallet } = await startRound(this.rt, {
      ...input,
      game: this.game,
      seasonId: this.seasonId,
      userId: this.userId,
    })
    this.track(wallet)
    return round
  }

  /** The player's open round in this game, locked, or null. */
  current<D, S = never>(): Promise<Round<D, S> | null> {
    return lockOpenRound<D, S>(this.tx, {
      game: this.game.id,
      seasonId: this.seasonId,
      userId: this.userId,
    })
  }

  /** The player's open round, locked. Refuses when there is none. */
  async require<D, S = never>(): Promise<Round<D, S>> {
    const round = await this.current<D, S>()
    if (!round) {
      throw new ApiError(409, 'no_round', 'You have no round going here. Place a bet first.')
    }
    return round
  }

  /** Saves a move and tells the room. */
  act<D, S = never>(round: Round<D, S>, change: RoundChange<D, S>): Promise<Round<D, S>> {
    this.mine(round)
    return actRound(this.rt, round, change)
  }

  /** Takes more stake into the round, such as a double down. */
  async raise<D, S = never>(round: Round<D, S>, input: RoundChange<D, S> & { amount: bigint }) {
    this.mine(round)
    const raised = await raiseStake(this.rt, round, input)
    this.track(raised.wallet)
    return raised.round
  }

  /** Hands part of the stake back and keeps the round open, such as one bet taken off the table. */
  async lower<D, S = never>(round: Round<D, S>, input: RoundChange<D, S> & { amount: bigint }) {
    this.mine(round)
    const lowered = await lowerStake(this.rt, round, input)
    this.track(lowered.wallet)
    return lowered.round
  }

  /** Pays out and closes the round. */
  async settle<D, S = never>(round: Round<D, S>, outcome: Outcome<D>): Promise<Round<D, S>> {
    this.mine(round)
    const settled = await settleRound(this.rt, this.game, round, outcome)
    this.track(settled.wallet)
    return settled.round
  }

  /** Closes the round and hands the stake back. */
  async refund<D, S = never>(round: Round<D, S>, outcome: { detail: D; summary: string }) {
    this.mine(round)
    const refunded = await refundRound(this.rt, round, outcome)
    this.track(refunded.wallet)
    return refunded.round
  }

  /** The response: the round as everyone sees it, and the player's wallet now. */
  async result<D>(round: Round<D, unknown>): Promise<PlayOut<D>> {
    let wallet = this.wallet
    if (!wallet) {
      const read = await readWallet(this.tx, this.seasonId, this.userId)
      if (!read) throw new Error('The player has no wallet')
      wallet = { balance: read.balance, vault: read.vault, tier: read.tier, ledgerId: read.version }
    }
    return {
      round: roundView(round),
      wallet: {
        seasonId: this.seasonId,
        balance: wallet.balance,
        vault: wallet.vault,
        version: wallet.ledgerId,
      },
    }
  }
}

/**
 * Runs one player's request in one game: finds the season, claims the
 * idempotency key, and hands you a `Play` inside one transaction. Events go
 * out after the commit, and a repeated key returns the first response.
 * Declare the route `idempotent: true`.
 *
 * New bets need a season taking bets; a round already open can still be
 * played out after the season's end.
 */
export async function playTransaction<T>(
  ctx: ChipRequest,
  game: ServerGame,
  work: (play: Play) => Promise<T>,
): Promise<Wire<T>> {
  const user = ctx.user
  if (!user) throw new Error(`${ctx.action}: playTransaction needs a logged-in player`)
  const season = await currentSeason()
  if (!season) throw new ApiError(409, 'no_season', 'There is no season yet.')
  return chipTransaction(ctx, async (tx, afterCommit) => {
    const rt = await roundTx(tx, afterCommit)
    return work(new Play(rt, game, season.id, user.id))
  })
}

// ---------------------------------------------------------------- the room

/** How long a settled round stays on its player's seat. */
const SEAT_RESULT_MINUTES = 10

/**
 * Each player's latest round in a game: the open one, or the last one if it
 * ended in the last few minutes. What a seat shows when someone walks in.
 */
export async function roomRounds(
  executor: Executor,
  game: string,
  seasonId: number,
): Promise<Round[]> {
  const found = await executor
    .selectDistinctOn([gameRounds.userId], roundColumns)
    .from(gameRounds)
    .where(
      and(
        eq(gameRounds.seasonId, seasonId),
        eq(gameRounds.game, game),
        or(
          eq(gameRounds.status, 'open'),
          gt(gameRounds.settledAt, sql`now() - make_interval(mins => ${SEAT_RESULT_MINUTES})`),
        ),
      ),
    )
    .orderBy(gameRounds.userId, desc(gameRounds.id))
  return found.map((row) => toRound(row))
}

/**
 * Finishes this game's open rounds left idle past round_timeout_minutes,
 * by the game's safest rule (spec: Abandoned rounds settle safely):
 * `finish` gets a Play for the round's player and must settle or refund it.
 * Call it from the room endpoint, so no timer wakes the database. Returns
 * how many rounds it finished.
 */
export async function finishIdleRounds<D, S = never>(
  game: ServerGame,
  waitUntil: (promise: Promise<unknown>) => void,
  finish: (play: Play, round: Round<D, S>) => Promise<void>,
): Promise<number> {
  const { round_timeout_minutes } = await loadConfig(db())
  const idle = await db()
    .select({ id: gameRounds.id })
    .from(gameRounds)
    .where(
      and(
        eq(gameRounds.game, game.id),
        eq(gameRounds.status, 'open'),
        lt(gameRounds.actedAt, sql`now() - make_interval(mins => ${round_timeout_minutes})`),
      ),
    )
    .orderBy(gameRounds.actedAt)
    .limit(20)

  let finished = 0
  for (const { id } of idle) {
    const done = await roundTransaction(waitUntil, async (rt) => {
      // Another request may be finishing or playing it right now: skip it.
      const round = await lockRound<D, S>(rt.tx, id, { skipLocked: true })
      if (!round || round.status !== 'open') return false
      const [still] = await rt.tx
        .select({
          idle: sql<boolean>`${gameRounds.actedAt} < now() - make_interval(mins => ${round_timeout_minutes})`,
        })
        .from(gameRounds)
        .where(eq(gameRounds.id, id))
      if (!still?.idle) return false
      await finish(new Play(rt, game, round.seasonId, round.userId), round)
      const [after] = await rt.tx
        .select({ status: gameRounds.status })
        .from(gameRounds)
        .where(eq(gameRounds.id, id))
      if (after?.status === 'open') {
        throw new Error(`${game.id}: finishing idle round ${id} left it open`)
      }
      return true
    }).catch((error: unknown) => {
      // One stuck round must not keep everyone out of the room.
      console.error(`[rounds] could not finish idle ${game.id} round ${id}`, error)
      return false
    })
    if (done) finished++
  }
  return finished
}

/** GET /api/<game>/room: each seated player's latest round. */
export async function roomState(game: ServerGame): Promise<{ rounds: RoundOut[] }> {
  const season = await currentSeason()
  if (!season) return { rounds: [] }
  const rounds = await roomRounds(db(), game.id, season.id)
  return { rounds: rounds.map((round) => roundView(round)) }
}
