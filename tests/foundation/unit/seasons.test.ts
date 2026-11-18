import { describe, expect, it } from 'vitest'

import { CreateSeasonInput, seasonPhase, takesBets } from '../../../shared/seasons.ts'

const season = {
  startsAt: new Date('2026-12-01T10:00:00Z'),
  endsAt: new Date('2026-12-31T10:00:00Z'),
}
const at = (iso: string) => new Date(iso)

describe('season phases', () => {
  it('follow the clock exactly', () => {
    expect(seasonPhase(season, at('2026-12-01T09:59:59.999Z'), 24)).toBe('upcoming')
    expect(seasonPhase(season, at('2026-12-01T10:00:00Z'), 24)).toBe('open')
    expect(seasonPhase(season, at('2026-12-30T09:59:59.999Z'), 24)).toBe('open')
    expect(seasonPhase(season, at('2026-12-30T10:00:00Z'), 24)).toBe('final_day')
    expect(seasonPhase(season, at('2026-12-31T09:59:59.999Z'), 24)).toBe('final_day')
    // The end is exact: at the end time the season is over.
    expect(seasonPhase(season, at('2026-12-31T10:00:00Z'), 24)).toBe('over')
  })

  it('take bets from the start until the end, final day included', () => {
    expect(['upcoming', 'open', 'final_day', 'over'].map((p) => takesBets(p as never))).toEqual([
      false,
      true,
      true,
      false,
    ])
  })
})

describe('creating a season', () => {
  it('reads ISO times with an offset', () => {
    const parsed = CreateSeasonInput.parse({
      name: ' Season 1 ',
      startsAt: '2026-12-01T04:00:00-06:00',
      endsAt: '2026-12-31T10:00:00Z',
    })
    expect(parsed).toEqual({
      name: 'Season 1',
      startsAt: at('2026-12-01T10:00:00Z'),
      endsAt: at('2026-12-31T10:00:00Z'),
    })
  })

  it('explains what is wrong in plain words', () => {
    const issue = (input: unknown) => CreateSeasonInput.safeParse(input).error?.issues[0]?.message
    expect(
      issue({ name: '', startsAt: '2026-12-01T10:00:00Z', endsAt: '2026-12-02T10:00:00Z' }),
    ).toBe('Name the season.')
    expect(issue({ name: 'S', startsAt: 'tomorrow', endsAt: '2026-12-02T10:00:00Z' })).toBe(
      'Pick a start time.',
    )
    expect(
      issue({ name: 'S', startsAt: '2026-12-02T10:00:00Z', endsAt: '2026-12-01T10:00:00Z' }),
    ).toBe('The season must end after it starts.')
  })
})
