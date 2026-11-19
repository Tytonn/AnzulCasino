/** What is open in the shell: a phone sheet, the sidebar drawer, a profile card. */
import { create } from 'zustand'

export type SheetName = 'chat' | 'leaderboard'

interface UiState {
  sheet: SheetName | null
  /** Between 768 and 1100px the sidebar opens over the page. */
  drawer: boolean
  /** The player whose profile card is open. */
  profile: string | null
  /** The newest chat message this tab has shown, for the unread dot. */
  chatSeen: number
  openSheet(sheet: SheetName | null): void
  setDrawer(open: boolean): void
  showProfile(userId: string | null): void
  seeChat(id: number): void
}

export const useUi = create<UiState>((set) => ({
  sheet: null,
  drawer: false,
  profile: null,
  chatSeen: 0,
  openSheet: (sheet) => set({ sheet }),
  setDrawer: (drawer) => set({ drawer }),
  showProfile: (profile) => set({ profile }),
  seeChat: (id) => set((state) => (id > state.chatSeen ? { chatSeen: id } : state)),
}))
