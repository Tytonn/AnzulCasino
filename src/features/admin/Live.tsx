/**
 * The admin lane's live news, mounted once for every player (the `overlay`
 * slot). Each admin action reaches every browser as `audit.logged`: it goes
 * to the top of any Audit page that is open, and refreshes what it changed.
 * A disabled or re-enabled account leaves or rejoins the player lists, and
 * the admin's own panel lists refresh. Nothing is drawn.
 */
import { type InfiniteData, useQueryClient } from '@tanstack/react-query'

import type { AuditPage } from '../../../shared/features/admin.ts'
import { queryKeys, useMe } from '../../kit/queries.ts'
import { useLiveEvent, useResync } from '../../live/index.ts'
import { addEntry, adminKeys, hearEntry } from './data.ts'

export function AdminLive() {
  const me = useMe()
  const queryClient = useQueryClient()
  const admin = me.role === 'admin'

  useLiveEvent('feed', 'audit.logged', (entry) => {
    hearEntry(entry)
    const lists = queryClient.getQueriesData<InfiniteData<AuditPage, number | undefined>>({
      queryKey: adminKeys.audit,
    })
    for (const [queryKey] of lists) {
      const kind = queryKey[2]
      if (kind !== 'all' && kind !== entry.kind) continue
      queryClient.setQueryData<InfiniteData<AuditPage, number | undefined>>(queryKey, (old) =>
        addEntry(old, entry),
      )
    }
    // A setting change may add or take back one waiting for the reset. A
    // refresh already on its way may predate this change, so start it over.
    if (entry.kind === 'config') void queryClient.invalidateQueries({ queryKey: adminKeys.audit })
    if (entry.action === 'player.disabled' || entry.action === 'player.enabled') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.players })
      void queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard })
    }
    if (!admin) return
    if (entry.kind === 'chips' || entry.kind === 'accounts') {
      void queryClient.invalidateQueries({ queryKey: adminKeys.players })
    }
    if (entry.kind === 'config') void queryClient.invalidateQueries({ queryKey: adminKeys.config })
    if (entry.kind === 'seasons')
      void queryClient.invalidateQueries({ queryKey: adminKeys.seasons })
    if (entry.action === 'reset_code.created') {
      void queryClient.invalidateQueries({ queryKey: adminKeys.invites })
    }
  })

  useResync(() => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.audit }, { cancelRefetch: false })
    if (admin) {
      void queryClient.invalidateQueries({ queryKey: adminKeys.players }, { cancelRefetch: false })
      void queryClient.invalidateQueries({ queryKey: adminKeys.config }, { cancelRefetch: false })
    }
  })

  return null
}
