/**
 * The stream as it draws (spec: The stream): your private replies in their
 * places, a player's messages grouped under one header, your pinned cards
 * as a slim line, and a run of one player's folded cards joined into one
 * line while the stream_round_runs setting says so. A shared round's card
 * (a roulette spin) is everyone's and never joins a run. Pure, so the unit
 * tests read it directly.
 */
import type { ChatMessage } from '../../../shared/chat.ts'
import { type CardState, isSharedCard } from './fold.ts'
import type { PrivateItem } from './private.ts'

/** Messages from one player this close together share one header. */
export const GROUP_MS = 5 * 60_000

export type Row =
  | { kind: 'message'; message: ChatMessage; grouped: boolean }
  | { kind: 'system'; message: ChatMessage }
  | { kind: 'card'; message: ChatMessage; state: CardState }
  | { kind: 'stub'; message: ChatMessage }
  | { kind: 'run'; messages: ChatMessage[] }
  | { kind: 'private'; item: PrivateItem }

export function rowKey(row: Row): string {
  switch (row.kind) {
    case 'run':
      return `run-${row.messages[0]?.id ?? 0}`
    case 'private':
      return `private-${row.item.id}`
    default:
      return `${row.kind}-${row.message.id}`
  }
}

/** The list as it draws: private replies in their places, folded runs joined into one line. */
export function buildRows(input: {
  items: readonly ChatMessage[]
  privates: readonly PrivateItem[]
  states: ReadonlyMap<number, CardState>
  pinned: ReadonlySet<number>
  foldRuns: boolean
}): Row[] {
  const rows: Row[] = []
  const privates = [...input.privates].sort((a, b) => a.afterId - b.afterId || a.id - b.id)
  let p = 0
  const flushPrivates = (upTo: number) => {
    while (p < privates.length && (privates[p]?.afterId ?? 0) < upTo) {
      const item = privates[p++]
      if (item) rows.push({ kind: 'private', item })
    }
  }

  let previous: ChatMessage | undefined
  for (const message of input.items) {
    flushPrivates(message.id)
    if (message.kind === 'card') {
      const state = input.states.get(message.id) ?? 'live'
      if (input.pinned.has(message.id)) {
        rows.push({ kind: 'stub', message })
      } else if (state === 'folded' && !isSharedCard(message)) {
        // A shared round's card (a roulette spin) is everyone's: it keeps its own line.
        const last = rows.at(-1)
        const lastUser =
          last?.kind === 'run'
            ? last.messages[0]?.userId
            : last?.kind === 'card' && last.state === 'folded' && !isSharedCard(last.message)
              ? last.message.userId
              : undefined
        if (input.foldRuns && last && lastUser !== undefined && lastUser === message.userId) {
          if (last.kind === 'run') last.messages.push(message)
          else if (last.kind === 'card') {
            rows[rows.length - 1] = { kind: 'run', messages: [last.message, message] }
          }
        } else {
          rows.push({ kind: 'card', message, state })
        }
      } else {
        rows.push({ kind: 'card', message, state })
      }
      previous = undefined
      continue
    }
    if (message.kind === 'system') {
      rows.push({ kind: 'system', message })
      previous = undefined
      continue
    }
    const grouped =
      previous !== undefined &&
      previous.userId === message.userId &&
      Date.parse(message.createdAt) - Date.parse(previous.createdAt) < GROUP_MS
    rows.push({ kind: 'message', message, grouped })
    previous = message
  }
  flushPrivates(Infinity)
  return rows
}
