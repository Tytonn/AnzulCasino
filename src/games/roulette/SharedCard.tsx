/**
 * Roulette's one card in the stream (spec: Games > Roulette): a round for
 * everyone at the table. While bets are open it counts down, starting again
 * with each new bet, and lists every bet under its player's name. At the
 * close it says "No more bets", the server draws the number, and the result
 * pops up on every screen: the number on a ball of its color, large, and
 * every player's net, winners first.
 *
 * There are no buttons: bets are typed (.roulette 50 red), and a bet while a
 * round is open joins it. The settle and the news held back until the result
 * shows live in draw.ts.
 */
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

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
import { useDraw } from './draw.ts'
import { BlankBall, NumberBall, numberWords } from './NumberChip.tsx'
import { PlayerList } from './Players.tsx'

/** The countdown turns gold for its last seconds. */
const HURRY_MS = 5_000
/** A tick for each of the last seconds, for bettors. */
const TICK_FROM = 3
/** Above the message box the card keeps to a few players. */
const PINNED_ROWS = 3

type Stage = 'betting' | 'closed' | 'landed'

/** What the result did for you, in words. */
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
  const shown = useDraw(table, { me: me.id, bigWinTimes: config?.big_win_times ?? 10 })
  // A card that mounts with its result already on show (moved from the pin
  // into the stream, or loaded with the page) shows it without the pop.
  const [shownOnMount] = useState(shown)
  const pop = !reduced && !shownOnMount
  const number = shown ? tableNumber(table) : null
  const landed = number !== null
  useNow(landed ? 60_000 : 250)

  const now = serverNow()
  const opens = Date.parse(table.opensAt)
  const closes = Date.parse(table.closesAt)
  const closeAfterMs = (config?.roulette_close_after_seconds ?? 15) * 1000
  const maxOpenMs = (config?.roulette_max_open_seconds ?? 60) * 1000
  const stage: Stage = landed ? 'landed' : now < closes ? 'betting' : 'closed'
  const left = Math.max(0, closes - now)
  // Never above the close-after time, which a moment of clock skew could show.
  const second = stage === 'betting' ? Math.min(Math.ceil(left / 1000), closeAfterMs / 1000) : 0
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
  const ballSize = pinned
    ? 'size-14 text-2xl @min-[36rem]:size-16 @min-[36rem]:text-3xl'
    : 'size-16 text-3xl @min-[28rem]:size-20 @min-[28rem]:text-4xl'

  return (
    <div data-roulette-card={table.id} data-stage={stage} className="px-3 pb-3">
      <div className="flex items-center gap-3">
        <div aria-hidden className="shrink-0">
          {number !== null ? (
            <motion.div
              key="ball"
              initial={pop ? { scale: 0.3, opacity: 0 } : false}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 520, damping: 15, mass: 0.7 }}
            >
              <NumberBall number={number} className={ballSize} />
            </motion.div>
          ) : (
            <BlankBall waiting={stage === 'closed'} className={ballSize} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div aria-live="polite" className="min-w-0">
            {number !== null ? (
              <motion.div
                data-result={number}
                initial={pop ? { opacity: 0, y: 6 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: pop ? 0.08 : 0 }}
                className="min-w-0 leading-tight"
              >
                <p className="text-xs text-muted">The ball landed on</p>
                <p
                  className={`font-extrabold tracking-tight ${pinned ? 'text-xl @min-[36rem]:text-2xl' : 'text-2xl @min-[28rem]:text-3xl'}`}
                >
                  {numberWords(number)}
                </p>
                <Yours player={mine ? myRow : undefined} />
              </motion.div>
            ) : stage === 'betting' ? (
              <p className={`text-base font-semibold ${hurry ? 'text-gold' : ''}`}>
                {hurry ? 'Last bets' : 'Place your bets'}
              </p>
            ) : (
              <div className="leading-tight">
                <p className="text-base font-semibold">No more bets</p>
                <p className="text-sm text-muted tabular-nums">
                  {formatChips(tableTotal(table))} riding
                </p>
              </div>
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
