/**
 * The phone's tab bar (spec: Phone): Floor, Chat, Leaderboard, Shop,
 * Profile. Chat and Leaderboard open as sheets over the room, so a game
 * keeps going underneath.
 */
import { NavLink } from 'react-router'

import { BagIcon, ChatIcon, FloorIcon, PersonIcon, TrophyIcon } from '../../kit/icons.tsx'
import { useMe } from '../../kit/queries.ts'
import { useChat } from '../side/Chat.tsx'
import { type SheetName, useUi } from '../ui.ts'

const tab =
  'relative flex flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-[0.65rem] font-medium transition-colors active:scale-95'

export function PhoneTabs() {
  const me = useMe()
  const sheet = useUi((s) => s.sheet)
  const openSheet = useUi((s) => s.openSheet)
  const chatSeen = useUi((s) => s.chatSeen)
  const last = useChat().data?.messages.at(-1)
  const unread = last !== undefined && last.id > chatSeen && last.userId !== me.id

  const sheetTab = (name: SheetName, label: string, Icon: typeof ChatIcon, dot = false) => (
    <button
      type="button"
      onClick={() => openSheet(sheet === name ? null : name)}
      aria-pressed={sheet === name}
      className={`${tab} ${sheet === name ? 'text-text' : 'text-muted'}`}
    >
      <span className="relative">
        <Icon className="size-6" />
        {dot && (
          <span className="absolute -top-0.5 -right-1 size-2.5 rounded-full border-2 border-surface-1 bg-accent" />
        )}
      </span>
      {label}
    </button>
  )

  const linkTab = (to: string, label: string, Icon: typeof ChatIcon) => (
    <NavLink
      to={to}
      end={to === '/classic'}
      onClick={() => openSheet(null)}
      className={({ isActive }) => `${tab} ${isActive && !sheet ? 'text-text' : 'text-muted'}`}
    >
      <Icon className="size-6" />
      {label}
    </NavLink>
  )

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface-1 pb-[env(safe-area-inset-bottom)]"
    >
      {linkTab('/classic', 'Floor', FloorIcon)}
      {sheetTab('chat', 'Chat', ChatIcon, unread)}
      {sheetTab('leaderboard', 'Leaderboard', TrophyIcon)}
      {linkTab('/shop', 'Shop', BagIcon)}
      {linkTab('/profile', 'Profile', PersonIcon)}
    </nav>
  )
}
