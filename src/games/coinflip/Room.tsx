/**
 * The coin flip room: the reference every game lane copies (docs/LANE_GUIDE.md).
 * It uses each piece of the kit once:
 *
 * - useRoom: who sits here and their latest flips, kept live.
 * - usePlay: sends the bet with an idempotency key and holds the news of the
 *   result (top bar, leaderboard, ticker, chat, your seat) until the coin lands.
 * - RoomLayout, BetBox and Seat: the same room, bet controls and seats as
 *   every other game.
 * - Sounds, the celebration and shortcut keys.
 */
import { useReducedMotion } from 'motion/react'
import { useRef, useState } from 'react'

import { formatChips, formatMultiplier, formatShare } from '../../../shared/chips.ts'
import {
  COINFLIP,
  type CoinflipDetail,
  SIDE_NAMES,
  type Side,
  winMultiplier,
} from '../../../shared/games/coinflip.ts'
import type { RoundView } from '../../../shared/rounds.ts'
import {
  BetBox,
  Button,
  celebrate,
  isBigWin,
  Kbd,
  playSound,
  RoomLayout,
  useConfig,
  usePlay,
  useRoom,
  useShortcuts,
} from '../../kit/index.ts'
import { Coin, type CoinHandle, MiniCoin } from './Coin.tsx'
import manifest from './manifest.ts'

/** How long the coin takes to land once the answer arrives (spec: reveals run up to 600ms). */
const REVEAL_MS = 600
const REDUCED_REVEAL_MS = 150

type Shown =
  | { kind: 'idle' }
  | { kind: 'flipping'; call: Side }
  | { kind: 'landed'; round: RoundView<CoinflipDetail> }

function Outcome({ shown, last }: { shown: Shown; last: RoundView<CoinflipDetail> | null }) {
  if (shown.kind === 'flipping') {
    return (
      <p className="text-muted">
        Flipping… you called <span className="font-semibold text-text">{shown.call}</span>
      </p>
    )
  }
  const round = shown.kind === 'landed' ? shown.round : last?.status === 'settled' ? last : null
  if (!round?.detail.face) {
    return <p className="text-muted">Call heads or tails, type a bet, and flip.</p>
  }
  const won = (round.payout ?? 0) > round.stake
  const face = SIDE_NAMES[round.detail.face]
  return (
    <p key={round.id} className="flex flex-wrap items-baseline justify-center gap-x-2">
      {shown.kind === 'idle' && <span className="text-faint">Last flip:</span>}
      <span className={`text-lg font-bold ${won ? 'text-gold' : 'text-loss'}`}>
        {won
          ? `${face}! +${formatChips((round.payout ?? 0) - round.stake)}`
          : `${face}. −${formatChips(round.stake)}`}
      </span>
      <span className="text-sm text-faint">you called {round.detail.call}</span>
    </p>
  )
}

export default function CoinflipRoom() {
  const reduced = useReducedMotion()
  const revealMs = reduced ? REDUCED_REVEAL_MS : REVEAL_MS
  const room = useRoom<CoinflipDetail>(COINFLIP, { revealMs })
  const play = usePlay<CoinflipDetail>()
  const { data: config } = useConfig()
  const [call, setCall] = useState<Side>('heads')
  const [shown, setShown] = useState<Shown>({ kind: 'idle' })
  const coin = useRef<CoinHandle>(null)
  const flipping = useRef(false)

  useShortcuts({ h: () => setCall('heads'), t: () => setCall('tails') })

  const edge = config?.coinflip_edge_pct ?? 200
  const last = room.mine

  function reveal(round: RoundView<CoinflipDetail>) {
    setShown({ kind: 'landed', round })
    const net = (round.payout ?? 0) - round.stake
    if (net > 0) {
      const big = isBigWin(round, config?.big_win_times ?? 10)
      celebrate({ net, big, note: round.allIn ? 'All in' : undefined })
    } else {
      playSound('loss')
    }
  }

  async function flip(bet: string) {
    // One coin in the air at a time. The kit drops double sends too, but the
    // coin must not start a second toss for a bet that never went out.
    if (flipping.current) return
    flipping.current = true
    const called = call
    coin.current?.toss()
    playSound('flip')
    setShown({ kind: 'flipping', call: called })
    try {
      const result = await play.send('/api/coinflip/play', { bet, call: called }, { revealMs })
      const face = result?.round.detail.face
      if (!result || !face) {
        coin.current?.rest(last?.detail.face ?? 'heads')
        setShown({ kind: 'idle' })
        return
      }
      coin.current?.land(face, revealMs, () => reveal(result.round))
    } finally {
      flipping.current = false
    }
  }

  return (
    <RoomLayout
      game={manifest}
      room={room}
      info={`Win pays ${formatMultiplier(winMultiplier(edge))} · ${formatShare(edge)} house edge`}
      seat={(seat) => <MiniCoin round={seat.round} />}
      table={
        <div className="flex flex-col items-center gap-4 py-2 md:gap-8 md:py-6">
          <Coin
            ref={coin}
            initialFace={last?.detail.face ?? 'heads'}
            className="size-26 text-[12px] md:size-44 md:text-[20px]"
          />
          <div aria-live="polite" className="min-h-10 px-2 text-center md:min-h-14">
            <Outcome shown={shown} last={last} />
          </div>
        </div>
      }
      controls={
        <BetBox game={COINFLIP} label="Flip" busy={play.busy} onBet={(bet) => void flip(bet)}>
          <div
            role="group"
            aria-label="Your call"
            className="flex h-12 shrink-0 gap-1 rounded-md border border-border bg-surface-2 p-1"
          >
            {(['heads', 'tails'] as const).map((side) => (
              <Button
                key={side}
                variant="ghost"
                pressed={call === side}
                onClick={() => setCall(side)}
                className="h-full px-3"
              >
                {SIDE_NAMES[side]}
                <Kbd>{side === 'heads' ? 'H' : 'T'}</Kbd>
              </Button>
            ))}
          </div>
        </BetBox>
      }
    />
  )
}
