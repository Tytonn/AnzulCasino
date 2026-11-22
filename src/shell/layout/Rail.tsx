/**
 * The left rail (spec: Desktop shell > Left rail): the logo, the rooms with a
 * count of who is inside, then Floor, Leaderboard, Shop, History, Profile,
 * and Admin for admins. Icons only below 1280px, to leave the room space.
 */
import { NavLink } from 'react-router'

import { useMe } from '../../kit/queries.ts'
import { useOnlinePlayers } from '../../live/index.ts'
import { Logo } from '../Logo.tsx'
import { FLOOR_NAV } from '../planned.ts'
import { games, railLinks } from '../registry.ts'

function itemClass({ isActive }: { isActive: boolean }) {
  return `group relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors ${
    isActive ? 'bg-surface-3 text-text' : 'text-muted hover:bg-surface-2 hover:text-text'
  }`
}

function ActiveBar() {
  return (
    <span className="absolute top-2 bottom-2 -left-2 w-1 rounded-r-full bg-accent opacity-0 group-aria-[current=page]:opacity-100" />
  )
}

export function Rail({ wide }: { wide: boolean }) {
  const me = useMe()
  const online = useOnlinePlayers()
  const inside = new Map<string, number>()
  for (const player of online) {
    if (player.room) inside.set(player.room, (inside.get(player.room) ?? 0) + 1)
  }
  const links = railLinks.filter((l) => !l.adminOnly || me.role === 'admin')
  const main = [FLOOR_NAV, ...links.filter((l) => l.group === 'main')]
  const more = links.filter((l) => l.group === 'more')

  return (
    <nav
      aria-label="Main"
      className={`scroll-quiet flex h-dvh flex-col overflow-y-auto border-r border-border bg-surface-1 py-4 ${wide ? 'w-60 px-3' : 'w-[4.5rem] items-center px-2'}`}
    >
      <NavLink
        to="/"
        className={`mb-6 flex h-10 items-center ${wide ? 'px-3' : 'justify-center'}`}
        aria-label="Anzul Casino, back to the stream"
      >
        <Logo compact={!wide} />
      </NavLink>

      <p
        className={`mb-1 px-3 text-[0.65rem] font-semibold tracking-[0.14em] text-faint uppercase ${wide ? '' : 'sr-only'}`}
      >
        Rooms
      </p>
      <ul className="w-full space-y-0.5">
        {games.map((game) => {
          const count = inside.get(game.id) ?? 0
          const Icon = game.icon
          return (
            <li key={game.id}>
              <NavLink
                to={`/room/${game.id}`}
                className={(state) => `${itemClass(state)} ${wide ? '' : 'justify-center px-0'}`}
                title={wide ? undefined : `${game.name}${count ? `, ${count} inside` : ''}`}
              >
                <ActiveBar />
                <span className="relative">
                  <Icon className="size-5 shrink-0" />
                  {!wide && count > 0 && (
                    <span className="absolute -top-1.5 -right-2 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[0.6rem] font-bold text-on-accent">
                      {count}
                    </span>
                  )}
                </span>
                {wide && (
                  <>
                    <span className="min-w-0 flex-1 truncate">{game.name}</span>
                    {count > 0 ? (
                      <span
                        className="flex items-center gap-1 text-xs text-online"
                        aria-label={`${count} inside`}
                      >
                        <span className="size-1.5 rounded-full bg-online" />
                        {count}
                      </span>
                    ) : (
                      !game.manifest && <span className="text-[0.65rem] text-faint">soon</span>
                    )}
                  </>
                )}
              </NavLink>
            </li>
          )
        })}
      </ul>

      <div className={`my-4 h-px bg-border ${wide ? 'mx-3' : 'w-8'}`} />

      <ul className="w-full space-y-0.5">
        {main.map((link) => {
          const Icon = link.icon
          return (
            <li key={link.to}>
              <NavLink
                to={link.to}
                end={link.to === FLOOR_NAV.to}
                className={(state) => `${itemClass(state)} ${wide ? '' : 'justify-center px-0'}`}
                title={wide ? undefined : link.label}
              >
                <ActiveBar />
                {Icon && <Icon className="size-5 shrink-0" />}
                {wide && <span className="truncate">{link.label}</span>}
              </NavLink>
            </li>
          )
        })}
      </ul>

      {more.length > 0 && (
        <ul
          className={`mt-auto w-full pt-4 ${wide ? 'flex flex-wrap gap-x-3 px-3' : 'space-y-0.5'}`}
        >
          {more.map((link) => {
            const Icon = link.icon
            return (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  className={({ isActive }) =>
                    wide
                      ? `text-xs ${isActive ? 'text-text' : 'text-faint hover:text-muted'}`
                      : `flex h-9 items-center justify-center rounded-md ${isActive ? 'text-text' : 'text-faint hover:text-muted'}`
                  }
                  title={wide ? undefined : link.label}
                >
                  {wide ? link.label : Icon && <Icon className="size-4" />}
                </NavLink>
              </li>
            )
          })}
        </ul>
      )}
    </nav>
  )
}
