/**
 * How a hand comes onto the table (src/games/blackjack/timeline.ts and
 * useTimeline.ts): the order the cards show in, the split, which steps get
 * the slow reveal, how long a hand takes to show, and the player's controls
 * over a running animation (turn a slow card at once, finish early).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  BlackjackDetail,
  BlackjackHand,
  BlackjackMove,
  Card,
} from '../../../shared/games/blackjack.ts'
import {
  EMPTY_FRAME,
  finalFrame,
  type Frame,
  isSlowStep,
  nextStep,
  PACE,
  revealMs,
  shownDealer,
  shownHands,
  slowMs,
  type Step,
  type TableRound,
} from '../../../src/games/blackjack/timeline.ts'
import { type TableView, Timeline } from '../../../src/games/blackjack/useTimeline.ts'

const SLOW = { lift: 900, turn: 400 }

function hand(cards: string[], extra: Partial<BlackjackHand> = {}): BlackjackHand {
  return {
    cards: cards as Card[],
    stake: 100,
    doubled: false,
    done: false,
    result: null,
    payout: null,
    ...extra,
  }
}

let ids = 0
function round(
  status: 'open' | 'settled',
  hands: BlackjackHand[],
  dealer: string[],
  extra: Partial<BlackjackDetail> & { moves?: BlackjackMove[] } = {},
): TableRound {
  ids += 1
  return {
    id: ids,
    status,
    detail: {
      bet: 100,
      hands,
      active: status === 'open' ? 0 : null,
      dealer: dealer as Card[],
      peeked: false,
      moves: [],
      slowReveal: false,
      idle: false,
      ...extra,
    },
  }
}

/** Every step from `frame` until the round is all showing. */
function steps(r: TableRound, frame: Frame = EMPTY_FRAME): { step: Step; frame: Frame }[] {
  const out: { step: Step; frame: Frame }[] = []
  for (let next = nextStep(frame, r); next; next = nextStep(next.frame, r)) {
    out.push(next)
    if (out.length > 40) throw new Error('the timeline never ends')
  }
  return out
}

function kinds(r: TableRound, frame?: Frame): string[] {
  return steps(r, frame).map(({ step }) =>
    step.kind === 'player'
      ? `p${step.hand}.${step.index}`
      : step.kind === 'dealer'
        ? `d${step.index}`
        : step.kind,
  )
}

describe('the order cards show in', () => {
  it('deals the player, the up card, the player, then the hole card', () => {
    const r = round('open', [hand(['Ts', '6d'])], ['9c'])
    expect(kinds(r)).toEqual(['p0.0', 'up', 'p0.1', 'hole'])
    expect(steps(r).at(-1)?.frame).toEqual(finalFrame(r))
  })

  it('turns the hole card over, draws for the dealer, then shows the results', () => {
    const r = round(
      'settled',
      [hand(['Ts', '7h'], { done: true, result: 'win' })],
      ['9c', '6d', 'Th'],
    )
    expect(kinds(r)).toEqual(['p0.0', 'up', 'p0.1', 'hole', 'flip', 'd2', 'results'])
    expect(finalFrame(r)).toEqual({ split: false, cards: [2], dealer: 3, hole: false, done: true })
  })

  it('shows a hit from where the table was', () => {
    const r = round('open', [hand(['Ts', '2d', '5c'])], ['9c'])
    const dealt: Frame = { split: false, cards: [2], dealer: 1, hole: true, done: false }
    expect(kinds(r, dealt)).toEqual(['p0.2'])
  })

  it('a table already showing the whole round has nothing left to show', () => {
    const r = round('settled', [hand(['Ts', '7h'], { result: 'win' })], ['9c', '6d', 'Th'])
    expect(nextStep(finalFrame(r), r)).toBeNull()
    expect(nextStep(EMPTY_FRAME, round('open', [], []))).toBeNull()
    expect(finalFrame(round('open', [], []))).toEqual(EMPTY_FRAME)
  })

  it('splits the pair, then gives each hand its cards in turn', () => {
    const r = round('open', [hand(['8s', '3d']), hand(['8c', 'Kd'])], ['7h'])
    const dealt: Frame = { split: false, cards: [2], dealer: 1, hole: true, done: false }
    expect(kinds(r, dealt)).toEqual(['split', 'p0.1', 'p1.1'])
    expect(nextStep(dealt, r)?.frame).toEqual({ ...dealt, split: true, cards: [1, 1] })
  })

  it('keeps each card of the pair under the same name, so it slides to its own hand', () => {
    const r = round('open', [hand(['8s', '3d']), hand(['8c', 'Kd'])], ['7h'])
    const before: Frame = { split: false, cards: [2], dealer: 1, hole: true, done: false }
    expect(shownHands(r.detail, before)).toEqual([
      [
        { key: 'p0', card: '8s' },
        { key: 'p1', card: '8c' },
      ],
    ])
    expect(shownHands(r.detail, finalFrame(r))).toEqual([
      [
        { key: 'p0', card: '8s' },
        { key: 'h0-1', card: '3d' },
      ],
      [
        { key: 'p1', card: '8c' },
        { key: 'h1-1', card: 'Kd' },
      ],
    ])
    expect(shownDealer(r.detail, finalFrame(r))).toEqual([{ key: 'd0', card: '7h' }])
  })
})

describe('the slow reveal', () => {
  const dealt: Frame = { split: false, cards: [2], dealer: 1, hole: true, done: false }
  const hit = { kind: 'player', hand: 0, index: 2 } as const

  it('is for a hit from a hard 12 or more on a slow-reveal bet, whatever the card', () => {
    for (const card of ['2c', '9c', 'Kc']) {
      const r = round('open', [hand(['Ts', '2d', card])], ['9c'], { slowReveal: true })
      expect(isSlowStep(hit, r, dealt)).toBe(true)
    }
  })

  it('is not for a soft hand, a hard 11, the deal, or a bet that is not big', () => {
    const slow = { slowReveal: true }
    expect(isSlowStep(hit, round('open', [hand(['Ah', '6d', '5c'])], ['9c'], slow), dealt)).toBe(
      false,
    )
    expect(isSlowStep(hit, round('open', [hand(['5h', '6d', 'Tc'])], ['9c'], slow), dealt)).toBe(
      false,
    )
    const deal = round('open', [hand(['Ts', '6d'])], ['9c'], slow)
    expect(isSlowStep({ kind: 'player', hand: 0, index: 1 }, deal, EMPTY_FRAME)).toBe(false)
    expect(isSlowStep(hit, round('open', [hand(['Ts', '2d', '5c'])], ['9c']), dealt)).toBe(false)
  })

  it('turns the hole card slowly only while a hand still waits on it', () => {
    const flip = { kind: 'flip' } as const
    const standing = round('settled', [hand(['Ts', '7h'], { done: true })], ['9c', 'Kd'], {
      slowReveal: true,
    })
    const bust = round('settled', [hand(['Ts', '6h', '9d'], { done: true })], ['9c', 'Kd'], {
      slowReveal: true,
    })
    expect(isSlowStep(flip, standing, dealt)).toBe(true)
    expect(isSlowStep(flip, bust, dealt)).toBe(false)
  })
})

describe('how long a hand takes to show', () => {
  it('times a deal from the clear table, the dealer check included', () => {
    const r = round('settled', [hand(['Ts', '7h'], { done: true, result: 'lose' })], ['Ac', 'Kd'], {
      peeked: true,
    })
    // Sweep, three cards dealt, the hole card and the check under the ace, the flip.
    expect(revealMs(r, PACE, SLOW)).toBe(
      PACE.sweep + 3 * PACE.deal + PACE.deal + PACE.peek + PACE.flip,
    )
  })

  it('times the last move: a hit that busts, slow or not', () => {
    const moves: BlackjackMove[] = [{ hand: 0, move: 'hit' }]
    const cards = [hand(['Ts', '6d', '9c'], { done: true, result: 'bust' })]
    const plain = round('settled', cards, ['7c', 'Kd'], { moves })
    const slow = round('settled', cards, ['7c', 'Kd'], { moves, slowReveal: true })
    expect(revealMs(plain, PACE, SLOW)).toBe(PACE.hit + PACE.flip)
    expect(revealMs(slow, PACE, SLOW)).toBe(slowMs(SLOW, PACE) + PACE.flip)
  })

  it('takes no time for a hand still being played', () => {
    expect(revealMs(round('open', [hand(['Ts', '6d'])], ['9c']), PACE, SLOW)).toBe(0)
  })
})

describe('the timeline', () => {
  let views: TableView[]
  let events: string[]
  let timeline: Timeline<TableRound>

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] })
    views = []
    events = []
    timeline = new Timeline<TableRound>({
      pace: PACE,
      slow: SLOW,
      onStep: (step, _view, slow) => events.push(`${step.kind}${slow ? ' (slow)' : ''}`),
      onLanded: (step) => events.push(`landed ${step.kind}`),
      onResults: () => events.push('results shown'),
    })
    timeline.listen((view) => views.push(view))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deals a hand card by card, then tells the room it is all showing', () => {
    const r = round(
      'settled',
      [hand(['Ts', '7h'], { done: true, result: 'win' })],
      ['9c', '6d', 'Th'],
    )
    timeline.show(r, () => events.push('shown'))
    expect(timeline.view.step).toEqual({ kind: 'player', hand: 0, index: 0 })
    vi.advanceTimersByTime(10_000)
    expect(events).toEqual([
      'player',
      'up',
      'player',
      'hole',
      'flip',
      'dealer',
      'results',
      'results shown',
      'shown',
    ])
    expect(timeline.view.frame).toEqual(finalFrame(r))
    expect(timeline.view.idle).toBe(true)
  })

  it('lifts a slow card face down, turns it, and lands it; a tap turns it at once', () => {
    const dealt = round('open', [hand(['Ts', '6d'])], ['9c'], { slowReveal: true })
    timeline.jump(dealt)
    const hit = {
      ...dealt,
      detail: { ...dealt.detail, hands: [hand(['Ts', '6d', '8c'])] },
    }
    timeline.show(hit)
    expect(timeline.view.slow).toBe('lift')
    expect(timeline.revealing).toBe(true)
    vi.advanceTimersByTime(SLOW.lift)
    expect(timeline.view.slow).toBe('turn')
    vi.advanceTimersByTime(SLOW.turn)
    expect(timeline.view.slow).toBe('land')
    expect(events).toEqual(['player (slow)', 'landed player'])

    // Again, with a tap while it is still face down.
    timeline.jump(dealt)
    events = []
    timeline.show(hit)
    vi.advanceTimersByTime(200)
    expect(timeline.skip()).toBe(true)
    expect(timeline.view.slow).toBe('land')
    expect(events).toEqual(['player (slow)', 'landed player'])
    expect(timeline.skip()).toBe(false)
  })

  it('finishes early when the player acts, with the results shown once', () => {
    const r = round(
      'settled',
      [hand(['Ts', '7h'], { done: true, result: 'win' })],
      ['9c', '6d', 'Th'],
    )
    timeline.show(r, () => events.push('shown'))
    vi.advanceTimersByTime(PACE.deal + 10)
    timeline.finish()
    expect(timeline.view.frame).toEqual(finalFrame(r))
    expect(events.filter((e) => e === 'results shown')).toHaveLength(1)
    expect(events.at(-1)).toBe('shown')
    vi.advanceTimersByTime(10_000)
    expect(events.filter((e) => e === 'results shown')).toHaveLength(1)
  })

  it('lets the last hand clear to the discard pile before dealing the next', () => {
    const last = round('settled', [hand(['Ts', '7h'], { result: 'win' })], ['9c', '6d', 'Th'])
    const next = round('open', [hand(['5s', '2c'])], ['Kd'])
    timeline.jump(last)
    timeline.jump(null)
    timeline.show(next)
    expect(timeline.view.step).toBeNull()
    expect(timeline.view.frame).toEqual(EMPTY_FRAME)
    vi.advanceTimersByTime(PACE.sweep)
    expect(timeline.view.step).toEqual({ kind: 'player', hand: 0, index: 0 })
  })

  it('deals at once onto a table that was already clear', () => {
    timeline.show(round('open', [hand(['5s', '2c'])], ['Kd']))
    expect(timeline.view.step).toEqual({ kind: 'player', hand: 0, index: 0 })
    expect(views.length).toBeGreaterThan(1)
  })
})
