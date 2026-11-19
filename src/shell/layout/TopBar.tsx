/**
 * The top bar (spec: Desktop shell > Top bar): the wallet with an animated
 * count, the vault, the features' widgets (work, slut and crime, Collect,
 * shield pips, steal attempts), the season countdown and the sound toggle.
 * It is in every room on desktop and phone, so widgets are always in reach.
 *
 * On desktop the widgets sit between the wallet and the season clock while
 * they fit there. When they do not, the bar tightens: the widgets draw
 * compact, the sound toggle moves into the account menu and the clock goes
 * compact, as on a phone. Only when that is not enough do the widgets move to
 * a second line under the header, which costs every room some height. A row
 * that still has more than it can show scrolls sideways, and its edges fade
 * where widgets are hidden.
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
 * Where the widgets go on desktop: beside the wallet with the whole bar
 * (`roomy`), beside it in a tightened bar (`tight`), or on a second line
 * (`below`).
 */
type Fit = 'roomy' | 'tight' | 'below'

/** The room to spare, in pixels, before the widgets move back to a looser fit. */
const SPARE = 24

/** The sound toggle and the gap before it, which a tight bar leaves out: 2.25rem and 1rem. */
const SOUND_REM = 3.25

function widthOf(element: Element | null): number {
  return element ? element.getBoundingClientRect().width : 0
}

/** The room a tight bar adds beside the wallet: the sound toggle, and what the compact clock saves. */
function tightSaving(right: HTMLElement): number {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const clock =
    widthOf(right.querySelector('[data-clock="full"]')) -
    widthOf(right.querySelector('[data-clock="compact"]'))
  return SOUND_REM * rem + Math.max(0, clock)
}

/**
 * Picks the fit from the widgets' width and the room between the wallet and
 * the clock. Compact widgets cannot be measured until they are drawn, so a
 * tight bar is tried, and how far it fell short is remembered: from the
 * second line it is tried again only once there is that much more room, or
 * the widgets are that much narrower, with some to spare. Each new fit is
 * measured before the browser paints, so one that does not work is never
 * seen. A looser fit always needs room to spare, so a countdown that changes
 * width every second cannot make the header jump.
 */
function useWidgetFit(
  room: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  right: RefObject<HTMLElement | null>,
): Fit {
  const [fit, setFit] = useState<Fit>('roomy')
  const memory = useRef({
    /** The fit on the page, which the room and the widgets were measured in. */
    shown: 'roomy' as Fit,
    /** The widgets' full width, from the last time they were drawn full size. */
    full: 0,
    /** When a tight bar last did not fit: the room a full bar had, the widgets' full width, and how far it fell short. */
    failed: null as { room: number; full: number; short: number } | null,
  })
  const measure = useRef(() => {})

  useLayoutEffect(() => {
    const space = room.current
    const widgets = content.current
    const cluster = right.current
    if (!space || !widgets || !cluster) return
    measure.current = () => {
      const m = memory.current
      const have = widthOf(space)
      const need = widthOf(widgets)
      if (m.shown === 'tight') {
        const roomy = have - tightSaving(cluster)
        if (need > have) {
          m.failed = { room: roomy, full: m.full, short: need - have }
          setFit('below')
        } else if (m.full <= roomy - SPARE) {
          m.failed = null
          setFit('roomy')
        } else setFit('tight')
        return
      }
      m.full = need
      if (need <= have - (m.shown === 'below' ? SPARE : 0)) {
        m.failed = null
        setFit('roomy')
        return
      }
      const failed = m.failed
      const retry =
        !failed ||
        have - failed.room >= failed.short + SPARE ||
        failed.full - need >= failed.short + SPARE
      setFit(retry ? 'tight' : 'below')
    }
    measure.current()
    const observer = new ResizeObserver(() => measure.current())
    observer.observe(space)
    observer.observe(widgets)
    observer.observe(cluster)
    return () => observer.disconnect()
  }, [room, content, right])

  useLayoutEffect(() => {
    memory.current.shown = fit
    measure.current()
  }, [fit])

  return fit
}

export function TopBar() {
  const room = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const right = useRef<HTMLDivElement>(null)
  const fit = useWidgetFit(room, content, right)
  const tight = fit === 'tight'
  return (
    <header
      data-widgets={fit === 'below' ? 'below' : 'inline'}
      data-fit={fit}
      className="sticky top-0 z-20 grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[calc(4rem-1px)] items-center gap-x-4 border-b border-border bg-glass px-5 backdrop-blur-md"
    >
      <div className="col-start-1 row-start-1 flex min-w-0 items-center">
        <Wallet compact={false} />
      </div>
      {/* The room between the wallet and the clock, measured whichever line the widgets are on. */}
      <div ref={room} aria-hidden="true" className="col-start-2 row-start-1 h-px" />
      <WidgetRow
        compact={tight}
        content={content}
        className={
          fit === 'below'
            ? 'col-span-full row-start-2 -mx-5 px-5 pb-2.5'
            : 'col-start-2 row-start-1'
        }
      />
      <div ref={right} className="col-start-3 row-start-1 flex items-center gap-4">
        <SeasonClock compact={tight} measured />
        {!tight && <SoundToggle />}
        <SidebarButton />
        <MeMenu withSound={tight} />
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
