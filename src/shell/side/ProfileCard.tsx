/**
 * A player's card, opened by clicking a name anywhere (spec: Social layer >
 * Online list). It shows where they are and how they stand; other lanes add
 * stats (`profile-sections`) and buttons such as Steal (`profile-actions`).
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { TIER_LABELS, isTier } from '../../../shared/tiers.ts'
import { AnimatedNumber } from '../../kit/AnimatedNumber.tsx'
import { Avatar, PlayerName } from '../../kit/PlayerName.tsx'
import { useLeaderboard, useMe, usePlayer } from '../../kit/queries.ts'
import { useOnlinePlayers } from '../../live/index.ts'
import { Sheet } from '../../kit/Sheet.tsx'
import { gameById } from '../registry.ts'
import { Slot } from '../Slot.tsx'
import { soleLeader } from '../standings.ts'
import { useUi } from '../ui.ts'

const STATUS = { active: 'Online', playing: 'In a hand', away: 'Away' } as const

export function ProfileCard() {
  const userId = useUi((s) => s.profile)
  const showProfile = useUi((s) => s.showProfile)
  const close = () => showProfile(null)
  return (
    <Sheet open={userId !== null} onClose={close} title="Player" placement="center" hideTitle>
      {userId && <CardBody userId={userId} onNavigate={close} />}
    </Sheet>
  )
}

function CardBody({ userId, onNavigate }: { userId: string; onNavigate: () => void }) {
  const me = useMe()
  const player = usePlayer(userId)
  const standings = useLeaderboard().data?.standings ?? []
  const standing = standings.find((s) => s.userId === userId)
  const online = useOnlinePlayers().find((p) => p.userId === userId)
  const room = online?.room ? gameById(online.room) : undefined

  if (!player) {
    return <p className="p-6 text-sm text-muted">This player is not on the list any more.</p>
  }

  return (
    <div className="scroll-quiet overflow-y-auto p-6 pt-8">
      <div className="flex items-center gap-4">
        <Avatar player={player} size="xl" />
        <div className="min-w-0">
          <p className="text-lg">
            <PlayerName player={player} />
          </p>
          <p className="text-sm text-muted">@{player.username}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
            <span
              className={`size-2 rounded-full ${online ? (online.status === 'away' ? 'bg-faint' : 'bg-online') : 'bg-border-strong'}`}
            />
            {online ? STATUS[online.status] : 'Offline'}
            {room && (
              <>
                {' in '}
                <Link to={`/room/${room.id}`} onClick={onNavigate} className="text-text underline">
                  {room.name}
                </Link>
              </>
            )}
          </p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
        <Stat label="Place">
          <span className={soleLeader(standings) === userId ? 'text-gold' : ''}>
            {standing ? `#${standing.rank}` : '–'}
          </span>
        </Stat>
        <Stat label="Net worth">
          {standing ? <AnimatedNumber value={standing.netWorth} /> : '–'}
        </Stat>
        <Stat label="Rank">{isTier(player.tier) ? TIER_LABELS[player.tier] : 'Base'}</Stat>
      </dl>

      <div className="mt-4 space-y-3">
        <Slot name="profile-sections" props={{ player }} />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {player.id !== me.id && <Slot name="profile-actions" props={{ player }} />}
        <Link
          to={player.id === me.id ? '/profile' : `/players/${player.username}`}
          onClick={onNavigate}
          className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-3"
        >
          {player.id === me.id ? 'Your profile' : 'Full profile'}
        </Link>
      </div>
    </div>
  )
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md bg-surface-2 px-2 py-2.5">
      <dt className="text-[0.7rem] tracking-wide text-faint uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums">{children}</dd>
    </div>
  )
}
