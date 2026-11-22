/**
 * Blackjack as a card in the stream (spec: The stream > Cards). Everyone
 * watching sees the hand dealt card by card on a small felt; only its
 * player gets the buttons: Hit, Stand, Double and Split (H, S, D, P while
 * the card has the keys), and Deal again (Space or Enter) for a few seconds
 * after the result, while the card is still pinned above the box.
 *
 * The card plays each answer with the room's own timeline (timeline.ts,
 * useTimeline.ts), slow reveal included, and tells the stream when the
 * result has shown, so the card can fold a few seconds later. Sounds and
 * celebrations are for its player alone: ten friends' hands at once would
 * be noise.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { chipCount, formatChips } from '../../../shared/chips.ts'
import {
  type BlackjackDetail,
  extraStake,
  handTotal,
  legalMoves,
  type Move,
  whyNot,
} from '../../../shared/games/blackjack.ts'
import { type PlayResult, type RoundView, roundVersion } from '../../../shared/rounds.ts'
import { claimKeys, markShown, putRound, takeCardHold, useCardRounds } from '../../kit/cards.ts'
import { serverNow } from '../../kit/clock.ts'
import {
  afterReveal,
  api,
  ApiError,
  applyRound,
  applyWallet,
  Button,
  celebrate,
  errorMessage,
  holdReveal,
  isBigWin,
  isShortcut,
  Kbd,
  playSound,
  requestKey,
  toast,
  useConfig,
  useMe,
  useShortcuts,
  useWallet,
} from '../../kit/index.ts'
import type { CardProps } from '../../shell/manifests.ts'
import { dealHand } from './stream.ts'
import { Table, type TableEffect } from './Table.tsx'
import { handAt, PACE, REDUCED_PACE, type SlowPace } from './timeline.ts'
import { type TableView, useTimeline } from './useTimeline.ts'

type Hand = RoundView<BlackjackDetail>

const MOVE_KEYS: Record<Move, string> = { hit: 'H', stand: 'S', double: 'D', split: 'P' }

/** A hand that ended this long ago, and never showed here, shows as it ended. */
const OLD_MS = 8_000

let effectIds = 0

export default function BlackjackCard({ round, mine, pinned, keys }: CardProps) {
  const hand = round as Hand
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

  const [effect, setEffect] = useState<TableEffect | null>(null)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  /** A slow card just busted the hand: the thud was its sound, so no loss sound after it. */
  const thudded = useRef(false)

  function flash(kind: TableEffect['kind'], at: number) {
    effectIds += 1
    setEffect({ kind, hand: at, id: effectIds })
  }

  function results(view: TableView<Hand>) {
    const shown = view.round
    if (!shown) return
    markShown(shown.id)
    if (!mine) return
    const net = (shown.payout ?? 0) - shown.stake
    const [first] = shown.detail.hands
    const natural = shown.detail.hands.length === 1 && first?.result === 'blackjack'
    if (net > 0) {
      if (natural) flash('flash', 0)
      celebrate({
        net,
        big: isBigWin(shown, config?.big_win_times ?? 10),
        note: shown.allIn ? 'All in' : natural ? 'Blackjack' : undefined,
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
      if (!mine || step.kind === 'results') return
      if (step.kind === 'flip') {
        if (!slow) playSound('flip')
        return
      }
      playSound('deal')
    },
    onLanded: (step, landed) => {
      const shown = landed.round
      if (!mine || !shown) return
      if (step.kind !== 'player') {
        playSound('flip')
        return
      }
      const { total } = handTotal(handAt(shown.detail, landed.frame, step.hand))
      if (total === 21) {
        playSound('sparkle')
        flash('flash', step.hand)
      } else if (total > 21) {
        playSound('thud')
        flash('thud', step.hand)
        thudded.current = shown.status !== 'open'
      } else {
        playSound('deal')
      }
    },
    onResults: results,
  })

  // The first time this card shows: deal the hand out, unless it already
  // played here or ended a while ago. The command that dealt it left a hold
  // on your news, released once the cards are down.
  const hold = useRef<((forMs: number) => void) | null | undefined>(undefined)
  useEffect(() => {
    if (hold.current === undefined) hold.current = takeCardHold(hand.id)
    const release = () => {
      hold.current?.(0)
      hold.current = null
    }
    const playedHere = useCardRounds.getState().shown[hand.id] !== undefined
    const ended = hand.settledAt ? serverNow() - Date.parse(hand.settledAt) : 0
    if (playedHere || ended > OLD_MS) {
      timeline.jump(hand)
      if (hand.status !== 'open') markShown(hand.id)
      release()
    } else {
      timeline.show(hand, release)
    }
    // Only when the card first shows; the effect below follows the hand from there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Every newer version of the hand, from your answers or the live news.
  useEffect(() => {
    const shown = timeline.view.round
    if (!shown || sending.current) return
    if (roundVersion(hand) <= roundVersion(shown)) return
    timeline.show(hand)
  }, [hand, timeline])

  /** Sends a move and plays the answer; your news waits until it is on the table. */
  async function send(path: string, body: unknown): Promise<PlayResult<BlackjackDetail> | null> {
    if (sending.current) return null
    sending.current = true
    setBusy(true)
    const release = holdReveal({ players: [me.id] })
    let handed = false
    try {
      const result = await api.post<PlayResult<BlackjackDetail>>(path, body, { key: requestKey() })
      timeline.show(result.round, () => release(0))
      handed = true
      putRound(result.round)
      afterReveal(me.id, () => {
        applyRound(queryClient, result.round)
        applyWallet(queryClient, result.wallet)
      })
      return result
    } catch (error) {
      toast.error(errorMessage(error))
      return null
    } finally {
      if (!handed) release(0)
      sending.current = false
      setBusy(false)
    }
  }

  async function act(move: Move) {
    if (!mine) return
    // While a slow card is showing, a key or a tap only turns it over.
    if (timeline.view.slow !== null) {
      timeline.skip()
      return
    }
    const current = timeline.view.round
    if (!current || current.status !== 'open' || sending.current) return
    const problem = whyNot(current.detail, move)
    if (problem) {
      toast.info(problem)
      return
    }
    const extra = extraStake(current.detail, move)
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
    await send('/api/blackjack/move', { move, roundId: current.id, steps: current.steps })
  }

  const bet = hand.detail.bet > 0 ? hand.detail.bet : hand.stake
  async function dealAgain() {
    if (!mine || sending.current) return
    sending.current = true
    setBusy(true)
    try {
      await dealHand(queryClient, me.id, formatChips(bet))
    } catch (error) {
      toast.error(errorMessage(error))
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: ['stream'] })
      }
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const shown = view.round ?? hand
  const open = shown.status === 'open'
  const revealing = view.slow === 'lift' || view.slow === 'turn'
  const playing = open || !view.idle
  const dealerTurn = !open && !view.idle && !revealing
  const canDealAgain = mine && pinned && !playing

  /** Enter or Space: turns a slow card, shows the rest of a finished hand, or deals again. */
  function onward() {
    if (timeline.skip()) return
    if (!open && !view.idle) {
      timeline.finish()
      return
    }
    if (canDealAgain) void dealAgain()
  }

  // The keys this card answers to while it has them; any other key types in the box.
  useEffect(() => {
    if (keys && mine) claimKeys(open ? ['h', 's', 'd', 'p'] : [])
  }, [keys, mine, open])

  useShortcuts(
    {
      h: () => void act('hit'),
      s: () => void act('stand'),
      d: () => void act('double'),
      p: () => void act('split'),
      Space: onward,
      Enter: onward,
    },
    { enabled: keys && mine },
  )

  // Any key turns a slow card over.
  useEffect(() => {
    if (!revealing || !mine) return
    const onKey = (event: KeyboardEvent) => {
      if (isShortcut(event) && timeline.skip()) event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [revealing, mine, timeline])

  const legal = open ? legalMoves(shown.detail) : []
  const short = wallet !== null && wallet.balance < bet
  const can = (move: Move) =>
    mine &&
    legal.includes(move) &&
    !busy &&
    view.slow === null &&
    !((move === 'double' || move === 'split') && short)

  let note = ''
  if (revealing) note = mine ? 'Tap the table or press any key to turn it over.' : ''
  else if (dealerTurn) note = 'Dealer’s turn…'
  else if (open && mine && (legal.includes('double') || legal.includes('split')) && short) {
    note = `Doubling or splitting takes another ${chipCount(bet)}.`
  } else if (open && !mine) note = 'Their move…'

  const button = (move: Move, label: string, variant: 'primary' | 'secondary') => (
    <Button
      key={move}
      variant={variant}
      size="md"
      disabled={!can(move)}
      aria-busy={busy || undefined}
      // A click does not leave the button focused, so Space never presses it again.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => void act(move)}
      className="min-w-0 px-2"
    >
      {label}
      {keys && <Kbd>{MOVE_KEYS[move]}</Kbd>}
    </Button>
  )

  return (
    <div data-blackjack-card className="px-3 pb-3">
      <div
        className={`table-felt relative overflow-hidden rounded-md border border-border ${pinned ? 'h-44 sm:h-52' : 'h-48 sm:h-60'}`}
      >
        <Table
          round={shown}
          frame={view.frame}
          step={view.step}
          slow={view.slow}
          pace={pace}
          slowPace={slowPace}
          effect={effect}
          onTap={() => timeline.skip()}
        />
      </div>
      {mine && playing && (
        <div role="group" aria-label="Your move" className="mt-2 grid grid-cols-4 gap-1.5">
          {button('hit', 'Hit', 'primary')}
          {button('stand', 'Stand', 'secondary')}
          {button('double', 'Double', 'secondary')}
          {button('split', 'Split', 'secondary')}
        </div>
      )}
      {canDealAgain && (
        <div className="mt-2 flex items-center gap-3">
          <Button
            variant="primary"
            size="md"
            disabled={busy}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void dealAgain()}
          >
            Deal again · {formatChips(bet)}
            {keys && <Kbd>Space</Kbd>}
          </Button>
          <span className="text-xs text-muted">or type a new bet below</span>
        </div>
      )}
      {note && (
        <p aria-live="polite" className="truncate px-0.5 pt-1.5 text-xs text-muted">
          {note}
        </p>
      )}
    </div>
  )
}
