/**
 * The roulette room (spec: Roulette): one wheel and one table for everyone.
 *
 * - useSpins runs the wheel from the server's clock: betting, the close,
 *   the spin and the landing, the same on every screen.
 * - useBets puts your chips down the instant you click and sends them in
 *   order, with undo, repeat, double and clear.
 * - The felt shows every player's chips in their color, the wheel spins
 *   the ball onto the number, and the controls hold the quick-bet box.
 *
 * On a wide screen the wheel stands beside the felt. On a phone the felt
 * turns upright, and the wheel comes up big while it spins.
 */
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { formatChips } from '../../../shared/chips.ts'
import {
  betsTotal,
  paysTo,
  ROULETTE,
  type RouletteDetail,
  pocketColor,
  settleBets,
  type Spot,
  spotById,
} from '../../../shared/games/roulette.ts'
import type { PlayerSummary } from '../../../shared/players.ts'
import type { RoomState, RoundView } from '../../../shared/rounds.ts'
import {
  api,
  Button,
  celebrate,
  closedReason,
  isBigWin,
  playSound,
  RoomLayout,
  roomKey,
  serverNow,
  toast,
  TOUCH,
  useConfig,
  useMe,
  useMediaQuery,
  useNow,
  usePlayers,
  useRoom,
  useSeason,
} from '../../kit/index.ts'
import { amountText, chipRack, readChip, saveChip } from './chips.ts'
import { Controls } from './Controls.tsx'
import { Felt, type FeltChip } from './Felt.tsx'
import { tableLayout } from './layout.ts'
import manifest from './manifest.ts'
import { type MyResult, numberWords, POCKET_FILL, RecentStrip, StatusBar } from './Status.tsx'
import { type Bets, useBets } from './useBets.ts'
import { type Spins, useSpins } from './useSpins.ts'
import { Wheel } from './Wheel.tsx'

const NO_ROUNDS: RoundView<RouletteDetail>[] = []

/** Below this width the felt stands upright; at this width and up the wheel goes beside it. */
const TALL_BELOW = 480
const SIDE_BY_SIDE = 760
/** The big wheel on a phone stays this long after the ball lands. */
const OVERLAY_AFTER_MS = 1_800

function colorOf(player: Pick<PlayerSummary, 'avatarColor'> | undefined): string {
  return `var(--avatar-${player?.avatarColor ?? 'violet'})`
}

/**
 * The width of an element, as it changes. A callback ref, since the room
 * shows a placeholder first and the element comes later.
 */
function useWidth(): [(el: HTMLElement | null) => () => void, number] {
  const [width, setWidth] = useState(0)
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el) return () => {}
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

function InfoLine({
  spot,
  chips,
  nameOf,
  chip,
  touch,
}: {
  spot: string | null
  chips: ReadonlyMap<string, readonly FeltChip[]>
  nameOf: (userId: string) => string
  chip: bigint
  touch: boolean
}) {
  if (spot) {
    const s = spotById(spot)
    const there = chips.get(spot) ?? []
    return (
      <p className="flex min-h-5 min-w-0 items-baseline gap-x-2 truncate text-xs md:text-sm">
        <span className="font-semibold">{s.name}</span>
        <span className="text-muted">pays {paysTo(s)} to 1</span>
        {there.map((c) => (
          <span key={c.userId} className="tabular-nums" style={{ color: c.color }}>
            {c.me ? 'You' : nameOf(c.userId)} {formatChips(c.amount)}
          </span>
        ))}
      </p>
    )
  }
  return (
    <p className="min-h-5 truncate text-xs text-faint md:text-sm">
      {touch
        ? `Tap a place to bet ${formatChips(chip)}. Hold it to take your chips off.`
        : `Click a place to bet ${formatChips(chip)}. Right-click takes your chips off.`}
    </p>
  )
}

/**
 * A bet's name on a seat, where room is short: a split or corner by its
 * numbers ("17/20"), a street or line by its first and last ("13-18").
 */
function seatName(spot: Spot): string {
  const { kind, numbers } = spot
  if (kind === 'split' || kind === 'corner') return numbers.join('/')
  if (kind === 'street' || kind === 'line') {
    // The trios with zero are not a run of numbers.
    return numbers[0] === 0 ? numbers.join('/') : `${numbers[0]}-${numbers[numbers.length - 1]}`
  }
  return spot.name
}

/** Another player's bets on the spin the table shows, in their seat. */
function SeatBets({
  round,
  spin,
}: {
  round: RoundView<RouletteDetail> | null
  spin: number | null
}) {
  const bets =
    round && spin !== null && round.detail.spin === spin && round.status !== 'void'
      ? round.detail.bets
      : []
  if (!round || bets.length === 0) {
    return <p className="py-1 text-xs text-faint">No bets this spin</p>
  }
  const wins = new Set(round.status === 'settled' ? round.detail.wins : [])
  const shown = bets.slice(0, 3)
  return (
    <ul className="flex flex-wrap justify-center gap-1 py-0.5">
      {shown.map((b) => (
        <li
          key={b.spot}
          className={`rounded px-1.5 py-0.5 text-[0.7rem] tabular-nums ${
            wins.has(b.spot) ? 'bg-gold/15 text-gold' : 'bg-surface-2 text-muted'
          }`}
        >
          {seatName(spotById(b.spot))}{' '}
          <span className="font-semibold text-text">{formatChips(b.amount)}</span>
        </li>
      ))}
      {bets.length > shown.length && (
        <li className="px-1 py-0.5 text-[0.7rem] text-faint">+{bets.length - shown.length}</li>
      )}
    </ul>
  )
}

/** Beside the small wheel: what it is doing, and the number with your result once it lands. */
function Caption({ spins, result }: { spins: Spins; result: MyResult | null }) {
  const { stage, number, shown } = spins
  let body
  if (stage === 'landed' && number !== null) {
    const mine = result?.spin === shown?.spin ? result : null
    const net = mine ? mine.payout - mine.stake : 0n
    body = (
      <motion.p
        key={`landed-${shown?.spin}`}
        className="flex flex-wrap items-baseline gap-x-2 leading-tight"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <span className="text-lg font-bold">{numberWords(number)}</span>
        {mine && mine.stake > 0n && (
          <span
            className={`font-semibold tabular-nums ${
              net > 0n ? 'text-gold' : net < 0n ? 'text-loss' : 'text-muted'
            }`}
          >
            {net > 0n ? `+${formatChips(net)}` : net < 0n ? `−${formatChips(-net)}` : 'Even'}
          </span>
        )}
      </motion.p>
    )
  } else if (stage === 'spinning') {
    body = (
      <p key="spinning" className="font-semibold text-muted">
        {serverNow() - (shown?.closesAt ?? 0) < 1_300 ? 'No more bets' : 'Spinning…'}
      </p>
    )
  } else if (stage === 'empty') {
    body = (
      <p key="empty" className="text-sm text-muted">
        Nobody bet, so the wheel rests.
      </p>
    )
  } else {
    body = (
      <p key="betting" className="font-semibold">
        Place your bets
      </p>
    )
  }
  return <div className="flex min-h-7 items-center">{body}</div>
}

/**
 * The middle of the wheel: the seconds left to bet, then the number once
 * the ball lands. Sized to the wheel, so it works big and small.
 */
function Hub({ spins }: { spins: Spins }) {
  useNow(250)
  const reduced = useReducedMotion()
  const { stage, shown, number } = spins
  let body = null
  if (stage === 'landed' && number !== null) {
    body = (
      <motion.span
        key={`n-${shown?.spin}`}
        className="grid size-[30cqw] place-items-center rounded-[7cqw] text-[15cqw] font-extrabold tabular-nums shadow-pop outline-[0.9cqw] outline-gold"
        style={{
          backgroundColor: POCKET_FILL[pocketColor(number)],
          color: 'var(--roulette-digit)',
        }}
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.3 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 520, damping: 20 }}
      >
        {number}
      </motion.span>
    )
  } else if (stage === 'betting' && shown) {
    const left = Math.max(0, shown.closesAt - serverNow())
    const hurry = left <= 5_000
    body = (
      <span
        key="clock"
        className={`grid size-[30cqw] place-items-center rounded-full border-[0.8cqw] bg-bg/80 text-[13cqw] font-bold tabular-nums ${
          hurry ? 'border-gold text-gold' : 'border-border-strong text-text'
        }`}
      >
        {Math.ceil(left / 1000)}
      </span>
    )
  }
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <AnimatePresence>{body}</AnimatePresence>
    </div>
  )
}

/** The wheel with its hub, as big as its box. */
function WheelBox({
  spins,
  reduced,
  className = '',
}: {
  spins: Spins
  reduced: boolean
  className?: string
}) {
  const landed = spins.stage === 'landed' ? spins.number : null
  return (
    <div className={`@container relative aspect-square ${className}`}>
      <Wheel
        plan={spins.plan}
        reduced={reduced}
        glow={landed}
        label={
          landed === null ? 'The roulette wheel' : `The roulette wheel: ${numberWords(landed)}`
        }
        className="size-full"
      />
      <Hub spins={spins} />
    </div>
  )
}

/** On a phone: the wheel, big, while it spins. A tap puts it away. */
function SpinOverlay({
  spins,
  reduced,
  result,
  onClose,
}: {
  spins: Spins
  reduced: boolean
  result: MyResult | null
  onClose: () => void
}) {
  return (
    <motion.div
      role="dialog"
      aria-label="The wheel is spinning"
      className="fixed inset-0 z-40 grid place-items-center bg-backdrop px-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
      onClick={onClose}
    >
      <motion.div
        className="flex w-full max-w-84 flex-col items-center gap-3 rounded-xl border border-border bg-surface-1 p-5 shadow-pop"
        initial={reduced ? { opacity: 0 } : { scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={reduced ? { opacity: 0 } : { scale: 0.92, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      >
        <WheelBox spins={spins} reduced={reduced} className="w-full" />
        <Caption spins={spins} result={result} />
        <p className="text-xs text-faint">Tap to see the table</p>
      </motion.div>
    </motion.div>
  )
}

export default function RouletteRoom() {
  const reduced = useReducedMotion() ?? false
  const room = useRoom<RouletteDetail>(ROULETTE)
  const me = useMe()
  const { data: players } = usePlayers()
  const { data: season } = useSeason()
  const { data: config } = useConfig()
  const touch = useMediaQuery(TOUCH)
  // Every round on the table, also of players who have left the room.
  const all = useQuery({
    queryKey: roomKey(ROULETTE),
    queryFn: () => api.get<RoomState<RouletteDetail>>(`/api/${ROULETTE}/room`),
  })
  const rounds = all.data?.rounds ?? NO_ROUNDS

  const limits = config ? { minBet: BigInt(config.min_bet), maxBetPct: config.max_bet_pct } : null
  const balance = BigInt(season?.wallet?.balance ?? 0)
  const shut = closedReason(season)

  // ------------------------------------------------------------ the wheel

  const betsRef = useRef<Bets | null>(null)
  const latest = useRef({ config, rounds, me: me.id })
  useEffect(() => {
    latest.current = { config, rounds, me: me.id }
  })
  const [result, setResult] = useState<MyResult | null>(null)

  const onLanded = useCallback((spin: number, number: number) => {
    const mine = betsRef.current?.on(spin) ?? []
    const stake = betsTotal(mine)
    const { payout } = settleBets(mine, number)
    setResult({ spin, number, stake, payout })
    if (stake === 0n) return
    const net = payout - stake
    if (net > 0n) {
      const { config: cfg, rounds: all, me: id } = latest.current
      const round = all.find((r) => r.userId === id && r.detail.spin === spin)
      const allIn = round?.allIn ?? false
      const big = isBigWin(
        { stake: Number(stake), payout: Number(payout), allIn },
        cfg?.big_win_times ?? 10,
      )
      celebrate({ net: Number(net), big, note: allIn ? 'All in' : undefined })
    } else if (payout === 0n) {
      playSound('loss')
    }
  }, [])

  const spins = useSpins({
    rounds,
    me: me.id,
    mineOn: (spin) => betsRef.current?.confirmed(spin) ?? false,
    pendingOn: (spin) => betsRef.current?.pending(spin) ?? false,
    reduced,
    onLanded,
  })

  // ------------------------------------------------------------ your bets

  const openSpin = spins.phase === 'betting' && spins.window ? spins.window.spin : null
  const closedNote =
    shut ??
    (openSpin !== null
      ? null
      : spins.phase === 'spinning'
        ? 'No more bets: the wheel is spinning.'
        : spins.clock
          ? 'Bets open again in a moment.'
          : 'The wheel starts with the season.')
  const bets = useBets({
    me: me.id,
    mine: room.mine,
    open: openSpin,
    closed: closedNote,
    balance,
    limits,
    adopt: spins.adopt,
  })
  useEffect(() => {
    betsRef.current = bets
  })

  const worth = balance + betsTotal(bets.current)
  const rack = chipRack(limits?.minBet ?? 100n, worth)
  const [picked, setPicked] = useState<bigint | null>(readChip)
  const chip =
    picked !== null && (!limits || picked >= limits.minBet) ? picked : (rack[1] ?? rack[0] ?? 100n)
  const pick = useCallback((amount: bigint) => {
    setPicked(amount)
    saveChip(amount)
  }, [])

  const said = useRef({ text: '', at: 0 })
  const say = useCallback((text: string) => {
    const now = Date.now()
    if (said.current.text === text && now - said.current.at < 2_000) return
    said.current = { text, at: now }
    toast.error(text)
  }, [])

  function placeOn(spot: string) {
    const placed = bets.place([{ spot, text: amountText(chip) }])
    if (!placed.ok) {
      say(placed.error)
      return
    }
    playSound('chip')
    // The chip you bet with stays your chip, even as the rack follows your wallet.
    if (picked === null) pick(chip)
  }

  function removeFrom(spot: string) {
    const removed = bets.remove(spot)
    if (removed.ok) playSound('chip')
    else say(removed.error)
  }

  // ------------------------------------------------------------ the felt

  const nameOf = (userId: string) => players?.find((p) => p.id === userId)?.displayName ?? 'Someone'
  const shownSpin = spins.shown?.spin ?? null
  const chips = new Map<string, FeltChip[]>()
  if (shownSpin !== null) {
    const add = (spot: string, chip: FeltChip) => {
      const list = chips.get(spot)
      if (list) list.push(chip)
      else chips.set(spot, [chip])
    }
    for (const round of rounds) {
      if (round.userId === me.id || round.detail.spin !== shownSpin || round.status === 'void')
        continue
      const color = colorOf(players?.find((p) => p.id === round.userId))
      for (const b of round.detail.bets) {
        add(b.spot, { userId: round.userId, color, amount: b.amount, me: false })
      }
    }
    const myColor = colorOf(players?.find((p) => p.id === me.id))
    for (const b of bets.on(shownSpin)) {
      add(b.spot, { userId: me.id, color: myColor, amount: b.amount, me: true })
    }
  }
  const myColor = colorOf(players?.find((p) => p.id === me.id))
  const riding = shownSpin === null ? 0n : betsTotal(bets.on(shownSpin))

  const [pointed, setPointed] = useState<string | null>(null)
  const [typed, setTyped] = useState<string[]>([])
  const onPreview = useCallback((spots: string[]) => setTyped(spots), [])
  const preview = typed.length > 0 ? typed : pointed ? [pointed] : []

  const [tableRef, width] = useWidth()
  const side = width >= SIDE_BY_SIDE
  const layout = tableLayout(width > 0 && width < TALL_BELOW ? 'tall' : 'wide')
  const landed = spins.stage === 'landed' ? spins.number : null

  // The big wheel on a phone, from the close until a moment after the landing.
  const narrow = width > 0 && width < TALL_BELOW
  const [dismissed, setDismissed] = useState<number | null>(null)
  const spinning = spins.stage === 'spinning' && spins.plan.current !== null
  const justLanded =
    spins.stage === 'landed' &&
    spins.shown !== null &&
    serverNow() < (spins.plan.current?.landAt ?? 0) + OVERLAY_AFTER_MS
  const overlay =
    narrow && (spinning || justLanded) && shownSpin !== null && dismissed !== shownSpin
  // Re-render once the landing's moment has passed, to put the big wheel away.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!justLanded) return
    const timer = setTimeout(() => setTick((t) => t + 1), OVERLAY_AFTER_MS + 50)
    return () => clearTimeout(timer)
  }, [justLanded])

  let table
  if (spins.failed) {
    table = (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="font-semibold">The wheel did not load.</p>
        <Button variant="primary" onClick={spins.retry}>
          Try again
        </Button>
      </div>
    )
  } else if (spins.loading) {
    table = <div className="skeleton h-72 w-full rounded-lg" aria-hidden="true" />
  } else {
    const felt = (
      <div className="flex min-w-0 flex-col gap-2">
        <InfoLine spot={pointed} chips={chips} nameOf={nameOf} chip={chip} touch={touch} />
        <Felt
          layout={layout}
          chips={chips}
          number={landed}
          preview={preview}
          live={openSpin !== null && shut === null}
          onPlace={placeOn}
          onRemove={removeFrom}
          onPoint={setPointed}
          className={layout.orientation === 'tall' ? 'mx-auto max-w-[24rem]' : ''}
        />
      </div>
    )
    table = side ? (
      <div className="grid grid-cols-[minmax(11rem,15rem)_minmax(0,1fr)] items-center gap-6">
        <div className="flex flex-col items-center gap-4">
          <WheelBox spins={spins} reduced={reduced} className="w-full max-w-56" />
          <RecentStrip recent={spins.recent.slice(0, 8)} className="flex-wrap justify-center" />
        </div>
        {felt}
      </div>
    ) : (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <WheelBox spins={spins} reduced={reduced} className="w-24 shrink-0 sm:w-28" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Caption spins={spins} result={result} />
            <RecentStrip recent={spins.recent} className="scroll-quiet -m-1 overflow-x-auto p-1" />
          </div>
        </div>
        {felt}
      </div>
    )
  }

  return (
    <>
      <RoomLayout
        game={manifest}
        room={room}
        info={
          <>
            {/* A phone has room for the odds, not the wheel's name. */}
            <span className="max-sm:hidden">European wheel · </span>35 to 1 on a number · 2.7% house
            edge
          </>
        }
        seat={(seat) => <SeatBets round={seat.round} spin={shownSpin} />}
        table={
          <div ref={tableRef} className="w-full self-stretch">
            {table}
          </div>
        }
        controls={
          <Controls
            bets={bets}
            open={openSpin !== null}
            shut={shut}
            limits={limits}
            chip={chip}
            rack={rack}
            color={myColor}
            onChip={pick}
            onPreview={onPreview}
            say={say}
            status={
              <StatusBar
                stage={spins.stage}
                shown={spins.shown}
                window={spins.window}
                number={spins.number}
                result={result?.spin === shownSpin ? result : null}
                riding={riding}
                loading={spins.loading}
                idle={shut}
              />
            }
          />
        }
      />
      <AnimatePresence>
        {overlay && (
          <SpinOverlay
            key={shownSpin}
            spins={spins}
            reduced={reduced}
            result={result}
            onClose={() => setDismissed(shownSpin)}
          />
        )}
      </AnimatePresence>
    </>
  )
}
