/**
 * Who is online and where (spec: Social layer > Online list), grouped by
 * room so the whole group fits at a glance. A gold ring means in a hand; a
 * faded avatar means away. Click someone for their profile card.
 */
import { Link } from 'react-router'

import { Avatar } from '../../kit/PlayerName.tsx'
import { usePlayers } from '../../kit/queries.ts'
import { useOnlinePlayers } from '../../live/index.ts'
import type { OnlinePlayer } from '../../live/presence.ts'
import { gameById } from '../registry.ts'
import { useUi } from '../ui.ts'

const STATUS_TEXT = { active: 'here', playing: 'in a hand', away: 'away' } as const

interface Group {
  room: string | null
  label: string
  players: OnlinePlayer[]
}

function groups(online: readonly OnlinePlayer[]): Group[] {
  const byRoom = new Map<string, Group>()
  for (const player of online) {
    const key = player.room ?? ''
    let group = byRoom.get(key)
    if (!group) {
      const game = player.room ? gameById(player.room) : undefined
      group = {
        room: player.room,
        label: game?.name ?? (player.room ? player.room : 'Lobby'),
        players: [],
      }
      byRoom.set(key, group)
    }
    group.players.push(player)
  }
  // Rooms first, then the lobby (everywhere that is not a room).
  return [...byRoom.values()].sort(
    (a, b) => Number(a.room === null) - Number(b.room === null) || a.label.localeCompare(b.label),
  )
}

export function OnlineList() {
  const online = useOnlinePlayers()
  const { data: players } = usePlayers()
  const showProfile = useUi((s) => s.showProfile)

  if (!online.length) {
    return <p className="px-4 text-sm text-muted">Nobody else is here yet.</p>
  }

  return (
    <ul className="space-y-1 px-2">
      {groups(online).map((group) => (
        <li key={group.room ?? ''} className="flex items-center gap-2 rounded-sm px-2 py-1">
          {group.room ? (
            <Link
              to={`/room/${group.room}`}
              className="w-24 shrink-0 truncate text-xs font-medium text-muted hover:text-text"
            >
              {group.label}
            </Link>
          ) : (
            <span className="w-24 shrink-0 truncate text-xs text-faint">{group.label}</span>
          )}
          <span className="flex min-w-0 flex-wrap gap-1.5">
            {group.players.map((online) => {
              const player = players?.find((p) => p.id === online.userId)
              const name = player?.displayName ?? 'Someone'
              return (
                <button
                  key={online.userId}
                  type="button"
                  onClick={() => showProfile(online.userId)}
                  title={`${name}, ${STATUS_TEXT[online.status]}`}
                  aria-label={`${name}, ${STATUS_TEXT[online.status]}`}
                  className="rounded-full transition-transform hover:scale-110 active:scale-95"
                >
                  <Avatar
                    player={player}
                    size="sm"
                    ring={
                      online.status === 'playing'
                        ? 'playing'
                        : online.status === 'away'
                          ? 'away'
                          : undefined
                    }
                  />
                </button>
              )
            })}
          </span>
        </li>
      ))}
    </ul>
  )
}
