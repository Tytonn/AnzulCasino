/**
 * The chat-first shell (spec: The stream > Layout, Tyton, Nov 22, 2026): one
 * shared stream of chat and game cards, with the message box at the bottom
 * and your own card pinned just above it.
 *
 * - 1100px and wider: the header (logo, the filters over the stream, the
 *   season clock), the board on the left, the stream in the middle, You on
 *   the right.
 * - 768 to 1100px: the stream and You; the board opens as a drawer.
 * - Under 768px: the stream fills the screen under a strip with your wallet
 *   and a timer; the board and You open as sheets.
 *
 * Every other page (the shop, the hall of fame, the admin panel) opens as a
 * panel over the stream, or full screen on a phone, and the stream keeps
 * running underneath.
 */
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, Suspense, useEffect } from 'react'
import { Link, matchPath, Outlet, useLocation, useNavigate } from 'react-router'

import { giveKeys, onShowCard } from '../../kit/cards.ts'
import { CelebrationLayer } from '../../kit/celebrate.tsx'
import { AnimatedNumber } from '../../kit/AnimatedNumber.tsx'
import { ChipIcon, PersonIcon, TrophyIcon } from '../../kit/icons.tsx'
import { useWallet } from '../../kit/queries.ts'
import { Sheet } from '../../kit/Sheet.tsx'
import { ReconnectingPill } from '../layout/ReconnectingPill.tsx'
import { SeasonClock } from '../layout/SeasonClock.tsx'
import { MeMenu, SoundToggle } from '../layout/TopBar.tsx'
import { Logo, LogoMark } from '../Logo.tsx'
import { DESK, TABLET, useMediaQuery, WIDE } from '../media.ts'
import { pages } from '../registry.ts'
import { ProfileCard } from '../side/ProfileCard.tsx'
import { Slot, useSlot } from '../Slot.tsx'
import { useTitle } from '../title.ts'
import { useUi } from '../ui.ts'
import { Composer } from './Composer.tsx'
import { addToStream, CardFeeds } from './live.ts'
import { BoardPanel, FilterPills, FilterSelect, YouPanel } from './panels.tsx'
import { Pinned } from './Pinned.tsx'
import { pinCard } from './pins.ts'
import { Stream } from './Stream.tsx'
import { useStreamUi } from './ui.ts'

/** The stream itself, at the home page. */
export function StreamHome() {
  useTitle(null)
  return null
}

/** A page's name for its panel's header. */
function pageTitle(pathname: string): string {
  if (pathname.startsWith('/setup')) return 'Setup'
  const entry = pages.find((page) => matchPath(page.path, pathname))
  return entry?.title ?? 'Not found'
}

function PageSkeleton() {
  return (
    <div className="space-y-4 p-6" aria-label="Loading">
      <div className="skeleton h-8 w-48" />
      <div className="skeleton h-64" />
    </div>
  )
}

/** A page over the stream, in its column: under the strip on a phone, between the panels on a desktop. */
function PagePanel() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const close = () => void navigate('/')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target?.closest('[role="dialog"], [role="menu"], input, textarea, select')) return
      navigate('/')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <section
      aria-label={pageTitle(pathname)}
      data-page-panel
      className="absolute inset-0 z-10 flex flex-col bg-bg"
    >
      <header className="flex h-12 shrink-0 items-center border-b border-border px-2">
        <button
          type="button"
          onClick={close}
          className="flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-text"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
            <path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          </svg>
          Back to the stream
        </button>
      </header>
      <div className="scroll-quiet flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="empty:hidden">
          <Slot name="banner" props={{}} />
        </div>
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </div>
    </section>
  )
}

/** Your new cards go in at once: into the stream, pinned above the box, with the keys. */
function useShowCards() {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      onShowCard((card) => {
        addToStream(queryClient, card)
        pinCard(card)
        const roundId = card.round?.id
        if (roundId) giveKeys(roundId)
      }),
    [queryClient],
  )
}

function Column({ page }: { page: boolean }) {
  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {!page && (
        <div className="empty:hidden">
          <Slot name="banner" props={{}} />
        </div>
      )}
      <Stream />
      <Pinned />
      <Composer active={!page} />
      {page ? <PagePanel /> : <Outlet />}
    </main>
  )
}

function HeaderButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void
  label: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface-1 px-3 text-xs font-semibold text-text hover:border-border-strong"
      aria-label={label}
    >
      {children}
    </button>
  )
}

function DeskHeader({ desk }: { desk: boolean }) {
  const openPanel = useStreamUi((s) => s.openPanel)
  return (
    <header className="z-20 grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border bg-glass px-4 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-3">
        <Link to="/" aria-label="Anzul Casino, the stream" className="flex h-10 items-center">
          <Logo />
        </Link>
        {!desk && (
          <HeaderButton onClick={() => openPanel('board')} label="Leaderboard and who is online">
            <TrophyIcon className="size-3.5" />
            Board
          </HeaderButton>
        )}
      </div>
      <FilterPills />
      <div className="flex min-w-0 items-center justify-end gap-3">
        <SeasonClock compact={!desk} />
        <SoundToggle />
        <MeMenu withSound={false} />
      </div>
    </header>
  )
}

/** Your chips, in the phone's strip: the vault is a tap away in You. */
function StripWallet() {
  const wallet = useWallet()
  return (
    <span role="group" aria-label="Your chips" className="flex shrink-0 items-center gap-1.5">
      <ChipIcon className="size-5 text-gold" />
      {wallet ? (
        <AnimatedNumber value={wallet.balance} className="text-base font-bold" />
      ) : (
        <span className="text-sm text-muted">–</span>
      )}
    </span>
  )
}

/** The phone's strip: your wallet and a timer, then the board, You and the filter. */
function PhoneStrip() {
  const openPanel = useStreamUi((s) => s.openPanel)
  const status = useSlot('stream-status')
  return (
    <header className="z-20 shrink-0 border-b border-border bg-glass pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="flex h-13 items-center gap-2.5 px-3">
        <Link to="/" aria-label="Anzul Casino, the stream" className="shrink-0 text-text">
          <LogoMark className="size-7" />
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <StripWallet />
          {status.length > 0 && (
            <span className="flex min-w-0 items-center gap-2 overflow-hidden">
              <span className="text-faint">·</span>
              <Slot name="stream-status" props={{}} />
            </span>
          )}
        </div>
        <HeaderButton onClick={() => openPanel('board')} label="Leaderboard and who is online">
          <TrophyIcon className="size-3.5" />
          <span className="max-[26rem]:sr-only">Board</span>
        </HeaderButton>
        <HeaderButton onClick={() => openPanel('you')} label="You: your wallet, timers and pages">
          <PersonIcon className="size-3.5" />
          <span className="max-[26rem]:sr-only">You</span>
        </HeaderButton>
        <FilterSelect />
      </div>
    </header>
  )
}

export function StreamShell() {
  const tablet = useMediaQuery(TABLET)
  const desk = useMediaQuery(DESK)
  const wide = useMediaQuery(WIDE)
  const panel = useStreamUi((s) => s.panel)
  const openPanel = useStreamUi((s) => s.openPanel)
  const { pathname } = useLocation()
  const page = pathname !== '/'
  useShowCards()

  // Walking into another page closes whatever was open over this one.
  useEffect(() => {
    useStreamUi.setState({ panel: null })
    useUi.setState({ profile: null })
  }, [pathname])

  const common = (
    <>
      <CardFeeds />
      <ProfileCard />
      <ReconnectingPill />
      <CelebrationLayer />
      <Slot name="overlay" props={{}} />
    </>
  )

  if (!tablet) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
        <PhoneStrip />
        <Column page={page} />
        <Sheet
          open={panel === 'board'}
          onClose={() => openPanel(null)}
          title="Leaderboard"
          placement="bottom"
        >
          <BoardPanel />
        </Sheet>
        <Sheet
          open={panel === 'you'}
          onClose={() => openPanel(null)}
          title="You"
          placement="bottom"
        >
          <YouPanel account />
        </Sheet>
        {common}
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <DeskHeader desk={desk} />
      <div className="flex min-h-0 flex-1">
        {desk && (
          <aside
            aria-label="The board"
            className={`shrink-0 border-r border-border bg-surface-1 ${wide ? 'w-72' : 'w-64'}`}
          >
            <BoardPanel />
          </aside>
        )}
        <Column page={page} />
        <aside
          aria-label="You"
          className={`shrink-0 border-l border-border bg-surface-1 ${wide ? 'w-80' : 'w-72'}`}
        >
          <YouPanel />
        </aside>
      </div>
      {!desk && (
        <Sheet
          open={panel === 'board'}
          onClose={() => openPanel(null)}
          title="The board"
          placement="right"
        >
          <BoardPanel />
        </Sheet>
      )}
      {common}
    </div>
  )
}
