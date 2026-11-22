/**
 * The admin panel (spec: Admin and trust > Admin panel): players and their
 * chips, giveaways, every setting, seasons, and invite codes, one tab each.
 * The tab is in the address (?tab=settings), so links and Back work. Every
 * action here lands on the public Audit page, and chip moves post in chat.
 */
import { type ReactNode, Suspense, lazy } from 'react'
import { Link, useSearchParams } from 'react-router'

import { PersonIcon, ScrollIcon, ShieldIcon } from '../../kit/icons.tsx'
import { CalendarIcon, GearIcon, GiftIcon, KeyIcon } from './icons.tsx'
import { SkeletonRows } from './ui.tsx'

const PlayersTab = lazy(() => import('./PlayersTab.tsx'))
const GiveawayTab = lazy(() => import('./GiveawayTab.tsx'))
const SettingsTab = lazy(() => import('./SettingsTab.tsx'))
const SeasonsTab = lazy(() => import('./SeasonsTab.tsx'))
const CodesTab = lazy(() => import('./CodesTab.tsx'))

export const TABS = [
  { id: 'players', label: 'Players', icon: PersonIcon, page: PlayersTab },
  { id: 'giveaway', label: 'Giveaway', icon: GiftIcon, page: GiveawayTab },
  { id: 'settings', label: 'Settings', icon: GearIcon, page: SettingsTab },
  { id: 'seasons', label: 'Seasons', icon: CalendarIcon, page: SeasonsTab },
  { id: 'codes', label: 'Codes', icon: KeyIcon, page: CodesTab },
] as const

export type TabId = (typeof TABS)[number]['id']

function TabLink({ id, current, children }: { id: TabId; current: boolean; children: ReactNode }) {
  return (
    <Link
      to={{ search: id === 'players' ? '' : `?tab=${id}` }}
      role="tab"
      aria-selected={current}
      aria-controls="admin-tab"
      replace
      className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[0.7rem] font-semibold transition duration-150 sm:h-9 sm:shrink-0 sm:flex-row sm:gap-1.5 sm:px-3 sm:py-0 sm:text-sm ${
        current
          ? 'bg-surface-3 text-text shadow-card'
          : 'text-muted hover:bg-surface-2 hover:text-text'
      }`}
    >
      {children}
    </Link>
  )
}

export default function AdminPage() {
  const [params] = useSearchParams()
  const asked = params.get('tab')
  const tab = TABS.find((t) => t.id === asked) ?? TABS[0]
  const Page = tab.page

  return (
    <div className="mx-auto w-full max-w-4xl p-4 pb-12 md:p-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <ShieldIcon className="size-4" />
            Every action here is public
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">Admin</h1>
        </div>
        <Link
          to="/audit"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-muted transition hover:border-border-strong hover:text-text"
        >
          <ScrollIcon className="size-4" />
          Audit log
        </Link>
      </header>

      <nav
        role="tablist"
        aria-label="Admin sections"
        className="mb-5 grid grid-cols-5 gap-1 border-b border-border pb-2 sm:flex"
      >
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <TabLink key={t.id} id={t.id} current={t.id === tab.id}>
              <Icon className="size-4.5 shrink-0 sm:size-4" />
              <span className="max-w-full truncate">{t.label}</span>
            </TabLink>
          )
        })}
      </nav>

      <div id="admin-tab" role="tabpanel" aria-label={tab.label}>
        <Suspense fallback={<SkeletonRows count={5} height="h-16" />}>
          <Page />
        </Suspense>
      </div>
    </div>
  )
}
