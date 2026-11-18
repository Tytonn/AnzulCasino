/**
 * The Floor (spec: The Floor): a grid of room cards instead of a menu. Each
 * card shows who is inside and the last big result there. Click one to walk
 * in.
 */
import { motion } from 'motion/react'
import { Link } from 'react-router'

import { formatChips } from '../../../shared/chips.ts'
import type { RoundSummary } from '../../../shared/events.ts'
import { seasonDay } from '../../../shared/game-day.ts'
import { formatCountdown, useNow } from '../../kit/clock.ts'
import { Avatar, PlayerName } from '../../kit/PlayerName.tsx'
import { useMe, usePlayer, usePlayers, useSeason, useTicker } from '../../kit/queries.ts'
import { useOnlinePlayers } from '../../live/index.ts'
import type { OnlinePlayer } from '../../live/presence.ts'
import { type GameEntry, games } from '../registry.ts'
import { useTitle } from '../title.ts'

/** The latest win in each game among the recent results. */
function lastWins(rounds: readonly RoundSummary[] | undefined): Map<string, RoundSummary> {
  const wins = new Map<string, RoundSummary>()
  for (const round of rounds ?? []) {
    if (round.net > 0 && !wins.has(round.game)) wins.set(round.game, round)
  }
  return wins
}

function SeasonHeader() {
  const me = useMe()
  const { data } = useSeason()
  const now = useNow(60_000)
  const current = data?.current
  const running = current && (current.phase === 'open' || current.phase === 'final_day')

  let line: string
  if (!data) line = ''
  else if (running) {
    const starts = new Date(current.startsAt)
    // The last game day is the one the final millisecond falls in.
    const total = seasonDay(starts, new Date(Date.parse(current.endsAt) - 1))
    const day = Math.min(total, seasonDay(starts, now))
    line = `${current.name} · Day ${day} of ${total}`
  } else if (data.next) {
    line = `${data.next.name} starts in ${formatCountdown(Date.parse(data.next.startsAt) - now.getTime())}`
  } else if (current) line = `${current.name} has ended. The next season is not scheduled yet.`
  else line = 'No season yet. Games open when the first one starts.'

  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-sm text-muted">Welcome back, {me.displayName}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">The Floor</h1>
      </div>
      {line && (
        <p
          className={`rounded-full border px-3 py-1 text-sm ${current?.phase === 'final_day' ? 'border-gold/50 text-gold' : 'border-border text-muted'}`}
        >
          {current?.phase === 'final_day' ? `Final day · ${line}` : line}
        </p>
      )}
    </header>
  )
}

function Inside({ players }: { players: readonly OnlinePlayer[] }) {
  const { data: all } = usePlayers()
  if (!players.length) return <span className="text-xs text-faint">Nobody inside</span>
  const shown = players.slice(0, 4)
  return (
    <span className="flex items-center gap-2">
      <span className="flex -space-x-2">
        {shown.map((p) => (
          <Avatar
            key={p.userId}
            player={all?.find((x) => x.id === p.userId)}
            size="xs"
            className="ring-2 ring-surface-1"
          />
        ))}
      </span>
      <span className="text-xs text-online">{players.length} inside</span>
    </span>
  )
}

function LastWin({ round }: { round: RoundSummary | undefined }) {
  const player = usePlayer(round?.userId)
  if (!round) return <span className="truncate text-xs text-faint">No big wins yet</span>
  return (
    <span className="flex min-w-0 items-center gap-1 text-xs">
      <PlayerName player={player} badge={false} className="max-w-24" />
      <span className="shrink-0 text-gold">won {formatChips(round.net)}</span>
    </span>
  )
}

function RoomCard({
  game,
  inside,
  lastWin,
  index,
}: {
  game: GameEntry
  inside: readonly OnlinePlayer[]
  lastWin: RoundSummary | undefined
  index: number
}) {
  const Icon = game.icon
  const Art = game.manifest?.cardArt
  const open = game.manifest !== null
  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.03, duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link
        to={`/room/${game.id}`}
        className="group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface-1 shadow-card transition hover:-translate-y-0.5 hover:border-border-strong active:translate-y-0"
      >
        <div
          className="relative grid h-28 place-items-center overflow-hidden md:h-32"
          style={{
            background:
              'radial-gradient(120% 90% at 50% 0%, color-mix(in oklab, var(--accent) 22%, var(--surface-2)), var(--surface-1))',
          }}
        >
          {Art ? (
            <Art />
          ) : (
            <Icon
              className={`size-14 transition-transform duration-250 group-hover:scale-110 ${open ? 'text-accent-strong' : 'text-faint'}`}
            />
          )}
          {!open && (
            <span className="absolute top-2.5 right-2.5 rounded-full bg-surface-3 px-2 py-0.5 text-[0.65rem] font-semibold text-muted">
              Soon
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-2 p-3.5">
          <div>
            <h2 className="font-semibold">{game.name}</h2>
            <p className="mt-0.5 line-clamp-1 text-xs text-muted">{game.pitch}</p>
          </div>
          <div className="mt-auto flex flex-col gap-1.5 border-t border-border pt-2.5">
            <Inside players={inside} />
            {open && <LastWin round={lastWin} />}
          </div>
        </div>
      </Link>
    </motion.li>
  )
}

export function FloorPage() {
  useTitle('The Floor')
  const online = useOnlinePlayers()
  const { data: rounds } = useTicker()
  const wins = lastWins(rounds)
  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-8">
      <SeasonHeader />
      <ul className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3 2xl:grid-cols-4">
        {games.map((game, index) => (
          <RoomCard
            key={game.id}
            game={game}
            index={index}
            inside={online.filter((p) => p.room === game.id)}
            lastWin={wins.get(game.id)}
          />
        ))}
      </ul>
    </div>
  )
}
