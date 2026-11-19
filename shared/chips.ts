/**
 * Chips are tracked in whole hundredths (spec rule 2, as amended Nov 18,
 * 2026). Every amount in code, the database and the API is an integer count
 * of hundredths: bigint on the server, a plain safe integer on the wire.
 * Show cents only when an amount is not whole: 107.50, but 107.
 */

/** Hundredths in one chip. */
export const CHIP = 100n

/** Whole chips to hundredths: chips(100) === 10_000n. */
export function chips(whole: number | bigint): bigint {
  if (typeof whole === 'number' && !Number.isInteger(whole)) {
    throw new Error(`chips() takes whole chips, got ${whole}`)
  }
  return BigInt(whole) * CHIP
}

/** Rounds a hundredths amount down to a whole chip. */
export function floorToChip(amount: bigint): bigint {
  return amount >= 0n ? (amount / CHIP) * CHIP : -(((-amount + CHIP - 1n) / CHIP) * CHIP)
}

/**
 * Multiplies by a fraction and rounds down to a whole hundredth, the rule for
 * every payout, steal and fine. mulDiv(stake, 3n, 2n) is a 3 to 2 payout.
 */
export function mulDiv(amount: bigint, numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('mulDiv needs a positive denominator')
  const product = amount * numerator
  // BigInt division truncates toward zero; round down for negatives too.
  const q = product / denominator
  return product % denominator !== 0n && product < 0n ? q - 1n : q
}

/**
 * A share in basis points (1/100 of a percent), rounded down:
 * basisPoints(amount, 150) is 1.5%. Every share in config is in basis points.
 */
export function basisPoints(amount: bigint, points: bigint | number): bigint {
  if (typeof points === 'number' && !Number.isSafeInteger(points)) {
    throw new Error(`Basis points must be whole, got ${points}`)
  }
  return mulDiv(amount, BigInt(points), 10_000n)
}

/** Basis points for people: 10000 -> "100%", 150 -> "1.5%", 5 -> "0.05%". */
export function formatShare(points: number): string {
  const sign = points < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(points))
  const whole = Math.floor(abs / 100)
  const rest = abs % 100
  if (rest === 0) return `${sign}${whole}%`
  return `${sign}${whole}.${String(rest).padStart(2, '0').replace(/0$/, '')}%`
}

const grouping = new Intl.NumberFormat('en-US')

/**
 * Formats hundredths for people: 1234500n -> "12,345", 1234550n -> "12,345.50".
 * Accepts the wire form (a number of hundredths) too.
 */
export function formatChips(amount: bigint | number, options: { sign?: boolean } = {}): string {
  const value = typeof amount === 'number' ? BigInt(Math.trunc(amount)) : amount
  const negative = value < 0n
  const abs = negative ? -value : value
  const whole = abs / CHIP
  const cents = abs % CHIP
  let text = grouping.format(whole)
  if (cents !== 0n) text += `.${cents.toString().padStart(2, '0')}`
  if (negative) return `-${text}`
  return options.sign && value > 0n ? `+${text}` : text
}

/** An amount with its unit for sentences: "1 chip", "0 chips", "107.50 chips". */
export function chipCount(amount: bigint | number): string {
  const value = typeof amount === 'number' ? BigInt(Math.trunc(amount)) : amount
  return `${formatChips(value)} ${value === CHIP ? 'chip' : 'chips'}`
}

/** Short form for tight spaces: 950, 12.5K, 1.25M, 3B. Never rounds up. */
export function formatChipsShort(amount: bigint | number): string {
  const value = typeof amount === 'number' ? BigInt(Math.trunc(amount)) : amount
  const negative = value < 0n
  const abs = negative ? -value : value
  const units: [bigint, string][] = [
    [1_000_000_000n * CHIP, 'B'],
    [1_000_000n * CHIP, 'M'],
    [1_000n * CHIP, 'K'],
  ]
  for (const [size, suffix] of units) {
    if (abs >= size) {
      // Two decimals, rounded down, trailing zeros dropped.
      const hundredths = (abs * 100n) / size
      const text = (Number(hundredths) / 100).toFixed(2).replace(/\.?0+$/, '')
      return `${negative ? '-' : ''}${text}${suffix}`
    }
  }
  return formatChips(value)
}

/**
 * A multiplier in hundredths for people: 200 -> "2x", 196 -> "1.96x",
 * 1050 -> "10.5x". Rounds down to the hundredth.
 */
export function formatMultiplier(hundredths: number): string {
  const value = Math.max(0, Math.trunc(hundredths))
  const whole = Math.floor(value / 100)
  const rest = value % 100
  const decimals = rest === 0 ? '' : `.${String(rest).padStart(2, '0').replace(/0$/, '')}`
  return `${grouping.format(whole)}${decimals}x`
}

/** Converts a wire amount to bigint, refusing anything that is not a safe integer. */
export function fromWire(amount: number): bigint {
  if (!Number.isSafeInteger(amount)) throw new Error(`Not a whole number of hundredths: ${amount}`)
  return BigInt(amount)
}
