/**
 * Where everything sits on the felt, from the space the seat gives it. The
 * cards take the largest size that fits two rows (the dealer's and yours)
 * with room between them for the lettering and the message, so the whole
 * table shows above the bet controls on a phone and on a short laptop
 * screen alike. Pure arithmetic, so the History replay and the tests can
 * use it too.
 */

/** The largest card, in pixels: a big desktop table. */
export const MAX_CARD = 88

/** Below this width the table uses its compact spacing (phones). */
const COMPACT_BELOW = 480

export interface TableLayout {
  /** Card width in pixels; a card is 1.4 times as tall. */
  card: number
  /** Card height in pixels. */
  cardHeight: number
  /** Phone spacing: smaller pills and gaps. */
  compact: boolean
  /** Top of the dealer's row of cards. */
  dealerTop: number
  /** The space between the two rows, for the lettering or the message. */
  bandTop: number
  band: number
  /** Top of your row of cards. */
  playerTop: number
  /** Height of everything: the table's own height when it sizes itself. */
  height: number
  /** The least height the table needs: below it, the page scrolls instead. */
  minHeight: number
  /** The shoe's middle, in pixels from the table's middle (x) and its top (y), and its card width. */
  shoe: { x: number; y: number; card: number }
}

/**
 * The layout for a table `width` wide and `height` tall. Leave out the
 * height to let the table be as tall as its cards need (the History replay),
 * and pass `card` to fix the card width.
 */
export function tableLayout(width: number, height: number | null, card?: number): TableLayout {
  const compact = width < COMPACT_BELOW
  const top = compact ? 8 : 16
  const bottom = compact ? 8 : 16
  const minBand = compact ? 36 : 44
  const floor = compact ? 36 : 44
  // The totals sit beside the hands, so the height goes to the cards and the band between them.
  const fixed = top + bottom + minBand

  // Two hands of four after a split, side by side, fit across.
  const byWidth = Math.min(MAX_CARD, Math.floor((width - 16) / 5.6))
  const byHeight = height === null ? byWidth : Math.floor((height - fixed) / 2.8)
  const w = card ?? Math.max(floor, Math.min(byWidth, byHeight))
  const cardHeight = Math.round(w * 1.4)

  const natural = fixed + 2 * cardHeight
  const room = Math.max(natural, height ?? natural)
  const free = room - top - bottom - 2 * cardHeight
  const band = Math.min(free, Math.max(minBand, Math.round(w * 1.3)))
  const extra = free - band
  const dealerTop = top + Math.round(extra / 2)
  const bandTop = dealerTop + cardHeight
  const playerTop = bandTop + band

  const shoeCard = Math.round(w * 0.62)
  const inset = compact ? 10 : 18
  return {
    card: w,
    cardHeight,
    compact,
    dealerTop,
    bandTop,
    band,
    playerTop,
    height: room,
    minHeight: fixed + 2 * Math.round(floor * 1.4),
    shoe: {
      x: Math.round(width / 2 - inset - shoeCard / 2),
      y: dealerTop + Math.round(cardHeight / 2),
      card: shoeCard,
    },
  }
}

/** The step between two cards in a hand, as a share of the card's width. */
export function spread(count: number): number {
  return count > 5 ? 0.3 : count > 4 ? 0.36 : 0.44
}

/** How wide a hand of `count` cards is. */
export function handSpan(count: number, card: number): number {
  return count === 0 ? 0 : card + spread(count) * card * (count - 1)
}

/** The middles of your hands: one in the middle, or two apart once split. */
export function handCenters(spans: number[], card: number): number[] {
  if (spans.length < 2) return [0]
  const widest = Math.max(...spans)
  const apart = Math.max(widest / 2 + card * 0.35, card * 1.25)
  return [-apart, apart]
}
