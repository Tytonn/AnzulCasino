/**
 * Coin flip as a card in the stream (spec: The stream > Cards). Everyone
 * watching sees the coin spin and land; only its player gets the buttons,
 * for a few seconds after the result while the card is still pinned above
 * the box: Heads and Tails (H, T while the card has the keys) and Flip again
 * (Space or Enter), with a new bet typed in the box as the other way on.
 *
 * The card tells the stream when the coin has landed, so it can fold a few
 * seconds later. Sounds and celebrations are for its player alone.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { chipCount, formatChips } from '../../../shared/chips.ts'
import { type CoinflipDetail, SIDE_NAMES, type Side } from '../../../shared/games/coinflip.ts'
import type { RoundView } from '../../../shared/rounds.ts'
import { claimKeys, markShown, takeCardHold, useCardRounds } from '../../kit/cards.ts'
import { serverNow } from '../../kit/clock.ts'
import {
  Button,
  celebrate,
  errorMessage,
  isBigWin,
  Kbd,
  playSound,
  toast,
  useConfig,
  useMe,
  useShortcuts,
} from '../../kit/index.ts'
import type { CardProps } from '../../shell/manifests.ts'
import { Coin, type CoinHandle } from './Coin.tsx'
import { flipCoin } from './stream.ts'

type Flip = RoundView<CoinflipDetail>

/** How long the coin takes to land (spec: reveals run up to 600ms). */
const REVEAL_MS = 600
const REDUCED_REVEAL_MS = 150

/** A flip that ended this long ago, and never showed here, shows as it landed. */
const OLD_MS = 8_000

/** In the air, landing, down, or taken away mid-landing. */
type Stage = 'waiting' | 'flying' | 'landing' | 'landed' | 'gone'

function Outcome({ flip, landed, mine }: { flip: Flip; landed: boolean; mine: boolean }) {
  const { call, face } = flip.detail
  const called = (
    <span className="text-sm text-faint">
      {mine ? 'you called' : 'called'} <span className="text-muted">{call}</span>
    </span>
  )
  if (!landed || !face) {
    return (
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold text-muted">Flipping…</span>
        {called}
      </p>
    )
  }
  const net = (flip.payout ?? 0) - flip.stake
  // A right call on a tiny bet can round down to the stake itself: that is even, not a loss.
  const even = net <= 0 && face === call
  const name = SIDE_NAMES[face]
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span
        className={`text-lg font-bold ${net > 0 ? 'text-gold' : even ? 'text-text' : 'text-loss'}`}
      >
        {net > 0
          ? `${name}! +${formatChips(net)}`
          : even
            ? `${name}! Even`
            : `${name}. −${formatChips(flip.stake)}`}
      </span>
      {even ? (
        <span className="text-sm text-faint">
          a win on {chipCount(flip.stake)} rounds down to {formatChips(flip.payout ?? 0)}
        </span>
      ) : (
        called
      )}
    </p>
  )
}

export default function CoinflipCard({ round, mine, pinned, keys }: CardProps) {
  const flip = round as Flip
  const reduced = useReducedMotion()
  const revealMs = reduced ? REDUCED_REVEAL_MS : REVEAL_MS
  const { data: config } = useConfig()
  const me = useMe()
  const queryClient = useQueryClient()

  const coin = useRef<CoinHandle>(null)
  // Decided when the card first shows: a flip that already played here, or
  // ended a while ago, lies on its face from the start.
  const [still] = useState(() => {
    const playedHere = useCardRounds.getState().shown[flip.id] !== undefined
    const ended = flip.settledAt ? serverNow() - Date.parse(flip.settledAt) : 0
    return flip.status !== 'open' && flip.detail.face !== null && (playedHere || ended > OLD_MS)
  })
  const stage = useRef<Stage>(still ? 'landed' : 'waiting')
  const [landed, setLanded] = useState(still)
  const [call, setCall] = useState<Side>(flip.detail.call)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)

  // The command that flipped it left a hold on your news, let go once the coin is down.
  const hold = useRef<((forMs: number) => void) | null | undefined>(undefined)
  function letGo() {
    hold.current?.(0)
    hold.current = null
  }

  function down(played: boolean) {
    // Taken away mid-landing: the card that shows it next lands it.
    if (stage.current === 'gone') return
    stage.current = 'landed'
    setLanded(true)
    markShown(flip.id)
    letGo()
    if (!mine || !played) return
    const net = (flip.payout ?? 0) - flip.stake
    if (net > 0) {
      const big = isBigWin(flip, config?.big_win_times ?? 10)
      celebrate({ net, big, note: flip.allIn ? 'All in' : undefined })
    } else if (net < 0) {
      playSound('loss')
    } else {
      playSound('chip')
    }
  }

  // The coin follows the round: it spins while the flip is open (a watcher
  // can see it before the result), then lands on the server's face.
  const face = flip.detail.face
  const settled = flip.status !== 'open' && face !== null
  useEffect(() => {
    if (hold.current === undefined) hold.current = takeCardHold(flip.id)
    if (stage.current === 'landed') {
      if (still) markShown(flip.id)
      letGo()
      return
    }
    if (!settled) {
      if (stage.current === 'waiting') {
        stage.current = 'flying'
        coin.current?.toss()
      }
      return
    }
    if (stage.current === 'landing') return
    stage.current = 'landing'
    if (mine) playSound('flip')
    coin.current?.land(face, revealMs, () => down(true))
    // Runs again only when the flip lands; the stage keeps it to once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled])

  // A card taken away mid-landing (a newer flip took the pin) still lets
  // your news go; where it shows next, it lands again. Checked a moment
  // later, as React's checks in development unmount and mount it at once.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      queueMicrotask(() => {
        if (mounted.current || stage.current !== 'landing') return
        stage.current = 'gone'
        letGo()
      })
    }
  }, [])

  const bet = flip.stake
  const canFlipAgain = mine && pinned && landed

  async function flipAgain() {
    if (!canFlipAgain || sending.current) return
    sending.current = true
    setBusy(true)
    // Something moves at once; the new flip's card lands it.
    coin.current?.toss()
    try {
      await flipCoin(queryClient, me.id, formatChips(bet), call)
    } catch (error) {
      if (face) coin.current?.rest(face)
      toast.error(errorMessage(error))
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  /** Space or Enter: lands a coin still in the air at once, or flips again. */
  function onward() {
    if (coin.current?.finish()) return
    void flipAgain()
  }

  // The keys this card answers to while it has them; any other key types in the box.
  useEffect(() => {
    if (keys && mine) claimKeys(canFlipAgain ? ['h', 't'] : [])
  }, [keys, mine, canFlipAgain])

  useShortcuts(
    {
      h: () => canFlipAgain && setCall('heads'),
      t: () => canFlipAgain && setCall('tails'),
      Space: onward,
      Enter: onward,
    },
    { enabled: keys && mine },
  )

  return (
    <div data-coinflip-card className="px-3 pb-3">
      <div className="flex items-center gap-4 px-1 pt-1">
        <Coin
          ref={coin}
          initialFace={still && face ? face : flip.detail.call}
          rise={pinned ? 18 : 26}
          label={landed && face ? `The coin landed ${SIDE_NAMES[face]}` : 'The coin, in the air'}
          className={pinned ? 'size-12 text-[5px]' : 'size-14 text-[6px] sm:size-16 sm:text-[7px]'}
        />
        <div aria-live="polite" className="min-w-0">
          <Outcome flip={flip} landed={landed} mine={mine} />
        </div>
      </div>
      {canFlipAgain && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div
            role="group"
            aria-label="Your call"
            className="flex h-10 gap-1 rounded-md border border-border bg-surface-2 p-1"
          >
            {(['heads', 'tails'] as const).map((side) => (
              <Button
                key={side}
                variant="ghost"
                size="sm"
                pressed={call === side}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setCall(side)}
                className="h-full px-2.5"
              >
                {SIDE_NAMES[side]}
                {keys && <Kbd>{side === 'heads' ? 'H' : 'T'}</Kbd>}
              </Button>
            ))}
          </div>
          <Button
            variant="primary"
            size="md"
            disabled={busy}
            aria-busy={busy || undefined}
            // A click does not leave the button focused, so Space never presses it again.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void flipAgain()}
          >
            Flip again · {formatChips(bet)}
            {keys && <Kbd>Space</Kbd>}
          </Button>
          <span className="text-xs text-muted">or type a new bet below</span>
        </div>
      )}
    </div>
  )
}
