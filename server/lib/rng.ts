/**
 * Server randomness (spec rule 6). Everything comes from node:crypto, never
 * Math.random, and ranges use crypto.randomInt, which has no modulo bias.
 */
import { randomBytes, randomInt as cryptoRandomInt } from 'node:crypto'

/** A uniform integer in [min, max). */
export function randomInt(min: number, max: number): number {
  return cryptoRandomInt(min, max)
}

/** A uniform integer in [0, n). */
export function randomBelow(n: number): number {
  return cryptoRandomInt(n)
}

/** true with probability numerator / denominator, decided by an exact integer draw. */
export function chance(numerator: number, denominator: number): boolean {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new Error('chance() takes whole numbers')
  }
  return cryptoRandomInt(denominator) < numerator
}

/** A uniformly random element. */
export function pick<T>(items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() needs at least one item')
  return items[cryptoRandomInt(items.length)] as T
}

/** The largest range node:crypto's randomInt draws from. */
const MAX_RANGE = 2 ** 48 - 1

/**
 * An item drawn with the odds its whole-number weight gives it, exactly:
 * pickWeighted([['cherry', 30], ['bell', 9], ['seven', 1]]) draws a seven 1
 * time in 40. A weight of 0 is never drawn.
 */
export function pickWeighted<T>(entries: readonly (readonly [item: T, weight: number])[]): T {
  let total = 0
  for (const [, weight] of entries) {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new Error(`Weights are whole numbers, 0 or more. Got ${weight}`)
    }
    total += weight
  }
  if (total <= 0 || total > MAX_RANGE) {
    throw new Error(`pickWeighted() needs a total weight from 1 to 2^48 - 1. Got ${total}`)
  }
  let draw = cryptoRandomInt(total)
  for (const [item, weight] of entries) {
    if (draw < weight) return item
    draw -= weight
  }
  throw new Error('pickWeighted() ran past its entries')
}

/** A uniformly shuffled copy (Fisher–Yates). */
export function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = cryptoRandomInt(i + 1)
    ;[copy[i], copy[j]] = [copy[j] as T, copy[i] as T]
  }
  return copy
}

/** A uniform float in [0, 1) with 52 random bits, for formulas such as the crash point. */
export function randomUnit(): number {
  const bytes = randomBytes(7)
  // 52 bits: 4 bits of the first byte and the 48 bits of the other six.
  const high = (bytes[0] as number) & 0x0f
  const low = bytes.readUIntBE(1, 6)
  return (high * 2 ** 48 + low) / 2 ** 52
}

/** URL-safe random token, used for session cookies. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32: no I, L, O, U

/** A human-friendly code such as 7K3Q-9XPM-2D4R (60 random bits). */
export function randomCode(groups = 3, size = 4): string {
  const parts: string[] = []
  for (let g = 0; g < groups; g++) {
    let part = ''
    for (let i = 0; i < size; i++) part += CODE_ALPHABET[cryptoRandomInt(CODE_ALPHABET.length)]
    parts.push(part)
  }
  return parts.join('-')
}

/** Normalizes a typed code: case, spaces, dashes, and the letters people confuse with digits. */
export function normalizeCode(input: string): string {
  const clean = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  return clean.match(/.{1,4}/g)?.join('-') ?? ''
}
