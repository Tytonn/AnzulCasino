/**
 * The players on a roulette round, one row each: their name, their bets
 * ("50 on Red, 25 on 17") and their stake, or once the result shows,
 * their net gain or loss with the bets that won in gold. The card lists
 * them in the order they joined until the result shows, then winners first
 * (tablePlayers in shared/games/roulette.ts); its folded line's replay
 * lists the result the same way.
 */
import { formatChips } from '../../../shared/chips.ts'
import { type RouletteDetail, spotById, type TablePlayer } from '../../../shared/games/roulette.ts'
import { Avatar, PlayerName, usePlayer } from '../../kit/index.ts'

function signed(amount: number): string {
  if (amount > 0) return `+${formatChips(amount)}`
  if (amount < 0) return `−${formatChips(-amount)}`
  return '±0'
}

export function Net({ value }: { value: number }) {
  return (
    <span
      className={`font-semibold tabular-nums ${value > 0 ? 'text-gold' : value < 0 ? 'text-loss' : 'text-muted'}`}
    >
      {signed(value)}
    </span>
  )
}

/** "50 on Red, 25 on 17", in the order placed. Once landed, the bets that won are gold. */
function Bets({ detail, landed }: { detail: RouletteDetail; landed: boolean }) {
  return detail.bets.map((bet, i) => (
    <span
      key={bet.spot}
      className={landed && detail.wins.includes(bet.spot) ? 'text-gold' : undefined}
    >
      {i > 0 && ', '}
      {formatChips(bet.amount)} on {spotById(bet.spot).name}
    </span>
  ))
}

export function betText(detail: RouletteDetail): string {
  return detail.bets.map((b) => `${formatChips(b.amount)} on ${spotById(b.spot).name}`).join(', ')
}

function PlayerRow({ player, landed }: { player: TablePlayer; landed: boolean }) {
  const who = usePlayer(player.userId)
  const net = landed ? player.net : null
  return (
    <li data-player={player.userId} className="flex min-w-0 items-center gap-2 py-1">
      <Avatar player={who} size="xs" />
      <span className="flex min-w-0 flex-1 flex-col leading-tight @min-[26rem]:flex-row @min-[26rem]:items-baseline @min-[26rem]:gap-2">
        <PlayerName player={who} badge={false} className="text-sm" />
        <span className="truncate text-xs text-muted" title={betText(player.round.detail)}>
          <Bets detail={player.round.detail} landed={landed} />
        </span>
      </span>
      <span data-amount className="shrink-0 text-sm tabular-nums">
        {net !== null ? <Net value={net} /> : formatChips(player.round.stake)}
      </span>
    </li>
  )
}

/** The rows on show: everyone, or with a limit the first few and always your own. */
function shownRows(players: TablePlayer[], me: string, limit: number | null): TablePlayer[] {
  if (limit === null || players.length <= limit) return players
  const top = players.slice(0, limit)
  if (top.some((p) => p.userId === me)) return top
  const mine = players.find((p) => p.userId === me)
  return mine ? [...top.slice(0, limit - 1), mine] : top
}

export function PlayerList({
  players,
  landed,
  me,
  limit = null,
  className = '',
}: {
  players: TablePlayer[]
  /** The result shows: each row shows its net, and the list is the result. */
  landed: boolean
  me: string
  /** At most this many rows, your own among them. */
  limit?: number | null
  className?: string
}) {
  const rows = shownRows(players, me, limit)
  const more = players.length - rows.length
  return (
    <ul aria-label={landed ? 'Results' : 'Bets'} className={className}>
      {rows.map((player) => (
        <PlayerRow key={player.round.id} player={player} landed={landed} />
      ))}
      {more > 0 && (
        <li className="py-1 text-xs text-muted">
          and {more} more {more === 1 ? 'player' : 'players'}
        </li>
      )}
    </ul>
  )
}
