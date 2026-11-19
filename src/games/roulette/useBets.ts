/**
 * Your bets on the spin taking bets now (spec: Roulette > Bets and payouts,
 * Keys). A chip lands on the felt the instant you click, and the server
 * hears about it a moment later: moves queue up and go out in order, every
 * bet that piled up in one request, so fast clicking never waits for the
 * network and never places a chip twice. The server still decides: each
 * request carries its own idempotency key, and a refusal takes the chips
 * back off with a toast.
 *
 * Every move can be undone until betting closes, the last spin's bets go
 * down again with one key, and the table can be doubled or cleared.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { type BetLimits, checkBetAmount, parseBetAmount } from '../../../shared/bet-amount.ts'
import { chipCount, formatChips } from '../../../shared/chips.ts'
import {
  addBets,
  betsTotal,
  MAX_BETS_PER_REQUEST,
  removeBet,
  ROULETTE,
  type RouletteBet,
  type RouletteClock,
  type RouletteDetail,
  spotById,
} from '../../../shared/games/roulette.ts'
import type { PlayResult, RoomState, RoundView } from '../../../shared/rounds.ts'
import {
  api,
  ApiError,
  applyRound,
  applyWallet,
  errorMessage,
  requestKey,
  roomKey,
  toast,
} from '../../kit/index.ts'
import { amountText } from './chips.ts'

type Move =
  | { kind: 'add'; spin: number; spot: string; amount: bigint; text: string }
  | { kind: 'remove'; spin: number; spot: string; amount: bigint | null }
  | { kind: 'clear'; spin: number }

type Queued = Move & { id: number }

interface Book {
  /** Moves not yet answered, oldest first. */
  queue: readonly Queued[]
  /** While a request is out: the server's bets on its spin as they were when it left. */
  flight: { spin: number; base: RouletteBet[] } | null
  /** What undoes each of your moves on a spin, newest last. */
  history: readonly { spin: number; undo: Move[] }[]
}

function createBook() {
  let state: Book = { queue: [], flight: null, history: [] }
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(next: Partial<Book>) {
      state = { ...state, ...next }
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** The bets the server holds for you on `spin`. */
export function serverBets(round: RoundView<RouletteDetail> | null, spin: number): RouletteBet[] {
  if (!round || round.detail.spin !== spin || round.status === 'void') return []
  return round.detail.bets
}

function apply(bets: RouletteBet[], move: Move): RouletteBet[] {
  switch (move.kind) {
    case 'add':
      return addBets(bets, [{ spot: move.spot, amount: move.amount }])
    case 'remove': {
      const on = bets.find((b) => b.spot === move.spot)
      if (!on) return bets
      return removeBet(bets, move.spot, move.amount ?? BigInt(on.amount))
    }
    case 'clear':
      return []
  }
}

const LAST_KEY = (userId: string) => `anzul.roulette.last.${userId}`

function readLast(userId: string): RouletteBet[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(LAST_KEY(userId)) ?? '[]')
    if (!Array.isArray(saved)) return []
    return saved.filter(
      (b): b is RouletteBet =>
        typeof b === 'object' &&
        b !== null &&
        typeof (b as RouletteBet).spot === 'string' &&
        Number.isSafeInteger((b as RouletteBet).amount) &&
        (b as RouletteBet).amount > 0,
    )
  } catch {
    return []
  }
}

function saveLast(userId: string, bets: readonly RouletteBet[]): void {
  try {
    localStorage.setItem(LAST_KEY(userId), JSON.stringify(bets))
  } catch {
    // Storage is off: Repeat works from the room's last round instead.
  }
}

export interface BetsOptions {
  me: string
  /** Your latest round in the room. */
  mine: RoundView<RouletteDetail> | null
  /** The spin taking bets now, or null while none is. */
  open: number | null
  /** Why no bet can go down now ("No more bets."), when `open` is null or the season is shut. */
  closed: string | null
  balance: bigint
  limits: BetLimits | null
  /** Takes the clock a refused bet brings back. */
  adopt: (clock: RouletteClock) => void
}

export type PlaceResult = { ok: true; amount: bigint } | { ok: false; error: string }

export interface Bets {
  /** Your bets on `spin` as the table shows them: the server's, with your newest moves on top. */
  on: (spin: number) => RouletteBet[]
  /** Your bets on the open spin. */
  current: RouletteBet[]
  /** Moves on `spin` still on their way. */
  pending: (spin: number) => boolean
  /** The server holds bets of yours on `spin`. */
  confirmed: (spin: number) => boolean
  /** Chips you can still put down: the wallet less what is on its way to the table. */
  available: bigint
  /** Puts bets on the open spin: all of them, or none with the reason. */
  place: (bets: readonly { spot: string; text: string }[]) => PlaceResult
  /** Takes every chip of yours off one spot. */
  remove: (spot: string) => PlaceResult
  clear: () => PlaceResult
  undo: () => PlaceResult
  canUndo: boolean
  /** Your bets from the last spin you played. */
  last: RouletteBet[]
  repeat: () => PlaceResult
  double: () => PlaceResult
}

export function useBets(options: BetsOptions): Bets {
  const { me, mine, open, closed, balance, limits } = options
  const queryClient = useQueryClient()
  const [book] = useState(createBook)
  const state = useSyncExternalStore(book.subscribe, book.get, book.get)
  const sending = useRef(false)
  const nextId = useRef(1)
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })

  // ------------------------------------------------------------ what the table shows

  // The room's cache, read directly: it has a response's round the moment it
  // arrives, a moment before the room's query passes it on.
  const roundOf = (userId: string) =>
    queryClient
      .getQueryData<RoomState<RouletteDetail>>(roomKey(ROULETTE))
      ?.rounds.find((r) => r.userId === userId) ?? null

  function on(spin: number): RouletteBet[] {
    let bets = state.flight?.spin === spin ? state.flight.base : serverBets(roundOf(me), spin)
    for (const move of state.queue) if (move.spin === spin) bets = apply(bets, move)
    return bets
  }

  const onTheWay = state.queue.reduce(
    (sum, move) => (move.kind === 'add' ? sum + move.amount : sum),
    0n,
  )
  const available = balance > onTheWay ? balance - onTheWay : 0n
  const current = open === null ? [] : on(open)

  // The last spin you played, for Repeat: the room's round, or what this browser kept.
  const [stored] = useState<RouletteBet[]>(() => readLast(me))
  const settledBets =
    mine && mine.status === 'settled' && mine.detail.bets.length > 0 ? mine.detail.bets : null
  useEffect(() => {
    if (settledBets) saveLast(me, settledBets)
  }, [me, settledBets])
  const fromRoom =
    mine && mine.detail.spin !== open && mine.status !== 'void' ? mine.detail.bets : []
  const last = fromRoom.length > 0 ? fromRoom : (settledBets ?? stored)

  // ------------------------------------------------------------ sending

  async function post(batch: Queued[]): Promise<PlayResult<RouletteDetail>> {
    const first = batch[0] as Queued
    const key = requestKey()
    if (first.kind === 'add') {
      const bets = batch.flatMap((m) => (m.kind === 'add' ? [{ spot: m.spot, bet: m.text }] : []))
      return api.post('/api/roulette/bet', { spin: first.spin, bets }, { key })
    }
    if (first.kind === 'remove') {
      const amount = first.amount === null ? {} : { amount: Number(first.amount) }
      return api.post(
        '/api/roulette/remove',
        { spin: first.spin, spot: first.spot, ...amount },
        { key },
      )
    }
    return api.post('/api/roulette/clear', { spin: first.spin }, { key })
  }

  async function pump() {
    if (sending.current) return
    sending.current = true
    try {
      for (;;) {
        const { queue } = book.get()
        const first = queue[0]
        if (!first) break
        let batch: Queued[] = [first]
        if (first.kind === 'add') {
          batch = []
          for (const move of queue) {
            if (move.kind !== 'add' || move.spin !== first.spin) break
            batch.push(move)
            if (batch.length >= MAX_BETS_PER_REQUEST) break
          }
        }
        book.set({
          flight: { spin: first.spin, base: serverBets(roundOf(latest.current.me), first.spin) },
        })
        const sent = new Set(batch.map((m) => m.id))
        try {
          const result = await post(batch)
          applyRound(queryClient, result.round)
          applyWallet(queryClient, result.wallet)
          book.set({ queue: book.get().queue.filter((m) => !sent.has(m.id)), flight: null })
        } catch (error) {
          refused(error, first.spin, sent)
        }
      }
    } finally {
      sending.current = false
    }
  }

  function refused(error: unknown, spin: number, sent: ReadonlySet<number>) {
    const clock =
      error instanceof ApiError ? (error.extra.clock as RouletteClock | undefined) : undefined
    if (clock) latest.current.adopt(clock)
    const late =
      error instanceof ApiError && (error.code === 'spin_closed' || error.code === 'spin_not_open')
    // A closed spin refuses everything still queued for it, so it all comes off
    // now. Undo forgets the spin's moves: they no longer match the table.
    const queue = book.get().queue.filter((m) => !(sent.has(m.id) || (late && m.spin === spin)))
    const history = book.get().history.filter((h) => h.spin !== spin)
    book.set({ queue, flight: null, history })
    toast.error(errorMessage(error))
    void queryClient.invalidateQueries({ queryKey: roomKey(ROULETTE) })
  }

  function enqueue(moves: Move[], undo: Move[] | null) {
    const { queue, history } = book.get()
    const queued = moves.map((m) => ({ ...m, id: nextId.current++ }))
    const spin = moves[0]?.spin
    book.set({
      queue: [...queue, ...queued],
      history: undo && spin !== undefined ? [...history, { spin, undo }].slice(-50) : history,
    })
    void pump()
  }

  // Undo is for the open spin only: its moves are forgotten when it closes.
  useEffect(() => {
    const { history } = book.get()
    if (history.some((h) => h.spin !== open)) {
      book.set({ history: history.filter((h) => h.spin === open) })
    }
  }, [book, open])

  // ------------------------------------------------------------ moves

  function shut(): string | null {
    if (closed) return closed
    if (open === null) return 'No more bets.'
    if (!limits) return 'The table is still loading.'
    return null
  }

  /** Works out each typed amount against what is left, as the server will. */
  function resolve(
    bets: readonly { spot: string; text: string }[],
    left: bigint,
    lim: BetLimits,
  ): { ok: true; amounts: bigint[]; total: bigint } | { ok: false; error: string } {
    const amounts: bigint[] = []
    let total = 0n
    for (const bet of bets) {
      const parsed = parseBetAmount(bet.text, left, lim)
      const problem = parsed.ok ? checkBetAmount(parsed.amount, left, lim) : parsed.error
      if (problem || !parsed.ok) {
        const where = bets.length > 1 ? `${spotById(bet.spot).name}: ` : ''
        return { ok: false, error: `${where}${problem ?? 'That is not an amount.'}` }
      }
      amounts.push(parsed.amount)
      total += parsed.amount
      left -= parsed.amount
    }
    return { ok: true, amounts, total }
  }

  function place(bets: readonly { spot: string; text: string }[]): PlaceResult {
    const why = shut()
    if (why || open === null || !limits) return { ok: false, error: why ?? 'No more bets.' }
    if (bets.length === 0) return { ok: false, error: 'Pick a place on the table.' }
    const resolved = resolve(bets, available, limits)
    if (!resolved.ok) return resolved
    const moves: Move[] = []
    const undo: Move[] = []
    bets.forEach((bet, i) => {
      const amount = resolved.amounts[i] as bigint
      moves.push({ kind: 'add', spin: open, spot: bet.spot, amount, text: bet.text })
      undo.push({ kind: 'remove', spin: open, spot: bet.spot, amount })
    })
    enqueue(moves, undo)
    return { ok: true, amount: resolved.total }
  }

  function placeAll(bets: readonly RouletteBet[], what: string): PlaceResult {
    const why = shut()
    if (why) return { ok: false, error: why }
    const total = betsTotal(bets)
    if (total > available) {
      return {
        ok: false,
        error: `${what} come to ${formatChips(total)}, and you have ${chipCount(available)}.`,
      }
    }
    return place(bets.map((b) => ({ spot: b.spot, text: amountText(BigInt(b.amount)) })))
  }

  function remove(spot: string): PlaceResult {
    const why = shut()
    if (why || open === null) return { ok: false, error: why ?? 'No more bets.' }
    const there = current.find((b) => b.spot === spot)
    if (!there) return { ok: false, error: `You have no chips on ${spotById(spot).name}.` }
    const amount = BigInt(there.amount)
    enqueue(
      [{ kind: 'remove', spin: open, spot, amount: null }],
      [{ kind: 'add', spin: open, spot, amount, text: amountText(amount) }],
    )
    return { ok: true, amount }
  }

  function clear(): PlaceResult {
    const why = shut()
    if (why || open === null) return { ok: false, error: why ?? 'No more bets.' }
    if (current.length === 0) return { ok: false, error: 'You have no bets on this spin.' }
    const undo: Move[] = current.map((b) => ({
      kind: 'add',
      spin: open,
      spot: b.spot,
      amount: BigInt(b.amount),
      text: amountText(BigInt(b.amount)),
    }))
    enqueue([{ kind: 'clear', spin: open }], undo)
    return { ok: true, amount: betsTotal(current) }
  }

  function undo(): PlaceResult {
    const why = shut()
    if (why || open === null) return { ok: false, error: why ?? 'No more bets.' }
    const { history } = book.get()
    const entry = history.at(-1)
    if (!entry || entry.spin !== open) return { ok: false, error: 'Nothing to undo.' }
    // Take back only what is still there, and give back only what was taken.
    const moves = entry.undo.filter(
      (m) => m.kind !== 'remove' || current.some((b) => b.spot === m.spot),
    )
    book.set({ history: history.slice(0, -1) })
    if (moves.length === 0) return { ok: false, error: 'Nothing to undo.' }
    enqueue(moves, null)
    const amount = moves.reduce((sum, m) => (m.kind === 'clear' ? sum : sum + (m.amount ?? 0n)), 0n)
    return { ok: true, amount }
  }

  return {
    on,
    current,
    pending: (spin) => state.queue.some((m) => m.spin === spin && m.kind === 'add'),
    confirmed: (spin) =>
      mine !== null &&
      mine.status === 'open' &&
      mine.detail.spin === spin &&
      mine.detail.bets.length > 0,
    available,
    place,
    remove,
    clear,
    undo,
    canUndo: open !== null && state.history.some((h) => h.spin === open),
    last,
    repeat: () =>
      current.length > 0
        ? { ok: false, error: 'You already have bets down. Press D to double them.' }
        : last.length === 0
          ? { ok: false, error: 'No bets from your last spin to repeat.' }
          : placeAll(last, 'Your last bets'),
    double: () =>
      current.length === 0
        ? { ok: false, error: 'Put some chips down first.' }
        : placeAll(current, 'Your bets'),
  }
}
