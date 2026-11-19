/**
 * The top bar (spec: Desktop shell > Top bar): the wallet with an animated
 * count, the vault, the features' widgets (work, slut and crime, Collect,
 * shield pips, steal attempts), the season countdown and the sound toggle.
 * It is in every room on desktop and phone, so widgets are always in reach.
 *
 * On desktop the widgets sit between the wallet and the season clock while
 * they fit there, and move to a second line under the header when they do
 * not, as on a phone. A row that still has more than it can show scrolls
 * sideways, and its edges fade where widgets are hidden.
 */
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Link } from 'react-router'

import { api, ApiError, errorMessage } from '../../kit/api.ts'
import { AnimatedNumber } from '../../kit/AnimatedNumber.tsx'
import {
  ChatIcon,
  ChipIcon,
  LogoutIcon,
  PersonIcon,
  ShieldIcon,
  SoundOffIcon,
  SoundOnIcon,
  VaultIcon,
} from '../../kit/icons.tsx'
import { Avatar, PlayerName } from '../../kit/PlayerName.tsx'
import { useMe, usePlayer, useWallet } from '../../kit/queries.ts'
import { saveSound, useSound } from '../../kit/sound.ts'
import { toast } from '../../kit/toast.tsx'
import { LogoMark } from '../Logo.tsx'
import { Slot, useSlot } from '../Slot.tsx'
import { useUi } from '../ui.ts'
import { SeasonClock } from './SeasonClock.tsx'

function Wallet({ compact }: { compact: boolean }) {
  const wallet = useWallet()
  return (
    <div className="flex min-w-0 items-center gap-2" aria-label="Your chips">
      <ChipIcon className={`${compact ? 'size-5' : 'size-6'} shrink-0 text-gold`} />
      <div className="min-w-0 leading-tight">
        <span className="block text-[0.6rem] tracking-[0.1em] text-faint uppercase">Wallet</span>
        {wallet ? (
          <AnimatedNumber
            value={wallet.balance}
            className={`${compact ? 'text-base' : 'text-lg'} font-bold`}
          />
        ) : (
          <span className="text-sm text-muted">–</span>
        )}
      </div>
      {wallet && (
        <div className="ml-1 min-w-0 leading-tight" title="Vault: safe from steals">
          <span className="flex items-center gap-1 text-[0.6rem] tracking-[0.1em] text-faint uppercase">
            <VaultIcon className="size-3" />
            Vault
          </span>
          <AnimatedNumber value={wallet.vault} className="text-sm font-semibold text-muted" />
        </div>
      )}
    </div>
  )
}

function SoundToggle({ className = '' }: { className?: string }) {
  const muted = useSound((s) => s.muted)
  return (
    <button
      type="button"
      onClick={() => saveSound({ muted: !muted }).catch((e) => toast.error(errorMessage(e)))}
      aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
      aria-pressed={!muted}
      title={muted ? 'Sound off' : 'Sound on'}
      className={`grid size-9 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-text active:scale-95 ${className}`}
    >
      {muted ? <SoundOffIcon className="size-5" /> : <SoundOnIcon className="size-5" />}
    </button>
  )
}

function MeMenu({ withSound }: { withSound: boolean }) {
  const me = useMe()
  const player = usePlayer(me.id)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const muted = useSound((s) => s.muted)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !box.current?.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  async function logout() {
    try {
      await api.post('/api/auth/logout')
    } catch (error) {
      // A 4xx means there is no session left to end. Anything else (offline,
      // a server error) may have left the session cookie in place.
      const gone = error instanceof ApiError && error.status >= 400 && error.status < 500
      if (!gone) {
        toast.error(`Could not log out. ${errorMessage(error)}`)
        return
      }
    }
    // A fresh page load, so nothing of this player stays in memory on a
    // shared device: caches, the live connection and every store start over.
    window.location.replace('/login')
  }

  const who = player ?? { ...me, tier: 'base' }
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Your account"
        className="rounded-full p-0.5 hover:bg-surface-3 active:scale-95"
      >
        <Avatar player={who} size="sm" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-11 right-0 z-30 w-60 rounded-md border border-border bg-surface-2 p-1.5 shadow-pop"
        >
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <Avatar player={who} size="md" />
            <div className="min-w-0">
              <PlayerName player={who} />
              <p className="truncate text-xs text-muted">@{me.username}</p>
            </div>
          </div>
          <div className="my-1 h-px bg-border" />
          <MenuLink
            to="/profile"
            onClick={() => setOpen(false)}
            icon={<PersonIcon className="size-4" />}
          >
            Your profile
          </MenuLink>
          {me.role === 'admin' && (
            <MenuLink
              to="/setup"
              onClick={() => setOpen(false)}
              icon={<ShieldIcon className="size-4" />}
            >
              Setup: invites and seasons
            </MenuLink>
          )}
          {withSound && (
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                saveSound({ muted: !muted }).catch((e) => toast.error(errorMessage(e)))
              }
              className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-surface-3"
            >
              {muted ? <SoundOffIcon className="size-4" /> : <SoundOnIcon className="size-4" />}
              {muted ? 'Sound is off' : 'Sound is on'}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => void logout()}
            className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm text-muted hover:bg-surface-3 hover:text-text"
          >
            <LogoutIcon className="size-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  )
}

function MenuLink({
  to,
  onClick,
  icon,
  children,
}: {
  to: string
  onClick: () => void
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm hover:bg-surface-3"
    >
      {icon}
      {children}
    </Link>
  )
}

/** Between 768 and 1100px the sidebar opens from this button. */
function SidebarButton() {
  const setDrawer = useUi((s) => s.setDrawer)
  return (
    <button
      type="button"
      onClick={() => setDrawer(true)}
      aria-label="Open leaderboard, online list and chat"
      className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-text active:scale-95 desk:hidden"
    >
      <ChatIcon className="size-5" />
    </button>
  )
}

/** How far a row's edge fades where more widgets are hidden. */
const FADE = '1.5rem'

/** A mask that fades the sides a scrolling row has more widgets beyond. */
function fadeMask(left: boolean, right: boolean): CSSProperties | undefined {
  if (!left && !right) return undefined
  const start = left ? `transparent, black ${FADE}` : 'black'
  const end = right ? `black calc(100% - ${FADE}), transparent` : 'black'
  const mask = `linear-gradient(to right, ${start}, ${end})`
  return { maskImage: mask, WebkitMaskImage: mask }
}

/** Which ends of a sideways-scrolling row have widgets hidden beyond them. */
function useHiddenEnds(
  row: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
): { left: boolean; right: boolean } {
  const [ends, setEnds] = useState({ left: false, right: false })
  useLayoutEffect(() => {
    const scroller = row.current
    const widgets = content.current
    if (!scroller || !widgets) return
    const update = () => {
      const max = scroller.scrollWidth - scroller.clientWidth
      const left = scroller.scrollLeft > 1
      const right = scroller.scrollLeft < max - 1
      setEnds((was) => (was.left === left && was.right === right ? was : { left, right }))
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    observer.observe(widgets)
    return () => {
      scroller.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [row, content])
  return ends
}

/**
 * The features' widgets in one row. It scrolls sideways when they do not fit,
 * and hides itself while every widget draws nothing, such as between seasons.
 */
function WidgetRow({
  compact,
  content,
  className,
}: {
  compact: boolean
  /** The widgets themselves, at their natural width. */
  content: RefObject<HTMLDivElement | null>
  className: string
}) {
  const row = useRef<HTMLDivElement>(null)
  const { left, right } = useHiddenEnds(row, content)
  return (
    <div
      ref={row}
      data-slot="top-bar"
      className={`scroll-quiet flex overflow-x-auto has-[>:empty]:hidden ${className}`}
      style={fadeMask(left, right)}
    >
      <div ref={content} data-top-bar-content className="flex w-max shrink-0 items-center gap-2">
        <Slot name="top-bar" props={{ compact }} />
      </div>
    </div>
  )
}

/**
 * Whether the widgets need the second line: they are wider than the room
 * between the wallet and the clock. Once there, they come back only with
 * some room to spare, so a countdown that changes width every second cannot
 * make the header jump between one line and two.
 */
function useWidgetsBelow(
  room: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
): boolean {
  const [below, setBelow] = useState(false)
  useLayoutEffect(() => {
    const space = room.current
    const widgets = content.current
    if (!space || !widgets) return
    const measure = () => {
      const need = widgets.getBoundingClientRect().width
      const have = space.getBoundingClientRect().width
      setBelow((was) => need > (was ? have - SPARE : have))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(space)
    observer.observe(widgets)
    return () => observer.disconnect()
  }, [room, content])
  return below
}

/** The room to spare, in pixels, before widgets on the second line move back up. */
const SPARE = 24

export function TopBar() {
  const room = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const below = useWidgetsBelow(room, content)
  return (
    <header
      data-widgets={below ? 'below' : 'inline'}
      className="sticky top-0 z-20 grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[calc(4rem-1px)] items-center gap-x-4 border-b border-border bg-glass px-5 backdrop-blur-md"
    >
      <div className="col-start-1 row-start-1 flex min-w-0 items-center">
        <Wallet compact={false} />
      </div>
      {/* The room between the wallet and the clock, measured whichever line the widgets are on. */}
      <div ref={room} aria-hidden="true" className="col-start-2 row-start-1 h-px" />
      <WidgetRow
        compact={false}
        content={content}
        className={
          below ? 'col-span-full row-start-2 -mx-5 px-5 pb-2.5' : 'col-start-2 row-start-1'
        }
      />
      <div className="col-start-3 row-start-1 flex items-center gap-4">
        <SeasonClock />
        <SoundToggle />
        <SidebarButton />
        <MeMenu withSound={false} />
      </div>
    </header>
  )
}

/** The phone's top bar: the wallet and clock, then a row of widgets when there are any. */
export function PhoneTopBar() {
  const widgets = useSlot('top-bar')
  const content = useRef<HTMLDivElement>(null)
  return (
    <header className="sticky top-0 z-20 shrink-0 border-b border-border bg-glass pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="flex h-14 items-center gap-3 px-4">
        <Link to="/" aria-label="Floor" className="shrink-0 text-text">
          <LogoMark className="size-7" />
        </Link>
        <div className="min-w-0 flex-1">
          <Wallet compact />
        </div>
        <SeasonClock compact />
        <MeMenu withSound />
      </div>
      {widgets.length > 0 && (
        <WidgetRow compact content={content} className="h-11 items-center px-4 pb-1" />
      )}
    </header>
  )
}
