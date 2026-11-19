/**
 * JSON for responses and live events. Chip amounts are bigint on the server
 * and plain numbers (hundredths) on the wire, so this converts them, and
 * refuses any amount too large to be exact in the browser.
 */
import type { Wire } from '../../shared/wire.ts'

export function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'bigint') {
      if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new Error(`Amount ${v} is too large to send safely`)
      }
      return Number(v)
    }
    return v
  })
}

/** The value as the browser will receive it: bigints as numbers, dates as strings. */
export function toWire<T>(value: T): Wire<T> {
  if (value === undefined) return undefined as Wire<T>
  return JSON.parse(toJson(value)) as Wire<T>
}
