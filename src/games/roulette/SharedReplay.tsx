/**
 * A finished roulette round, opened from its folded line in the stream: the
 * number it landed on, the chips on the table, and every player with their
 * bets and net, winners first.
 */
import { formatChips } from '../../../shared/chips.ts'
import {
  type RouletteTable,
  tableNumber,
  tablePlayers,
  tableTotal,
} from '../../../shared/games/roulette.ts'
import type { SharedRoundView } from '../../../shared/rounds.ts'
import { useMe } from '../../kit/index.ts'
import { NumberChip, numberWords } from './NumberChip.tsx'
import { PlayerList } from './Players.tsx'

export default function RouletteSharedReplay({ shared }: { shared: SharedRoundView }) {
  const table = shared as RouletteTable
  const me = useMe()
  const number = tableNumber(table)
  const players = tablePlayers(table)
  return (
    <div data-roulette-replay={table.id} className="@container flex flex-col gap-2 px-1">
      <div className="flex items-center gap-3">
        {number !== null ? (
          <NumberChip number={number} size="lg" />
        ) : (
          <span className="grid size-12 place-items-center rounded-lg bg-surface-3 text-muted">
            ?
          </span>
        )}
        <div className="leading-tight">
          <p className="text-lg font-bold">
            {number !== null ? numberWords(number) : 'Not drawn yet'}
          </p>
          <p className="text-xs text-muted tabular-nums">
            Round {table.roundNo} · {formatChips(tableTotal(table))} on the table
          </p>
        </div>
      </div>
      <PlayerList players={players} landed={number !== null} me={me.id} />
    </div>
  )
}
