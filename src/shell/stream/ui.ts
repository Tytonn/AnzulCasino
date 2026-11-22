/**
 * What the stream shows: its filter, remembered in this browser, and which
 * side panel is open on a phone or a tablet.
 */
import { create } from 'zustand'

import { STREAM_FILTERS, type StreamFilter } from '../../../shared/chat.ts'

const FILTER_KEY = 'anzul.stream.filter'

function savedFilter(): StreamFilter {
  try {
    const saved = localStorage.getItem(FILTER_KEY)
    return STREAM_FILTERS.includes(saved as StreamFilter) ? (saved as StreamFilter) : 'all'
  } catch {
    return 'all'
  }
}

export type StreamPanel = 'board' | 'you'

interface StreamUi {
  filter: StreamFilter
  /** The panel open as a sheet (phone) or a drawer (tablet). */
  panel: StreamPanel | null
  /** The newest item the player has seen at the bottom, for the "new" pill. */
  seen: number
  /** Counts the requests to scroll to the bottom, such as sending a message. */
  bottom: number
  setFilter(filter: StreamFilter): void
  openPanel(panel: StreamPanel | null): void
  see(id: number): void
  /** Scrolls the stream to its newest item and follows it from there. */
  toBottom(): void
}

export const useStreamUi = create<StreamUi>((set) => ({
  filter: savedFilter(),
  panel: null,
  seen: 0,
  bottom: 0,
  setFilter: (filter) => {
    try {
      localStorage.setItem(FILTER_KEY, filter)
    } catch {
      // A private window: the filter lasts for this tab only.
    }
    set({ filter })
  },
  openPanel: (panel) => set({ panel }),
  see: (id) => set((state) => (id > state.seen ? { seen: id } : state)),
  toBottom: () => set((state) => ({ bottom: state.bottom + 1 })),
}))

export const FILTER_LABELS: Record<StreamFilter, string> = {
  all: 'Everything',
  chat: 'Chat only',
  games: 'Games only',
}
