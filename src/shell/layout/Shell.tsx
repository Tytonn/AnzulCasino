/**
 * The page around every room (spec: Site layout and feel). The game sits in
 * the middle and the group wraps around it:
 *
 * - 1100px and wider: the rail, the top bar and ticker over the center, the
 *   sidebar on the right. The rail shows labels from 1280px.
 * - 768 to 1100px: the same, with the sidebar behind a button.
 * - Under 768px: the room fills the screen; a tab bar opens chat and the
 *   leaderboard as sheets over it.
 */
import { type ReactNode, Suspense, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router'

import { DESK, TABLET, useMediaQuery, WIDE } from '../media.ts'
import { Chat } from '../side/Chat.tsx'
import { Leaderboard } from '../side/Leaderboard.tsx'
import { OnlineList } from '../side/Online.tsx'
import { ProfileCard } from '../side/ProfileCard.tsx'
import { Sidebar } from '../side/Sidebar.tsx'
import { Slot } from '../Slot.tsx'
import { useUi } from '../ui.ts'
import { PhoneTabs } from './PhoneTabs.tsx'
import { Rail } from './Rail.tsx'
import { ReconnectingPill } from './ReconnectingPill.tsx'
import { Sheet } from './Sheet.tsx'
import { Ticker } from './Ticker.tsx'
import { PhoneTopBar, TopBar } from './TopBar.tsx'

function PageSkeleton() {
  return (
    <div className="space-y-4 p-6" aria-label="Loading">
      <div className="skeleton h-8 w-48" />
      <div className="skeleton h-64" />
    </div>
  )
}

function Center({ children }: { children?: ReactNode }) {
  return (
    <>
      <div className="empty:hidden">
        <Slot name="banner" props={{}} />
      </div>
      <Suspense fallback={<PageSkeleton />}>{children ?? <Outlet />}</Suspense>
    </>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="px-4 pt-3 pb-1.5 text-[0.7rem] font-semibold tracking-[0.12em] text-faint uppercase">
      {children}
    </h3>
  )
}

export function Shell() {
  const tablet = useMediaQuery(TABLET)
  const desk = useMediaQuery(DESK)
  const wide = useMediaQuery(WIDE)
  const sheet = useUi((s) => s.sheet)
  const openSheet = useUi((s) => s.openSheet)
  const drawer = useUi((s) => s.drawer)
  const setDrawer = useUi((s) => s.setDrawer)
  const { pathname } = useLocation()

  // Walking into another page closes whatever was open over this one.
  useEffect(() => {
    useUi.setState({ sheet: null, drawer: false, profile: null })
  }, [pathname])

  const common = (
    <>
      <ProfileCard />
      <ReconnectingPill />
      <Slot name="overlay" props={{}} />
    </>
  )

  if (!tablet) {
    return (
      <div className="flex min-h-dvh flex-col pb-[calc(3.6rem+env(safe-area-inset-bottom))]">
        <PhoneTopBar />
        <Ticker />
        <main className="flex min-h-0 flex-1 flex-col">
          <Center />
        </main>
        <PhoneTabs />
        <Sheet
          open={sheet === 'chat'}
          onClose={() => openSheet(null)}
          title="Chat"
          placement="bottom"
        >
          <Chat />
        </Sheet>
        <Sheet
          open={sheet === 'leaderboard'}
          onClose={() => openSheet(null)}
          title="Leaderboard"
          placement="bottom"
        >
          <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto pb-4">
            <Leaderboard />
            <SectionTitle>Online</SectionTitle>
            <OnlineList />
          </div>
        </Sheet>
        {common}
      </div>
    )
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <Rail wide={wide} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <Ticker />
        <main className="scroll-quiet flex min-h-0 flex-1 flex-col overflow-y-auto">
          <Center />
        </main>
      </div>
      {desk ? (
        <aside
          aria-label="The table"
          className="h-dvh w-80 shrink-0 border-l border-border bg-surface-1"
        >
          <Sidebar />
        </aside>
      ) : (
        <Sheet
          open={drawer}
          onClose={() => setDrawer(false)}
          title="The table"
          placement="right"
          hideTitle
        >
          <Sidebar />
        </Sheet>
      )}
      {common}
    </div>
  )
}
