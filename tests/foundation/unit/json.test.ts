import { describe, expect, it } from 'vitest'

import { toJson, toWire } from '../../../server/lib/json.ts'

describe('JSON on the wire', () => {
  it('sends chip amounts as plain numbers of hundredths', () => {
    expect(toJson({ balance: 10_750n, list: [1n, 2n] })).toBe('{"balance":10750,"list":[1,2]}')
  })

  it('refuses an amount the browser could not hold exactly', () => {
    expect(() => toJson({ balance: 2n ** 60n })).toThrow(/too large/)
  })

  it('gives the value as the browser receives it', () => {
    const at = new Date('2026-11-18T06:00:00.000Z')
    expect(toWire({ balance: 5n, at, nothing: undefined })).toEqual({
      balance: 5,
      at: '2026-11-18T06:00:00.000Z',
    })
    expect(toWire(undefined)).toBeUndefined()
    expect(toWire(null)).toBeNull()
  })
})
