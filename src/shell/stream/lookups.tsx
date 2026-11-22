/**
 * What .bal and .lb show (spec: Commands): a player's chips and rank, or the
 * top of the leaderboard. The same view draws a private reply from the
 * cached leaderboard and a public post from its snapshot (stream_bal_lb).
 */
import type { LookupSnapshot } from '../../../shared/chat.ts'
import { formatChips } from '../../../shared/chips.ts'
import { isTier, TIER_LABELS } from '../../../shared/tiers.ts'
import { ChipIcon, VaultIcon } from '../../kit/icons.tsx'
import { Avatar, PlayerName } from '../../kit/PlayerName.tsx'
import { usePlayer, usePlayers } from '../../kit/queries.ts'
import { useUi } from '../ui.ts'

export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`
}

type Balance = Extract<LookupSnapshot, { kind: 'balance' }>
type Board = Extract<LookupSnapshot, { kind: 'leaderboard' }>

export function BalanceView({ lookup, players }: { lookup: Balance; players?: number }) {
  const player = usePlayer(lookup.userId)
  const showProfile = useUi((s) => s.showProfile)
  const tier = isTier(lookup.tier) ? TIER_LABELS[lookup.tier] : lookup.tier
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
      <button
        type="button"
        onClick={() => showProfile(lookup.userId)}
        className="flex min-w-0 items-center gap-2 hover:underline"
      >
        <Avatar player={player} size="sm" />
        <PlayerName player={player} />
      </button>
      <span className="flex items-center gap-1.5" title="Wallet">
        <ChipIcon className="size-4 text-gold" aria-hidden="true" />
        <span className="font-semibold tabular-nums">{formatChips(lookup.balance)}</span>
        <span className="sr-only">in the wallet</span>
      </span>
      <span className="flex items-center gap-1.5 text-muted" title="Vault">
        <VaultIcon className="size-3.5" aria-hidden="true" />
        <span className="tabular-nums">{formatChips(lookup.vault)}</span>
        <span className="sr-only">in the vault</span>
      </span>
      <span className="text-muted">{tier}</span>
      {lookup.rank !== null && (
        <span className="text-muted">
          {ordinal(lookup.rank)}
          {players ? ` of ${players}` : ''}
        </span>
      )}
    </div>
  )
}

export function BoardView({ lookup }: { lookup: Board }) {
  const { data: players } = usePlayers()
  const showProfile = useUi((s) => s.showProfile)
  if (lookup.rows.length === 0) {
    return <p className="text-sm text-muted">Nobody is on the board yet.</p>
  }
  return (
    <ol className="space-y-0.5 text-sm">
      {lookup.rows.map((row) => {
        const player = players?.find((p) => p.id === row.userId)
        return (
          <li key={row.userId}>
            <button
              type="button"
              onClick={() => showProfile(row.userId)}
              className="flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left hover:bg-surface-3"
            >
              <span
                className={`w-4 text-right text-xs font-bold tabular-nums ${row.rank === 1 ? 'text-gold' : 'text-faint'}`}
              >
                {row.rank}
              </span>
              <Avatar player={player} size="xs" />
              <span className="min-w-0 flex-1 truncate">
                <PlayerName player={player} />
              </span>
              <span
                className={`font-semibold tabular-nums ${row.rank === 1 ? 'text-gold' : 'text-text'}`}
              >
                {formatChips(row.netWorth)}
              </span>
            </button>
          </li>
        )
      })}
      {lookup.players > lookup.rows.length && (
        <li className="px-1 pt-0.5 text-xs text-faint">
          {lookup.players - lookup.rows.length} more on the board
        </li>
      )}
    </ol>
  )
}
