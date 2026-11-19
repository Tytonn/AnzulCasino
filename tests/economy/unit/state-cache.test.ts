/**
 * The browser's cached economy state: a fetch that set off before a press
 * and lands after the press's answer must not undo it (the button just
 * pressed would show as ready again until the next fetch), while a newer
 * state, a new season or the season's end always comes through.
 */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import type { EconomyState } from '../../../shared/features/economy.ts'
import { economyKey, economyQuery, putEconomy } from '../../../src/features/economy/data.ts'

const READY_AT = '2026-11-19T23:30:00.000Z'

/** Just what the cache compares, and the work button's cooldown. */
function state(seasonId: number, version: number, work: string | null = null): EconomyState {
  return { seasonId, version, cooldowns: { work, hustle: null, crime: null } } as EconomyState
}

/** Sets off a fetch whose answer arrives when the test says, as on a slow network. */
function slowFetch(queryClient: QueryClient) {
  let answer: ((next: EconomyState | null) => void) | undefined
  const fetching = queryClient.fetchQuery({
    ...economyQuery,
    queryFn: () => new Promise<EconomyState | null>((resolve) => (answer = resolve)),
  })
  return async (next: EconomyState | null) => {
    answer?.(next)
    await fetching
  }
}

function cached(queryClient: QueryClient) {
  return queryClient.getQueryData<EconomyState | null>(economyKey)
}

describe('the cached economy state', () => {
  it('keeps a press answer that lands while an older fetch is on its way', async () => {
    const queryClient = new QueryClient()
    putEconomy(queryClient, state(1, 4))

    const land = slowFetch(queryClient)
    // The press commits after the fetch read the state, and answers first.
    putEconomy(queryClient, state(1, 5, READY_AT))
    await land(state(1, 4))

    expect(cached(queryClient)).toEqual(state(1, 5, READY_AT))
    queryClient.clear()
  })

  it('takes a fetched state that is as new or newer', async () => {
    const queryClient = new QueryClient()
    putEconomy(queryClient, state(1, 5, READY_AT))

    await slowFetch(queryClient)(state(1, 5))
    expect(cached(queryClient)).toEqual(state(1, 5))

    await slowFetch(queryClient)(state(1, 6, READY_AT))
    expect(cached(queryClient)).toEqual(state(1, 6, READY_AT))
    queryClient.clear()
  })

  it("takes a new season's state, and the season's end, whatever the versions", async () => {
    const queryClient = new QueryClient()
    putEconomy(queryClient, state(1, 40))

    await slowFetch(queryClient)(state(2, 1))
    expect(cached(queryClient)).toEqual(state(2, 1))

    await slowFetch(queryClient)(null)
    expect(cached(queryClient)).toBeNull()
    queryClient.clear()
  })

  it('keeps the newer of two press answers that arrive out of order', () => {
    const queryClient = new QueryClient()
    putEconomy(queryClient, state(1, 7, READY_AT))
    putEconomy(queryClient, state(1, 6))
    expect(cached(queryClient)).toEqual(state(1, 7, READY_AT))
    queryClient.clear()
  })
})
