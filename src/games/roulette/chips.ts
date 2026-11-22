/**
 * Chip sizes for clicking the table: a rack of five round values from a
 * ladder, sized to what the player has, and amounts written the way the
 * bet box reads them.
 */
/** Round chip values, in whole chips. */
const LADDER = [
  1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000,
  500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000,
]

export const RACK_SIZE = 5

/**
 * Five chip sizes in chips: the smallest is the minimum bet or more,
 * and the largest grows until it is about a quarter of `worth` (the wallet
 * plus what is already on the table).
 */
export function chipRack(minBet: bigint, worth: bigint): bigint[] {
  const floor = minBet > 0n ? minBet : 1n
  const values = [floor, ...LADDER.map((c) => BigInt(c)).filter((v) => v > floor)]
  let top = Math.min(RACK_SIZE - 1, values.length - 1)
  while (top + 1 < values.length && (values[top + 1] as bigint) * 4n <= worth) top++
  return values.slice(Math.max(0, top - RACK_SIZE + 1), top + 1)
}

/** An amount as the bet box reads it: "25", "1000". */
export function amountText(amount: bigint): string {
  return amount.toString()
}

/** The chip size the player picked last, kept in this browser. */
const CHIP_KEY = 'anzul.roulette.chip'

export function readChip(): bigint | null {
  try {
    const saved = localStorage.getItem(CHIP_KEY)
    return saved && /^\d{1,15}$/.test(saved) ? BigInt(saved) : null
  } catch {
    return null
  }
}

export function saveChip(amount: bigint): void {
  try {
    localStorage.setItem(CHIP_KEY, amount.toString())
  } catch {
    // Storage is off (a private window): the rack starts on its default next time.
  }
}
