/**
 * The right sidebar (spec: Desktop shell): the compact leaderboard always at
 * the top, then who is online and where, then chat filling the rest.
 */
import type { ReactNode } from 'react'

import { Chat } from './Chat.tsx'
import { Leaderboard } from './Leaderboard.tsx'
import { OnlineList } from './Online.tsx'

function Heading({ children }: { children: ReactNode }) {
  return (
    <h2 className="px-4 pt-3 pb-1.5 text-[0.7rem] font-semibold tracking-[0.12em] text-faint uppercase">
      {children}
    </h2>
  )
}

export function Sidebar() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <section aria-label="Leaderboard" className="shrink-0 pb-2">
        <Heading>Leaderboard</Heading>
        <Leaderboard limit={5} />
      </section>
      <section aria-label="Online" className="shrink-0 border-t border-border pb-2">
        <Heading>Online</Heading>
        <OnlineList />
      </section>
      <section aria-label="Chat" className="flex min-h-0 flex-1 flex-col border-t border-border">
        <Heading>Chat</Heading>
        <Chat />
      </section>
    </div>
  )
}
