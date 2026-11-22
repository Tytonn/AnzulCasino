/**
 * The admin lane's data in the browser: the panel's lists, the settings, the
 * seasons and codes the foundation serves, and the Audit page a page at a
 * time. Nothing polls; the live news in Live.tsx keeps them current.
 */
import { type InfiniteData, useInfiniteQuery, useQuery } from '@tanstack/react-query'

import type { InviteCodeView } from '../../../shared/accounts.ts'
import type {
  AdminConfigState,
  AdminPlayersResponse,
  AuditEntryView,
  AuditKind,
  AuditPage,
} from '../../../shared/features/admin.ts'
import type { SeasonView } from '../../../shared/seasons.ts'
import { api } from '../../kit/api.ts'

export const adminKeys = {
  players: ['admin', 'players'] as const,
  config: ['admin', 'config'] as const,
  /** Every Audit page list; each kind's list adds its kind. */
  audit: ['admin', 'audit'] as const,
  /** The foundation's GET /api/seasons, which the setup page reads too. */
  seasons: ['seasons'] as const,
  invites: ['invites'] as const,
}

export function auditKey(kind: AuditKind | null) {
  return [...adminKeys.audit, kind ?? 'all'] as const
}

export function useAdminPlayers() {
  return useQuery({
    queryKey: adminKeys.players,
    queryFn: () => api.get<AdminPlayersResponse>('/api/admin/players'),
  })
}

export function useAdminConfig() {
  return useQuery({
    queryKey: adminKeys.config,
    queryFn: () => api.get<AdminConfigState>('/api/admin/config'),
  })
}

export function useSeasons() {
  return useQuery({
    queryKey: adminKeys.seasons,
    queryFn: async () => (await api.get<{ seasons: SeasonView[] }>('/api/seasons')).seasons,
  })
}

export function useInvites() {
  return useQuery({
    queryKey: adminKeys.invites,
    queryFn: async () => (await api.get<{ codes: InviteCodeView[] }>('/api/invites')).codes,
  })
}

export function useAuditLog(kind: AuditKind | null) {
  return useInfiniteQuery({
    queryKey: auditKey(kind),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams()
      if (pageParam !== undefined) params.set('before', String(pageParam))
      if (kind) params.set('kind', kind)
      const query = params.toString()
      const page = await api.get<AuditPage>(`/api/admin/audit${query ? `?${query}` : ''}`)
      return pageParam === undefined ? withHeard(page, kind) : page
    },
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.more ? last.entries.at(-1)?.id : undefined),
  })
}

/** Whether an entry belongs in the list of one kind (null: every kind). */
export function inList(entry: AuditEntryView, kind: AuditKind | null): boolean {
  return kind === null || entry.kind === kind
}

/** Newest first, as the server lists them. */
function newestFirst(entries: AuditEntryView[]): AuditEntryView[] {
  return entries.sort((a, b) => b.id - a.id)
}

/** Puts a new entry in a loaded Audit list, once, in its place at the top. */
export function addEntry(
  old: InfiniteData<AuditPage, number | undefined> | undefined,
  entry: AuditEntryView,
): InfiniteData<AuditPage, number | undefined> | undefined {
  const first = old?.pages[0]
  if (!old || !first) return old
  if (old.pages.some((page) => page.entries.some((e) => e.id === entry.id))) return old
  return {
    ...old,
    pages: [{ ...first, entries: newestFirst([entry, ...first.entries]) }, ...old.pages.slice(1)],
  }
}

/**
 * The newest entries live news brought to this tab. A fetch of the list that
 * was read before one of them was saved comes back without it, and would
 * wipe it off the page: an admin who saved twice within a second saw the
 * second save vanish while the first one's refresh was on its way. So every
 * first page fetched takes them back in (withHeard).
 */
const heard = new Map<number, AuditEntryView>()
const HEARD_KEPT = 100

/** Notes an entry that arrived live. */
export function hearEntry(entry: AuditEntryView) {
  heard.delete(entry.id)
  heard.set(entry.id, entry)
  if (heard.size > HEARD_KEPT) {
    const oldest = heard.keys().next()
    if (!oldest.done) heard.delete(oldest.value)
  }
}

/** A first page as fetched, with the entries heard live that it missed and that belong on it. */
export function withHeard(
  page: AuditPage,
  kind: AuditKind | null,
  live: Iterable<AuditEntryView> = heard.values(),
): AuditPage {
  const known = new Set(page.entries.map((e) => e.id))
  // An entry older than the page's last one belongs to a page further down.
  const below = page.more ? (page.entries.at(-1)?.id ?? 0) : 0
  const missed = [...live].filter((e) => !known.has(e.id) && e.id > below && inList(e, kind))
  if (missed.length === 0) return page
  return { ...page, entries: newestFirst([...page.entries, ...missed]) }
}
