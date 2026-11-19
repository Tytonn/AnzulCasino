/**
 * The ticker (spec: Site layout > Ticker; Steal rules, rule 7): every settled
 * round from every room and every steal attempt, newest first. `GET
 * /api/ticker` sends the latest ones; `round.settled` and `steal.result` add
 * the rest.
 */
import type { RoundSummary } from './events.ts'
import type { StealView } from './steals.ts'

export type TickerItem =
  { kind: 'round'; round: RoundSummary } | { kind: 'steal'; steal: StealView }

/** Unique across both kinds: a round and a steal can share an id. */
export function tickerKey(item: TickerItem): string {
  return item.kind === 'round' ? `round:${item.round.roundId}` : `steal:${item.steal.id}`
}
