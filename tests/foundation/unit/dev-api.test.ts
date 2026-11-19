/**
 * The local API's path matching follows Netlify's `config.path` rules, so a
 * function answers the same paths in `npm run dev` as on Netlify.
 */
import { describe, expect, it } from 'vitest'

import { pathPattern } from '../../../scripts/dev/dev-api.ts'

describe('pathPattern', () => {
  it('matches a plain path, with or without a trailing slash', () => {
    const pattern = pathPattern('/api/chat')
    expect(pattern.test('/api/chat')).toBe(true)
    expect(pattern.test('/api/chat/')).toBe(true)
    expect(pattern.test('/api/chats')).toBe(false)
    expect(pattern.test('/api/chat/5')).toBe(false)
  })

  it('matches anything under a wildcard', () => {
    const pattern = pathPattern('/api/chat/*')
    expect(pattern.test('/api/chat/5')).toBe(true)
    expect(pattern.test('/api/chat/5/more')).toBe(true)
    expect(pattern.test('/api/other/5')).toBe(false)
  })

  it('matches one segment for a named parameter', () => {
    const pattern = pathPattern('/api/games/:id/rounds')
    expect(pattern.test('/api/games/coinflip/rounds')).toBe(true)
    expect(pattern.test('/api/games/a/b/rounds')).toBe(false)
  })

  it('treats dots and other symbols literally', () => {
    expect(pathPattern('/api/v1.0').test('/api/v1x0')).toBe(false)
    expect(pathPattern('/api/v1.0').test('/api/v1.0')).toBe(true)
  })
})
