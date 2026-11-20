/**
 * Plays a round onto the table one step at a time (timeline.ts). The room
 * hands it each answer with `show`; it deals what changed with a pause
 * after each card, plays the slow reveal's lift and turn, and tells the room
 * when each step starts, when a slow card lands and when the results show.
 *
 * A running animation finishes early when the player acts (`finish`), and a
 * slow reveal turns over at once when they tap (`skip`). `show`'s callback
 * runs once the round is all on the table: the room releases the news of
 * the result then (src/kit/reveal.ts).
 */
import { useEffect, useLayoutEffect, useState } from 'react'

import {
  EMPTY_FRAME,
  finalFrame,
  type Frame,
  isSlowStep,
  nextStep,
  type Pace,
  type SlowPace,
  type Step,
  stepMs,
  type TableRound,
} from './timeline.ts'

/** Where a slow card is: rising face down, turning over, or landed face up. */
export type SlowPhase = 'lift' | 'turn' | 'land'

export interface TableView<R extends TableRound = TableRound> {
  /** The round on the table, or null for a clear table. */
  round: R | null
  frame: Frame
  /** The step playing now. */
  step: Step | null
  /** The slow reveal's phase, while the step playing is slow. */
  slow: SlowPhase | null
  /** Nothing left to show. */
  idle: boolean
}

export interface TimelineOptions<R extends TableRound> {
  pace: Pace
  slow: SlowPace
  /** A step starts showing. */
  onStep?: (step: Step, view: TableView<R>, slow: boolean) => void
  /** A slow card has turned over. */
  onLanded?: (step: Step, view: TableView<R>) => void
  /** The results are showing, by their step or by finishing early. */
  onResults?: (view: TableView<R>) => void
}

const CLEAR: TableView<never> = {
  round: null,
  frame: EMPTY_FRAME,
  step: null,
  slow: null,
  idle: true,
}

export class Timeline<R extends TableRound> {
  private state: TableView<R> = CLEAR
  private timer: ReturnType<typeof setTimeout> | null = null
  /** When the last hand's cards left for the discard pile. */
  private swept = -Infinity
  private waiting: (() => void)[] = []
  private listener: ((view: TableView<R>) => void) | null = null
  private options: TimelineOptions<R>

  constructor(options: TimelineOptions<R>) {
    this.options = options
  }

  get view(): TableView<R> {
    return this.state
  }

  /** True while a slow card is face down or turning: a tap or a key turns it over. */
  get revealing(): boolean {
    return this.state.slow === 'lift' || this.state.slow === 'turn'
  }

  configure(options: TimelineOptions<R>): void {
    this.options = options
  }

  listen(listener: (view: TableView<R>) => void): () => void {
    this.listener = listener
    listener(this.state)
    return () => {
      this.listener = null
      this.stop()
    }
  }

  /**
   * Shows a round: what changed since the table last showed it, or the whole
   * deal for a new round. `onShown` runs once it is all on the table.
   */
  show(round: R, onShown?: () => void): void {
    if (onShown) this.waiting.push(onShown)
    if (this.state.round?.id !== round.id) {
      if (this.hasCards()) this.swept = performance.now()
      this.stop()
      this.commit({ ...CLEAR, round, idle: false })
      // The last hand's cards reach the discard pile before the new ones come out.
      const wait = this.swept + this.options.pace.sweep - performance.now()
      if (wait > 0) {
        this.later(wait, this.advance)
        return
      }
    } else {
      this.commit({ ...this.state, round, idle: false })
    }
    if (!this.timer) this.advance()
  }

  /** Shows a round as it stands, at once (a page load), or clears the table. */
  jump(round: R | null): void {
    if (!round && this.hasCards()) this.swept = performance.now()
    this.stop()
    this.commit({ ...CLEAR, round, frame: round ? finalFrame(round) : EMPTY_FRAME })
    this.flush()
  }

  private hasCards(): boolean {
    const { round, frame } = this.state
    return round !== null && (frame.dealer > 0 || frame.hole || frame.cards.some((n) => n > 0))
  }

  /** Turns a slow card over now. Returns false when no slow card is waiting. */
  skip(): boolean {
    if (!this.revealing) return false
    this.land()
    return true
  }

  /** Shows the rest of the round at once: a running animation finishes early. */
  finish(): void {
    const { round, frame, step } = this.state
    if (!round) return
    if (this.revealing && step) this.options.onLanded?.(step, { ...this.state, slow: 'land' })
    this.stop()
    const final = finalFrame(round)
    const view: TableView<R> = { ...this.state, frame: final, step: null, slow: null, idle: true }
    this.commit(view)
    if (final.done && !frame.done) this.options.onResults?.(view)
    this.flush()
  }

  private advance = (): void => {
    this.timer = null
    const { round, frame } = this.state
    const next = round ? nextStep(frame, round) : null
    if (!round || !next) {
      this.commit({ ...this.state, step: null, slow: null, idle: true })
      this.flush()
      return
    }
    const slow = isSlowStep(next.step, round, frame)
    const view: TableView<R> = {
      ...this.state,
      frame: next.frame,
      step: next.step,
      slow: slow ? 'lift' : null,
      idle: false,
    }
    this.commit(view)
    this.options.onStep?.(next.step, view, slow)
    if (next.step.kind === 'results') this.options.onResults?.(view)
    if (slow) {
      this.later(this.options.slow.lift, () => {
        this.commit({ ...this.state, slow: 'turn' })
        this.later(this.options.slow.turn, () => this.land())
      })
    } else {
      this.later(stepMs(next.step, round.detail, this.options.pace), this.advance)
    }
  }

  private land(): void {
    const { step } = this.state
    const view: TableView<R> = { ...this.state, slow: 'land' }
    this.commit(view)
    if (step) this.options.onLanded?.(step, view)
    this.later(this.options.pace.land, this.advance)
  }

  private later(ms: number, task: () => void): void {
    this.stop()
    this.timer = setTimeout(() => {
      this.timer = null
      task()
    }, ms)
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private commit(view: TableView<R>): void {
    this.state = view
    this.listener?.(view)
  }

  private flush(): void {
    const done = this.waiting
    this.waiting = []
    for (const task of done) task()
  }
}

/** The table's timeline, and what it shows now. */
export function useTimeline<R extends TableRound>(
  options: TimelineOptions<R>,
): { view: TableView<R>; timeline: Timeline<R> } {
  const [timeline] = useState(() => new Timeline<R>(options))
  const [view, setView] = useState<TableView<R>>(() => timeline.view)
  useLayoutEffect(() => timeline.configure(options))
  useEffect(() => timeline.listen(setView), [timeline])
  return { view, timeline }
}
