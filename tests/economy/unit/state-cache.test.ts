/**
 * The browser's cached economy state: a fetch that started before a press
 * and lands after the press's answer must not undo it (the button would show
 * as ready again until the next fetch), while a newer state, a new season or
 * the season's end always comes through.
 */
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EconomyState, EconomyStateResponse } from '../../../shared/features/economy.ts'
import { api } from '../../../src/kit/api.ts'
import { economyKey, fetchEconomy, putEconomy } from '../../../src/features/economy/data.ts'

const READY_AT = '2026-11-19T23:30:00.000Z'

/** Just what the cache compares, and the work button's cooldown. */
function state(seasonId: number, version: number, work: string | null = null): EconomyState {
  return { seasonId, version, cooldowns: { work, hustle: null, crime: null } } as EconomyState
}

/** The next GET of the state, answered when the test says so. */
function holdNextFetch(): (answer: EconomyState | null) => void {
  let answer!: (response: EconomyStateResponse) => void
  vi.spyOn(api, 'get').mockImplementationOnce(
    () => new Promise((resolve) => (answer = resolve as (response: EconomyStateResponse) => void)),
  )
  return (next) => answer({ state: next })
}

function refetch(queryClient: QueryClient) {
  return queryClient.fetchQuery({ queryKey: economyKey, queryFn: () => fetchEconomy(queryClient) })
}

function cached(queryClient: QueryClient) {
  return queryClient.getQueryData<EconomyState | null>(economyKey)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the cached economy state', () => {
  it('keeps a press answer that lands while an older fetch is on its way', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(economyKey, state(1, 4))

    const land = holdNextFetch()
    const fetching = refetch(queryClient)
    // The press commits after the fetch read the state, and answers first.
    putEconomy(queryClient, state(1, 5, READY_AT))
    land(state(1, 4))
    await fetching

    expect(cached(queryClient)).toEqual(state(1, 5, READY_AT))
  })

  it('takes a fetched state that is as new or newer', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(economyKey, state(1, 5, READY_AT))

    const same = holdNextFetch()
    const first = refetch(queryClient)
    same(state(1, 5))
    await first
    expect(cached(queryClient)).toEqual(state(1, 5))

    const newer = holdNextFetch()
    const second = refetch(queryClient)
    newer(state(1, 6, READY_AT))
    await second
    expect(cached(queryClient)).toEqual(state(1, 6, READY_AT))
  })

  it("takes a new season's state, and the season's end, whatever the versions", async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(economyKey, state(1, 40))

    const next = holdNextFetch()
    const first = refetch(queryClient)
    next(state(2, 1))
    await first
    expect(cached(queryClient)).toEqual(state(2, 1))

    const over = holdNextFetch()
    const second = refetch(queryClient)
    over(null)
    await second
    expect(cached(queryClient)).toBeNull()
  })

  it('keeps the newer of two press answers that arrive out of order', () => {
    const queryClient = new QueryClient()
    putEconomy(queryClient, state(1, 7, READY_AT))
    putEconomy(queryClient, state(1, 6))
    expect(cached(queryClient)).toEqual(state(1, 7, READY_AT))
  })
})
