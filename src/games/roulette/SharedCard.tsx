/**
 * Roulette's one card in the stream (spec: Games > Roulette): a round for
 * everyone at the table. While bets are open it counts down, starting again
 * with each new bet, and lists every bet under its player's name. At the
 * close the wheel spins on every screen and lands on the number the server
 * draws then; the card shows it large, in its color, and lists every
 * player's net, winners first.
 *
 * There are no buttons: bets are typed (.roulette 50 red), and a bet while a
 * round is open joins it. The spin itself, its timing, the settle and the
 * news held back until the ball lands, lives in spin.ts.
 */
import { useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'

import { formatChips } from '../../../shared/chips.ts'
import {
  type RouletteTable,
  tableNumber,
  type TablePlayer,
  tablePlayers,
  tableTotal,
} from '../../../shared/games/roulette.ts'
import { playSound, serverNow, useConfig, useMe, useNow } from '../../kit/index.ts'
import type { SharedCardProps } from '../../shell/manifests.ts'
import { NumberChip, numberWords } from './NumberChip.tsx'
import { PlayerList } from './Players.tsx'
import { useSpin } from './spin.ts'
import { Wheel } from './Wheel.tsx'

/** "No more bets" shows this long after the close, then "Spinning". */
const CALL_MS = 1_300
/** The countdown turns gold for its last seconds. */
const HURRY_MS = 5_000
/** A tick for each of the last seconds, for bettors. */
const TICK_FROM = 3
/** Above the message box the card keeps to a few players. */
const PINNED_ROWS = 3

type Stage = 'betting' | 'closed' | 'spinning' | 'landed'

/** What the landed spin did for you, in words. */
function Yours({ player }: { player: TablePlayer | undefined }) {
  if (!player || player.net === null) return null
  const net = player.net
  return (
    <p className="text-sm">
      {net > 0 ? (
        <span className="font-bold text-gold">You won {formatChips(net)}</span>
      ) : net < 0 ? (
        <span className="font-semibold text-loss">You lost {formatChips(-net)}</span>
      ) : (
        <span className="font-semibold text-muted">You broke even</span>
      )}
    </p>
  )
}

export default function RouletteCard({ shared, mine, pinned }: SharedCardProps) {
  const table = shared as RouletteTable
  const reduced = useReducedMotion() ?? false
  const me = useMe()
  const { data: config } = useConfig()
  const { plan, landed: ballDown } = useSpin(table, {
    me: me.id,
    reduced,
    bigWinTimes: config?.big_win_times ?? 10,
  })
  // The number on show: only once the ball rests, though the server drew it a moment before.
  const number = ballDown ? tableNumber(table) : null
  const landed = number !== null
  useNow(landed ? 60_000 : 250)

  const now = serverNow()
  const opens = Date.parse(table.opensAt)
  const closes = Date.parse(table.closesAt)
  const closeAfterMs = (config?.roulette_close_after_seconds ?? 15) * 1000
  const maxOpenMs = (config?.roulette_max_open_seconds ?? 60) * 1000
  const stage: Stage = landed
    ? 'landed'
    : now < closes
      ? 'betting'
      : now < closes + CALL_MS
        ? 'closed'
        : 'spinning'
  const left = Math.max(0, closes - now)
  const second = stage === 'betting' ? Math.ceil(left / 1000) : 0
  const hurry = stage === 'betting' && left <= HURRY_MS
  // The round closes at its limit: a new bet still joins it, but adds no time.
  const capped = closes >= opens + maxOpenMs - 5

  // A tick for each of the last seconds when you have chips down.
  const ticked = useRef(0)
  useEffect(() => {
    if (second > TICK_FROM) ticked.current = 0
    if (!mine || second < 1 || second > TICK_FROM || ticked.current === second) return
    ticked.current = second
    playSound('tick')
  }, [second, mine])

  const players = tablePlayers(landed ? table : { rounds: table.rounds, settledAt: null })
  const myRow = players.find((p) => p.userId === me.id)
  const command = `${config?.command_prefix ?? '.'}${config?.command_roulette?.[0] ?? 'roulette'}`

  return (
    <div data-roulette-card={table.id} data-stage={stage} className="px-3 pb-3">
      <div className="flex items-center gap-3">
        <Wheel
          plan={plan}
          reduced={reduced}
          glow={number}
          label={
            number !== null ? `The wheel, landed on ${numberWords(number)}` : 'The roulette wheel'
          }
          className={`shrink-0 ${pinned ? 'size-20 @min-[36rem]:size-28' : 'size-24 @min-[28rem]:size-32'}`}
        />
        <div className="min-w-0 flex-1">
          <div aria-live="polite" className="min-w-0">
            {number !== null ? (
              <div data-result={number} className="flex items-center gap-3">
                <NumberChip
                  number={number}
                  size={pinned ? 'lg' : 'xl'}
                  className={
                    pinned ? '@min-[36rem]:h-16 @min-[36rem]:min-w-16 @min-[36rem]:text-3xl' : ''
                  }
                />
                <div className="min-w-0 leading-tight">
                  <p
                    className={`font-extrabold tracking-tight ${pinned ? 'text-xl @min-[36rem]:text-3xl' : 'text-2xl @min-[28rem]:text-3xl'}`}
                  >
                    {numberWords(number)}
                  </p>
                  <Yours player={mine ? myRow : undefined} />
                </div>
              </div>
            ) : stage === 'betting' ? (
              <p className={`text-base font-semibold ${hurry ? 'text-gold' : ''}`}>
                {hurry ? 'Last bets' : 'Place your bets'}
              </p>
            ) : stage === 'closed' ? (
              <p className="text-base font-semibold">No more bets</p>
            ) : (
              <p className="text-base text-muted">
                Spinning…{' '}
                <span className="text-text tabular-nums">
                  {formatChips(tableTotal(table))} riding
                </span>
              </p>
            )}
          </div>
          {stage === 'betting' && (
            <>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className={`h-full origin-left rounded-full ${hurry ? 'bg-gold' : 'bg-accent'} ${reduced ? '' : 'transition-transform duration-250 ease-linear'}`}
                    style={{
                      transform: `scaleX(${Math.min(1, left / Math.max(1, closeAfterMs))})`,
                    }}
                  />
                </div>
                <span
                  role="timer"
                  aria-label={`Betting closes in ${second} ${second === 1 ? 'second' : 'seconds'}`}
                  className={`w-7 text-right text-lg font-bold tabular-nums ${hurry ? 'text-gold' : 'text-text'}`}
                >
                  {second}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {mine ? 'Add a bet' : 'Join'} with{' '}
                <span className="font-mono text-text">{command} 50 red</span>
                {pinned
                  ? '.'
                  : capped
                    ? `. The round is at its ${Math.round(maxOpenMs / 1000)}-second limit, so new bets add no time.`
                    : '. Each bet starts the clock again.'}
              </p>
            </>
          )}
        </div>
      </div>

      <PlayerList
        players={players}
        landed={landed}
        me={me.id}
        limit={pinned ? PINNED_ROWS : null}
        className="mt-2 border-t border-border pt-1"
      />
    </div>
  )
}
