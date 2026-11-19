/**
 * Where everything sits on the felt, in two shapes: `wide`, the classic
 * table with zero on the left and the numbers in three rows, and `tall`, the
 * same table turned for a phone, with zero on top and the outside bets down
 * the left. Coordinates are SVG units; the felt scales them to fit.
 *
 * Each place to bet has a hit area and an anchor where its chips sit. A
 * number or an outside bet is its whole cell. A split is a strip along the
 * line between two numbers, a street a strip on the row's outer edge, and a
 * corner, a trio, the first four and a six line a small square where lines
 * meet, as on a real table. Those sit above the cells and catch clicks first.
 *
 * Positions on the number grid are worked out once in grid units (gx along
 * the twelve streets, gy across the three rows) and mapped to each shape.
 */
import { pocketColor, type PocketColor, SPOTS } from '../../../shared/games/roulette.ts'

export type Orientation = 'wide' | 'tall'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

/** A drawn cell: a number, zero, or an outside bet. */
export interface Cell {
  id: string
  box: Box
  label: string
  tone: PocketColor | 'outside'
  /** Red and black are drawn as a diamond of their color. */
  diamond?: 'red' | 'black'
  /** The label runs along the cell (a tall dozen on a phone). */
  turned?: boolean
}

export interface SpotShape {
  id: string
  hit: Box
  anchor: Point
  /** Combos sit above cells and catch clicks first. */
  layer: 'cell' | 'combo'
}

export interface TableLayout {
  orientation: Orientation
  width: number
  height: number
  cells: Cell[]
  spots: ReadonlyMap<string, SpotShape>
  /** The number cells, for highlighting what a bet covers. */
  numberBoxes: ReadonlyMap<number, Box>
  /** A chip's radius. */
  chipR: number
  /** The felt's corner radius. */
  radius: number
}

interface Dimensions {
  /** Grid units to SVG units. */
  map: (gx: number, gy: number) => Point
  /** Half the thickness of a split or street strip, and half a corner square. */
  strip: number
  square: number
}

// The wide table: 40 x 46 number cells, zero and the 2-to-1 column as wide as a cell.
const W = { cell: 40, row: 46, zero: 40, column: 40, dozen: 34, even: 34 }
// The tall table: 78 x 31 number cells under a 38-high zero, with the outside bets down the left.
const T = { cell: 78, row: 31, zero: 38, column: 30, even: 42, dozen: 42 }

const DOZENS = ['1st12', '2nd12', '3rd12'] as const
const DOZEN_LABELS = ['1st 12', '2nd 12', '3rd 12'] as const
const EVENS = ['low', 'even', 'red', 'black', 'odd', 'high'] as const
const EVEN_LABELS: Record<(typeof EVENS)[number], string> = {
  low: '1-18',
  even: 'Even',
  red: 'Red',
  black: 'Black',
  odd: 'Odd',
  high: '19-36',
}

/** A number's place on the grid: its street (0-11) and row (0 top, 2 bottom on the wide table). */
export function gridOf(n: number): { c: number; r: number } {
  return { c: Math.floor((n - 1) / 3), r: 2 - ((n - 1) % 3) }
}

function boxOf(a: Point, b: Point): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  }
}

/**
 * A thin strip along a cell's side, from `from` to `to` in grid units, kept
 * clear of the corner squares at either end.
 */
function strip(d: Dimensions, from: [number, number], to: [number, number]): Box {
  const a = d.map(...from)
  const b = d.map(...to)
  const inset = d.square + 1
  if (Math.abs(a.x - b.x) < 0.01) {
    const top = Math.min(a.y, b.y) + inset
    return { x: a.x - d.strip, y: top, w: d.strip * 2, h: Math.abs(a.y - b.y) - inset * 2 }
  }
  const left = Math.min(a.x, b.x) + inset
  return { x: left, y: a.y - d.strip, w: Math.abs(a.x - b.x) - inset * 2, h: d.strip * 2 }
}

function square(d: Dimensions, at: [number, number]): Box {
  const p = d.map(...at)
  return { x: p.x - d.square, y: p.y - d.square, w: d.square * 2, h: d.square * 2 }
}

const center = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

const ids = (numbers: number[]) => [...numbers].sort((a, b) => a - b).join('-')

/** The splits, streets, corners, trios, the first four and the six lines. */
function combos(d: Dimensions): SpotShape[] {
  const out: SpotShape[] = []
  const add = (numbers: number[], hit: Box) =>
    out.push({ id: ids(numbers), hit, anchor: center(hit), layer: 'combo' })

  for (let n = 1; n <= 36; n++) {
    const { c, r } = gridOf(n)
    // n and n + 1 share a street: the line between their rows.
    if (n % 3 !== 0) add([n, n + 1], strip(d, [c, r], [c + 1, r]))
    // n and n + 3 share a row: the line between their streets.
    if (n <= 33) add([n, n + 3], strip(d, [c + 1, r], [c + 1, r + 1]))
    // Four numbers meet at the corner above n and to its right.
    if (n % 3 !== 0 && n <= 32) add([n, n + 1, n + 3, n + 4], square(d, [c + 1, r]))
  }
  for (const n of [1, 2, 3]) {
    const { r } = gridOf(n)
    add([0, n], strip(d, [0, r], [0, r + 1]))
  }
  for (let c = 0; c < 12; c++) {
    const a = c * 3 + 1
    add([a, a + 1, a + 2], strip(d, [c, 3], [c + 1, 3]))
    if (c < 11) add([a, a + 1, a + 2, a + 3, a + 4, a + 5], square(d, [c + 1, 3]))
  }
  add([0, 1, 2], square(d, [0, 2]))
  add([0, 2, 3], square(d, [0, 1]))
  add([0, 1, 2, 3], square(d, [0, 3]))
  return out
}

function numberCells(d: Dimensions): { cells: Cell[]; boxes: Map<number, Box> } {
  const cells: Cell[] = []
  const boxes = new Map<number, Box>()
  for (let n = 1; n <= 36; n++) {
    const { c, r } = gridOf(n)
    const box = boxOf(d.map(c, r), d.map(c + 1, r + 1))
    boxes.set(n, box)
    cells.push({ id: String(n), box, label: String(n), tone: pocketColor(n) })
  }
  return { cells, boxes }
}

function wide(): TableLayout {
  const d: Dimensions = {
    map: (gx, gy) => ({ x: W.zero + gx * W.cell, y: gy * W.row }),
    strip: 7,
    square: 8,
  }
  const grid = 3 * W.row
  const { cells, boxes } = numberCells(d)
  const zero: Cell = {
    id: '0',
    box: { x: 0, y: 0, w: W.zero, h: grid },
    label: '0',
    tone: 'green',
  }
  boxes.set(0, zero.box)
  cells.unshift(zero)
  const right = W.zero + 12 * W.cell
  ;(['col3', 'col2', 'col1'] as const).forEach((id, r) =>
    cells.push({
      id,
      box: { x: right, y: r * W.row, w: W.column, h: W.row },
      label: '2:1',
      tone: 'outside',
    }),
  )
  DOZENS.forEach((id, i) =>
    cells.push({
      id,
      box: { x: W.zero + i * 4 * W.cell, y: grid, w: 4 * W.cell, h: W.dozen },
      label: DOZEN_LABELS[i] as string,
      tone: 'outside',
    }),
  )
  EVENS.forEach((id, j) =>
    cells.push({
      id,
      box: { x: W.zero + j * 2 * W.cell, y: grid + W.dozen, w: 2 * W.cell, h: W.even },
      label: EVEN_LABELS[id],
      tone: 'outside',
      diamond: id === 'red' || id === 'black' ? id : undefined,
    }),
  )
  return finish('wide', right + W.column, grid + W.dozen + W.even, cells, boxes, d, 12.5)
}

function tall(): TableLayout {
  const side = T.even + T.dozen
  const d: Dimensions = {
    map: (gx, gy) => ({ x: side + (3 - gy) * T.cell, y: T.zero + gx * T.row }),
    strip: 6.5,
    square: 8,
  }
  const grid = 12 * T.row
  const { cells, boxes } = numberCells(d)
  const zero: Cell = {
    id: '0',
    box: { x: side, y: 0, w: 3 * T.cell, h: T.zero },
    label: '0',
    tone: 'green',
  }
  boxes.set(0, zero.box)
  cells.unshift(zero)
  ;(['col1', 'col2', 'col3'] as const).forEach((id, k) =>
    cells.push({
      id,
      box: { x: side + k * T.cell, y: T.zero + grid, w: T.cell, h: T.column },
      label: '2:1',
      tone: 'outside',
    }),
  )
  DOZENS.forEach((id, i) =>
    cells.push({
      id,
      box: { x: T.even, y: T.zero + i * 4 * T.row, w: T.dozen, h: 4 * T.row },
      label: DOZEN_LABELS[i] as string,
      tone: 'outside',
      turned: true,
    }),
  )
  EVENS.forEach((id, j) =>
    cells.push({
      id,
      box: { x: 0, y: T.zero + j * 2 * T.row, w: T.even, h: 2 * T.row },
      label: EVEN_LABELS[id],
      tone: 'outside',
      diamond: id === 'red' || id === 'black' ? id : undefined,
    }),
  )
  return finish('tall', side + 3 * T.cell, T.zero + grid + T.column, cells, boxes, d, 11.5)
}

function finish(
  orientation: Orientation,
  width: number,
  height: number,
  cells: Cell[],
  numberBoxes: Map<number, Box>,
  d: Dimensions,
  chipR: number,
): TableLayout {
  const spots = new Map<string, SpotShape>()
  for (const cell of cells) {
    spots.set(cell.id, { id: cell.id, hit: cell.box, anchor: center(cell.box), layer: 'cell' })
  }
  for (const combo of combos(d)) spots.set(combo.id, combo)
  return { orientation, width, height, cells, spots, numberBoxes, chipR, radius: 10 }
}

const LAYOUTS: Record<Orientation, TableLayout> = { wide: wide(), tall: tall() }

export function tableLayout(orientation: Orientation): TableLayout {
  return LAYOUTS[orientation]
}

/** Every spot on the table has a place in both shapes (checked by a test). */
export function missingSpots(layout: TableLayout): string[] {
  return SPOTS.filter((s) => !layout.spots.has(s.id)).map((s) => s.id)
}
