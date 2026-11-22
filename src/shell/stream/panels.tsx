/**
 * The panels beside the stream (spec: The stream > Layout). The board: the
 * leaderboard, and who is online with what each is doing ("Bob ·
 * Blackjack", "Alice · chatting"). You: your wallet, vault, rank and place,
 * the features' buttons with their timers, and the other pages. On a
 * desktop they sit either side of the stream; between 768 and 1100px You
 * stays and the board opens as a drawer; on a phone both open as sheets.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { STREAM_FILTERS } from '../../../shared/chat.ts'
import { TIER_LABELS } from '../../../shared/tiers.ts'
import { AnimatedNumber } from '../../kit/AnimatedNumber.tsx'
import { errorMessage } from '../../kit/api.ts'
import {
  ChipIcon,
  FloorIcon,
  LogoutIcon,
  ShieldIcon,
  SoundOffIcon,
  SoundOnIcon,
  VaultIcon,
} from '../../kit/icons.tsx'
import { Avatar, PlayerName, TierBadge } from '../../kit/PlayerName.tsx'
import { useLeaderboard, useMe, usePlayer, usePlayers, useWallet } from '../../kit/queries.ts'
import { saveSound, useSound } from '../../kit/sound.ts'
import { toast } from '../../kit/toast.tsx'
import { useOnlinePlayers } from '../../live/index.ts'
import type { OnlinePlayer } from '../../live/presence.ts'
import { logOut } from '../layout/TopBar.tsx'
import { gameById, railLinks } from '../registry.ts'
import { Leaderboard } from '../side/Leaderboard.tsx'
import { Slot, useSlot } from '../Slot.tsx'
import { useUi } from '../ui.ts'
import { ordinal } from './lookups.tsx'
import { FILTER_LABELS, useStreamUi } from './ui.ts'

function Heading({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <h2 className="flex items-baseline justify-between gap-2 px-4 pt-4 pb-1.5 text-[0.7rem] font-semibold tracking-[0.12em] text-faint uppercase">
      {children}
      {note && (
        <span className="text-[0.68rem] font-normal tracking-normal normal-case">{note}</span>
      )}
    </h2>
  )
}

// ---------------------------------------------------------------- the board

/** What an online player is doing, in a word or two. */
function doing(online: OnlinePlayer): string {
  if (online.status === 'away') return 'away'
  const game = online.room ? gameById(online.room) : undefined
  if (game) return game.name
  return online.status === 'playing' ? 'in a hand' : 'chatting'
}

function OnlineNow() {
  const online = useOnlinePlayers()
  const { data: players } = usePlayers()
  const showProfile = useUi((s) => s.showProfile)
  if (online.length === 0)
    return <p className="px-4 text-sm text-muted">Nobody else is here yet.</p>
  const order = { playing: 0, active: 1, away: 2 } as const
  const sorted = [...online].sort((a, b) => order[a.status] - order[b.status])
  return (
    <ul className="px-2">
      {sorted.map((entry) => {
        const player = players?.find((p) => p.id === entry.userId)
        const what = doing(entry)
        return (
          <li key={entry.userId}>
            <button
              type="button"
              onClick={() => showProfile(entry.userId)}
              className={`flex w-full min-w-0 items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-surface-2 ${entry.status === 'away' ? 'opacity-60' : ''}`}
            >
              <Avatar
                player={player}
                size="sm"
                ring={
                  entry.status === 'playing'
                    ? 'playing'
                    : entry.status === 'away'
                      ? 'away'
                      : undefined
                }
              />
              <span className="min-w-0 truncate">
                <PlayerName player={player} badge={false} />
              </span>
              <span className="text-faint">·</span>
              <span
                className={`min-w-0 truncate ${entry.status === 'playing' || entry.room ? 'text-gold' : 'text-muted'}`}
              >
                {what}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function BoardPanel() {
  return (
    <div className="scroll-quiet flex h-full min-h-0 flex-col overflow-y-auto pb-4">
      <section aria-label="Leaderboard">
        <Heading
          note={
            <Link to="/leaderboard" className="text-muted hover:text-text hover:underline">
              Full table
            </Link>
          }
        >
          Leaderboard
        </Heading>
        <Leaderboard />
      </section>
      <section aria-label="Online" className="mt-2 border-t border-border">
        <Heading>Online</Heading>
        <OnlineNow />
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- you

function Amount({
  label,
  icon,
  value,
  big = false,
}: {
  label: string
  icon: ReactNode
  value: number | undefined
  big?: boolean
}) {
  return (
    <div className="min-w-0">
      <span className="flex items-center gap-1 text-[0.62rem] tracking-[0.1em] text-faint uppercase">
        {icon}
        {label}
      </span>
      {value === undefined ? (
        <span className="text-muted">–</span>
      ) : (
        <AnimatedNumber
          value={value}
          className={big ? 'text-2xl font-bold text-text' : 'text-lg font-semibold text-muted'}
        />
      )}
    </div>
  )
}

function Standing() {
  const me = useMe()
  const player = usePlayer(me.id)
  const { data } = useLeaderboard()
  const row = data?.standings.find((s) => s.userId === me.id)
  const tier = row?.tier ?? player?.tier ?? 'base'
  const who = player ?? { ...me, tier }
  return (
    <div className="flex items-center gap-3 px-4 pt-4">
      <Avatar player={who} size="md" />
      <div className="min-w-0 flex-1">
        <PlayerName player={who} />
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <TierBadge tier={tier} className="size-3.5" />
          {TIER_LABELS[tier as keyof typeof TIER_LABELS] ?? 'No'} rank
          {row && (
            <>
              <span className="text-faint">·</span>
              {ordinal(row.rank)} of {data?.standings.length}
            </>
          )}
        </p>
      </div>
    </div>
  )
}

/** One line in You's lists of pages and account actions. */
const ROW =
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-muted hover:bg-surface-2 hover:text-text'

/** Every other page: the shop, history, the hall of fame, the admin panel, the classic rooms. */
function Pages() {
  const me = useMe()
  const links = railLinks.filter((link) => !link.adminOnly || me.role === 'admin')
  return (
    <ul className="grid grid-cols-2 gap-1 px-3">
      {links.map((link) => {
        const Icon = link.icon
        return (
          <li key={link.to}>
            <Link to={link.to} className={ROW}>
              {Icon && <Icon className="size-4 shrink-0" />}
              <span className="truncate">{link.label}</span>
            </Link>
          </li>
        )
      })}
      <li>
        <Link to="/classic" className={ROW}>
          <FloorIcon className="size-4 shrink-0" />
          <span className="truncate">Classic rooms</span>
        </Link>
      </li>
    </ul>
  )
}

/** On a phone, where the header has no account menu: setup, the sound and logging out. */
function Account() {
  const me = useMe()
  const muted = useSound((s) => s.muted)
  return (
    <ul className="grid grid-cols-2 gap-1 px-3">
      {me.role === 'admin' && (
        <li>
          <Link to="/setup" className={ROW}>
            <ShieldIcon className="size-4 shrink-0" />
            <span className="truncate">Setup</span>
          </Link>
        </li>
      )}
      <li>
        <button
          type="button"
          aria-pressed={!muted}
          onClick={() => saveSound({ muted: !muted }).catch((e) => toast.error(errorMessage(e)))}
          className={ROW}
        >
          {muted ? (
            <SoundOffIcon className="size-4 shrink-0" />
          ) : (
            <SoundOnIcon className="size-4 shrink-0" />
          )}
          <span className="truncate">{muted ? 'Sound is off' : 'Sound is on'}</span>
        </button>
      </li>
      <li>
        <button type="button" onClick={() => void logOut()} className={ROW}>
          <LogoutIcon className="size-4 shrink-0" />
          <span className="truncate">Log out</span>
        </button>
      </li>
    </ul>
  )
}

export function YouPanel({ account = false }: { account?: boolean }) {
  const wallet = useWallet()
  const widgets = useSlot('top-bar')
  return (
    <div className="scroll-quiet flex h-full min-h-0 flex-col overflow-y-auto pb-4">
      <Standing />
      <div role="group" aria-label="Your chips" className="mt-3 flex items-end gap-5 px-4">
        <Amount
          label="Wallet"
          icon={<ChipIcon className="size-3 text-gold" />}
          value={wallet?.balance}
          big
        />
        <Amount label="Vault" icon={<VaultIcon className="size-3" />} value={wallet?.vault} />
      </div>
      {widgets.length > 0 && (
        <section aria-label="Timers" className="mt-2">
          <Heading note="Tap or type them">Timers</Heading>
          <div data-slot="top-bar" className="flex flex-wrap items-center gap-2 px-4">
            <Slot name="top-bar" props={{ compact: false }} />
          </div>
        </section>
      )}
      <section aria-label="Pages" className="mt-3 border-t border-border">
        <Heading>Pages</Heading>
        <Pages />
      </section>
      {account && (
        <section aria-label="Account" className="mt-3 border-t border-border">
          <Heading>Account</Heading>
          <Account />
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- filters

/** Everything, Chat only, Games only, over the stream. */
export function FilterPills() {
  const filter = useStreamUi((s) => s.filter)
  const setFilter = useStreamUi((s) => s.setFilter)
  return (
    <div
      role="group"
      aria-label="Show in the stream"
      className="flex rounded-full border border-border bg-surface-1 p-0.5"
    >
      {STREAM_FILTERS.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={filter === option}
          onClick={() => setFilter(option)}
          className={`h-7 rounded-full px-3 text-xs font-semibold whitespace-nowrap transition-colors ${filter === option ? 'bg-surface-3 text-text' : 'text-muted hover:text-text'}`}
        >
          {FILTER_LABELS[option]}
        </button>
      ))}
    </div>
  )
}

const SHORT_LABELS = { all: 'All', chat: 'Chat', games: 'Games' } as const

/** The phone's filter: one pill that opens the three choices. */
export function FilterSelect() {
  const filter = useStreamUi((s) => s.filter)
  const setFilter = useStreamUi((s) => s.setFilter)
  return (
    <label className="relative flex h-8 items-center rounded-full border border-border bg-surface-1 pr-6 pl-3 text-xs font-semibold text-text">
      <span className="sr-only">Show in the stream</span>
      <span aria-hidden="true">{SHORT_LABELS[filter]}</span>
      <svg viewBox="0 0 16 16" aria-hidden="true" className="absolute right-2 size-3 text-faint">
        <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value as (typeof STREAM_FILTERS)[number])}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {STREAM_FILTERS.map((option) => (
          <option key={option} value={option}>
            {FILTER_LABELS[option]}
          </option>
        ))}
      </select>
    </label>
  )
}
