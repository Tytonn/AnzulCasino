/**
 * The Audit page's list in the browser (spec: Admin and trust > The audit
 * page, new actions arriving live): each live entry lands once, in its
 * place, and a refresh that was read before an entry was saved never wipes
 * that entry off the page.
 */
import type { InfiniteData } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import type { AuditEntryView, AuditKind, AuditPage } from '../../../shared/features/admin.ts'
import { addEntry, hearEntry, inList, withHeard } from '../../../src/features/admin/data.ts'

function entry(id: number, kind: AuditKind | null = 'config'): AuditEntryView {
  return {
    id,
    at: '2026-11-22T01:24:31Z',
    action: kind === 'chips' ? 'chips.adjusted' : 'config.changed',
    kind,
    actor: null,
    target: null,
    before: null,
    after: null,
    reason: `Entry ${id}`,
    season: null,
    people: {},
  }
}

function page(ids: number[], more = false, kind: AuditKind | null = 'config'): AuditPage {
  return {
    entries: ids.map((id) => entry(id, kind)),
    more,
    pending: [],
    nextReset: '2026-11-22T10:00:00Z',
  }
}

const ids = (p: AuditPage | undefined) => p?.entries.map((e) => e.id)

describe('a refresh that missed what arrived live', () => {
  it('takes back an entry saved after it was read', () => {
    // The first save's refresh was read before the second save, then came
    // back after the second save had arrived live.
    const refreshed = withHeard(page([12, 7, 6]), null, [entry(12), entry(13)])
    expect(ids(refreshed)).toEqual([13, 12, 7, 6])
  })

  it('keeps each list to its own kind', () => {
    const chips = withHeard(page([5], false, 'chips'), 'chips', [entry(13), entry(14, 'chips')])
    expect(ids(chips)).toEqual([14, 5])
    expect(inList(entry(1, null), null)).toBe(true)
    expect(inList(entry(1, null), 'chips')).toBe(false)
  })

  it('leaves older entries to the pages below', () => {
    expect(ids(withHeard(page([20, 19], true), null, [entry(3), entry(21)]))).toEqual([21, 20, 19])
    expect(ids(withHeard(page([20, 19]), null, [entry(3)]))).toEqual([20, 19, 3])
  })

  it('changes nothing when the refresh has everything', () => {
    const fetched = page([13, 12])
    expect(withHeard(fetched, null, [entry(12), entry(13)])).toBe(fetched)
  })

  it('remembers the newest 100 entries heard in this tab', () => {
    for (let id = 1_001; id <= 1_101; id++) hearEntry(entry(id))
    hearEntry(entry(1_050))
    const heard = ids(withHeard(page([]), null)) ?? []
    expect(heard).toHaveLength(100)
    expect(heard[0]).toBe(1_101)
    expect(heard.at(-1)).toBe(1_002)
  })
})

describe('an entry arriving live', () => {
  const loaded = (pages: AuditPage[]): InfiniteData<AuditPage, number | undefined> => ({
    pages,
    pageParams: pages.map((_, i) => (i === 0 ? undefined : 100 - i)),
  })

  it('goes to the top once', () => {
    const before = loaded([page([12, 11], true), page([10])])
    const after = addEntry(before, entry(13))
    expect(ids(after?.pages[0])).toEqual([13, 12, 11])
    expect(ids(after?.pages[1])).toEqual([10])
    expect(addEntry(after, entry(13))).toBe(after)
    expect(addEntry(after, entry(10))).toBe(after)
  })

  it('takes its place when two arrive out of order', () => {
    const after = addEntry(addEntry(loaded([page([12])]), entry(14)), entry(13))
    expect(ids(after?.pages[0])).toEqual([14, 13, 12])
  })

  it('waits for a list that has not loaded', () => {
    expect(addEntry(undefined, entry(13))).toBeUndefined()
  })
})
