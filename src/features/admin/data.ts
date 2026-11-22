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
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (pageParam !== undefined) params.set('before', String(pageParam))
      if (kind) params.set('kind', kind)
      const query = params.toString()
      return api.get<AuditPage>(`/api/admin/audit${query ? `?${query}` : ''}`)
    },
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.more ? last.entries.at(-1)?.id : undefined),
  })
}

/** Puts a new entry at the top of a loaded Audit list, once. */
export function addEntry(
  old: InfiniteData<AuditPage, number | undefined> | undefined,
  entry: AuditEntryView,
): InfiniteData<AuditPage, number | undefined> | undefined {
  const first = old?.pages[0]
  if (!old || !first) return old
  if (old.pages.some((page) => page.entries.some((e) => e.id === entry.id))) return old
  return {
    ...old,
    pages: [{ ...first, entries: [entry, ...first.entries] }, ...old.pages.slice(1)],
  }
}
