/**
 * JSON for responses and live events. Chip amounts are bigint on the server
 * and plain numbers (hundredths) on the wire, so this converts them, and
 * refuses any amount too large to be exact in the browser.
 */
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

/** Converts bigints to numbers, the way toJson would, keeping the object. */
export function toWire<T>(value: T): T {
  return JSON.parse(toJson(value)) as T
}
