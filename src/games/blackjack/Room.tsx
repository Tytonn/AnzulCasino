/**
 * The blackjack room (spec: Games > Blackjack). Your hand is dealt on your
 * seat in the middle; everyone else's plays out on their seats around it.
 *
 * - The bet box deals. During a hand the same place holds Hit, Stand,
 *   Double and Split (H, S, D, P). From a result, Enter or Space deals the
 *   next hand at the same bet.
 * - Each answer from the server is the whole hand. The table deals what
 *   changed one card at a time (timeline.ts, useTimeline.ts), and the news
 *   of the result (your seat, the top bar, the ticker, chat) waits until the
 *   last card is down (src/kit/reveal.ts).
 * - The slow reveal (Tyton, Nov 19, 2026): on a bet over
 *   blackjack_slow_reveal_pct of your chips, or any all-in, a hit or a
 *   double from a hard 12 or more comes face down, lifts slowly and turns
 *   over, every time in that spot, whatever the card. So does the dealer's
 *   hole card while a hand still waits on it. A tap or any key turns it
 *   over at once; nothing else happens until it lands.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { parseBetAmount } from '../../../shared/bet-amount.ts'
import { chipCount } from '../../../shared/chips.ts'
import {
  BLACKJACK,
  type BlackjackDetail,
  extraStake,
  handTotal,
  legalMoves,
  type Move,
  whyNot,
} from '../../../shared/games/blackjack.ts'
import { type PlayResult, type RoundView, roundVersion } from '../../../shared/rounds.ts'
import {
  afterReveal,
  api,
  ApiError,
  applyRound,
  applyWallet,
  BetBox,
  Button,
  celebrate,
  errorMessage,
  holdReveal,
  isBigWin,
  isShortcut,
  Kbd,
  playSound,
  requestKey,
  RoomLayout,
  roomKey,
  toast,
  useConfig,
  useMe,
  useRoom,
  useShortcuts,
  useWallet,
} from '../../kit/index.ts'
import manifest from './manifest.ts'
import { MiniTable } from './MiniTable.tsx'
import { Table, type TableEffect } from './Table.tsx'
import { handAt, PACE, REDUCED_PACE, revealMs, type SlowPace } from './timeline.ts'
import { type TableView, useTimeline } from './useTimeline.ts'

type Hand = RoundView<BlackjackDetail>

const MOVE_KEYS: Record<Move, string> = { hit: 'H', stand: 'S', double: 'D', split: 'P' }

let effectIds = 0

function Actions({
  round,
  busy,
  slow,
  dealerTurn,
  balance,
  onMove,
}: {
  round: Hand | null
  busy: boolean
  /** The slow reveal is on: moves wait until the card lands. */
  slow: boolean
  dealerTurn: boolean
  balance: number | null
  onMove: (move: Move) => void
}) {
  const open = round?.status === 'open'
  const legal = open && round ? legalMoves(round.detail) : []
  const extra = round ? round.detail.bet : 0
  const short = balance !== null && balance < extra
  const can = (move: Move) =>
    legal.includes(move) && !busy && !slow && !((move === 'double' || move === 'split') && short)

  let note: string
  if (slow) note = 'Tap the table or press any key to turn it over.'
  else if (dealerTurn) note = 'Dealer’s turn…'
  else if (!open) note = ''
  else if ((legal.includes('double') || legal.includes('split')) && short) {
    note = `Doubling or splitting takes another ${chipCount(extra)}.`
  } else if (legal.includes('split')) note = `Double or split for another ${chipCount(extra)}.`
  else if (legal.includes('double')) note = `Double for another ${chipCount(extra)}, then one card.`
  else note = round && round.detail.hands.length > 1 ? 'Play each hand in turn.' : ''

  const button = (move: Move, label: string, variant: 'primary' | 'secondary') => (
    <Button
      key={move}
      variant={variant}
      size="lg"
      disabled={!can(move)}
      aria-busy={busy || undefined}
      // A click does not leave the button focused, so Space never presses it again.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onMove(move)}
      className="min-w-0 px-2 md:px-5"
    >
      {label}
      <Kbd>{MOVE_KEYS[move]}</Kbd>
    </Button>
  )

  // Two rows of big buttons where the bet box takes two rows too (a narrow
  // phone), one row elsewhere: the same height either way, so the table above
  // keeps its size between hands.
  return (
    <div
      data-bet-box
      className="@container rounded-lg border border-border bg-surface-1/95 p-2 shadow-card backdrop-blur-md md:p-2.5"
    >
      <div
        role="group"
        aria-label="Your move"
        className="grid grid-cols-2 gap-2 @min-[23rem]:grid-cols-4"
      >
        {button('hit', 'Hit', 'primary')}
        {button('stand', 'Stand', 'secondary')}
        {button('double', 'Double', 'secondary')}
        {button('split', 'Split', 'secondary')}
      </div>
      <p
        aria-live="polite"
        className="flex min-h-6 items-center truncate px-1 pt-1 text-xs text-muted"
      >
        {note}
      </p>
    </div>
  )
}

export default function BlackjackRoom() {
  const reduced = useReducedMotion()
  const { data: config } = useConfig()
  const me = useMe()
  const wallet = useWallet()
  const queryClient = useQueryClient()

  const pace = reduced ? REDUCED_PACE : PACE
  const lift = config?.blackjack_slow_lift_ms ?? 900
  const turn = config?.blackjack_slow_flip_ms ?? 400
  const slowPace: SlowPace = reduced
    ? { lift: Math.min(lift, 500), turn: Math.min(turn, 150) }
    : { lift, turn }

  const room = useRoom<BlackjackDetail>(BLACKJACK, {
    revealMs: (round) => revealMs(round, pace, slowPace),
  })

  const [effect, setEffect] = useState<TableEffect | null>(null)
  const [pending, setPending] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  /** A slow card just busted the hand: the thud was its sound, so no loss sound after it. */
  const thudded = useRef(false)

  function flash(kind: TableEffect['kind'], hand: number) {
    effectIds += 1
    setEffect({ kind, hand, id: effectIds })
  }

  function results(view: TableView<Hand>) {
    const round = view.round
    if (!round) return
    const net = (round.payout ?? 0) - round.stake
    const [first] = round.detail.hands
    const natural = round.detail.hands.length === 1 && first?.result === 'blackjack'
    if (net > 0) {
      if (natural) flash('flash', 0)
      celebrate({
        net,
        big: isBigWin(round, config?.big_win_times ?? 10),
        note: round.allIn ? 'All in' : natural ? 'Blackjack' : undefined,
      })
    } else if (net < 0) {
      if (!thudded.current) playSound('loss')
    } else {
      playSound('chip')
    }
    thudded.current = false
  }

  const { view, timeline } = useTimeline<Hand>({
    pace,
    slow: slowPace,
    onStep: (step, _view, slow) => {
      if (step.kind === 'results') return
      if (step.kind === 'flip') {
        if (!slow) playSound('flip')
        return
      }
      playSound('deal')
    },
    onLanded: (step, landed) => {
      const round = landed.round
      if (!round) return
      if (step.kind !== 'player') {
        playSound('flip')
        return
      }
      // After the slow card turns over: a burst for 21, a thud for a bust, a quiet landing otherwise.
      const { total } = handTotal(handAt(round.detail, landed.frame, step.hand))
      if (total === 21) {
        playSound('sparkle')
        flash('flash', step.hand)
      } else if (total > 21) {
        playSound('thud')
        flash('thud', step.hand)
        thudded.current = round.status !== 'open'
      } else {
        playSound('deal')
      }
    },
    onResults: results,
  })

  // Your hand as the room knows it: at once on a page load, then any change
  // made somewhere else (another tab, or the idle rule standing it for you).
  const loaded = useRef(false)
  const mine = room.mine
  useEffect(() => {
    if (room.loading) return
    if (!loaded.current) {
      loaded.current = true
      if (mine) timeline.jump(mine)
      return
    }
    const shown = timeline.view.round
    if (!mine || sending.current) return
    if (shown && roundVersion(mine) <= roundVersion(shown)) return
    timeline.show(mine)
  }, [room.loading, mine, timeline])

  /** Sends a deal or a move, and shows the answer card by card. */
  async function send(path: string, body: unknown): Promise<PlayResult<BlackjackDetail> | null> {
    if (sending.current) return null
    sending.current = true
    setBusy(true)
    // News about you waits until the table has shown the answer.
    const release = holdReveal({ players: [me.id] })
    let handed = false
    try {
      const result = await api.post<PlayResult<BlackjackDetail>>(path, body, { key: requestKey() })
      const settled = result.round.status !== 'open'
      timeline.show(result.round, () => release(0))
      handed = true
      if (!settled) applyRound(queryClient, result.round)
      afterReveal(me.id, () => {
        if (settled) applyRound(queryClient, result.round)
        applyWallet(queryClient, result.wallet)
      })
      return result
    } catch (error) {
      toast.error(errorMessage(error))
      // The hand moved on in another tab, or a hand is already open: show it as it is.
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: roomKey(BLACKJACK) })
      }
      return null
    } finally {
      if (!handed) release(0)
      sending.current = false
      setBusy(false)
    }
  }

  async function deal(bet: string) {
    if (sending.current) return
    const before = timeline.view.round
    const balance = BigInt(wallet?.balance ?? 0)
    const limits = config && { minBet: BigInt(config.min_bet), maxBetPct: config.max_bet_pct }
    const parsed = parseBetAmount(bet, balance, limits)
    // The chips go down now; the cards come when the server answers.
    setPending(parsed.ok ? Number(parsed.amount) : null)
    timeline.jump(null)
    const result = await send('/api/blackjack/deal', { bet })
    setPending(null)
    if (!result && before) timeline.jump(before)
  }

  async function act(move: Move) {
    // While a slow card is showing, a key or a tap only turns it over.
    if (timeline.view.slow !== null) {
      timeline.skip()
      return
    }
    const round = timeline.view.round
    if (!round || round.status !== 'open' || sending.current) return
    const problem = whyNot(round.detail, move)
    if (problem) {
      toast.info(problem)
      return
    }
    const extra = extraStake(round.detail, move)
    if (extra > 0) {
      if (wallet && wallet.balance < extra) {
        const doing = move === 'double' ? 'Doubling' : 'Splitting'
        toast.error(
          `${doing} takes another ${chipCount(extra)}, and you have ${chipCount(wallet.balance)}.`,
        )
        return
      }
      playSound('chip')
    }
    // A running animation finishes at once: the player never waits for it.
    timeline.finish()
    await send('/api/blackjack/move', { move, roundId: round.id, steps: round.steps })
  }

  const round = view.round
  const revealing = view.slow === 'lift' || view.slow === 'turn'
  const playing = round !== null && (round.status === 'open' || !view.idle)
  const dealerTurn = round !== null && round.status !== 'open' && !view.idle && !revealing

  /** Enter or Space during a hand: turns a slow card, or shows the rest of a finished hand. */
  function onward() {
    if (timeline.skip()) return
    if (round && round.status !== 'open') timeline.finish()
  }

  // The move keys stay on between hands: a listener added only once a hand
  // is dealt arrives a moment after the buttons show, and a key pressed in that
  // moment would be lost. act() does nothing while no hand is open.
  useShortcuts({
    h: () => void act('hit'),
    s: () => void act('stand'),
    d: () => void act('double'),
    p: () => void act('split'),
  })
  useShortcuts({ Space: onward, Enter: onward }, { enabled: playing })

  // Any key turns a slow card over.
  useEffect(() => {
    if (!revealing) return
    const onKey = (event: KeyboardEvent) => {
      if (isShortcut(event) && timeline.skip()) event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [revealing, timeline])

  return (
    <RoomLayout
      game={manifest}
      room={room}
      info="Blackjack pays 3 to 2 · Dealer stands on all 17s"
      seat={(seat) => <MiniTable round={seat.round} />}
      table={
        <Table
          round={round}
          frame={view.frame}
          step={view.step}
          slow={view.slow}
          pace={pace}
          slowPace={slowPace}
          pending={pending}
          effect={effect}
          onTap={() => timeline.skip()}
        />
      }
      controls={
        playing ? (
          <Actions
            round={round}
            busy={busy}
            slow={view.slow !== null}
            dealerTurn={dealerTurn}
            balance={wallet?.balance ?? null}
            onMove={(move) => void act(move)}
          />
        ) : (
          <BetBox game={BLACKJACK} label="Deal" busy={busy} onBet={(bet) => void deal(bet)} />
        )
      }
    />
  )
}
