/**
 * What each audit row says on the Audit page (spec: Admin and trust > The
 * audit page): one sentence with the people it names, and a few detail
 * lines with the before and after values. Pure, so the unit tests read
 * every action's sentence.
 */
import { chipCount, formatChips } from '../../../shared/chips.ts'
import { type ConfigKey, isConfigKey, setting } from '../../../shared/config.ts'
import {
  type AdjustAudit,
  type AuditEntryView,
  type AuditPerson,
  centralWhen,
  type GiveawayAudit,
  type PendingChangeView,
  type SeasonEditAudit,
  type SeasonEndAudit,
  type SeasonFields,
} from '../../../shared/features/admin.ts'
import { GAME_DAY_TIME_ZONE } from '../../../shared/game-day.ts'
import { formatWire, sameWire, settingLabel } from './config-edit.ts'

/** A piece of a sentence: plain words, a player, or a name in bold. */
export type Part = string | { person: AuditPerson | null } | { strong: string }

export interface Described {
  parts: Part[]
  /** Smaller lines under the sentence, such as "Wallet: 100 → 110". */
  details: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const centralDay = new Intl.DateTimeFormat('en-US', {
  timeZone: GAME_DAY_TIME_ZONE,
  month: 'short',
  day: 'numeric',
})

function day(iso: unknown): string {
  return typeof iso === 'string' ? centralDay.format(new Date(iso)) : '?'
}

function when(iso: unknown): string {
  return typeof iso === 'string' ? centralWhen(new Date(iso)) : '?'
}

/** Amounts stored as numbers (this lane) or as text (bigints the foundation wrote). */
function amount(value: unknown): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value)
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value)
  return 0n
}

/** People joined as in a sentence: "Alice", "Alice and Bob", "Alice, Bob and 3 others". */
export function joinPeople(people: (AuditPerson | null)[], max = 6): Part[] {
  const shown = people.length > max ? people.slice(0, max - 1) : people
  const rest = people.length - shown.length
  const parts: Part[] = []
  shown.forEach((person, i) => {
    if (i > 0) parts.push(i === shown.length - 1 && rest === 0 ? ' and ' : ', ')
    parts.push({ person })
  })
  if (rest > 0) parts.push(` and ${rest} others`)
  return parts
}

function lineChanges(before: unknown, after: unknown): string[] {
  const old = Array.isArray(before) ? before.map(String) : []
  const now = Array.isArray(after) ? after.map(String) : []
  const added = now.filter((line) => !old.includes(line))
  const removed = old.filter((line) => !now.includes(line))
  const details: string[] = []
  const quote = (line: string) => `“${line}”`
  for (const line of added.slice(0, 3)) details.push(`Added ${quote(line)}`)
  if (added.length > 3) details.push(`and ${added.length - 3} more added`)
  for (const line of removed.slice(0, 3)) details.push(`Removed ${quote(line)}`)
  if (removed.length > 3) details.push(`and ${removed.length - 3} more removed`)
  if (details.length === 0) details.push('Put the same lines in a new order')
  return details
}

/**
 * When a setting change starts, if it waited for the daily reset: null for
 * one that started as it was saved. Measured from when it was made, never
 * from the clock, so a change that arrives live between two ticks of the
 * page's clock does not read as one still to come.
 */
export function startsLater(entry: AuditEntryView): Date | null {
  if (entry.action !== 'config.changed' || !isRecord(entry.after)) return null
  const effectiveAt = entry.after.effectiveAt
  if (typeof effectiveAt !== 'string') return null
  const starts = new Date(effectiveAt)
  return starts.getTime() > Date.parse(entry.at) + 1_000 ? starts : null
}

function describeConfig(entry: AuditEntryView, actor: Part, hustle?: string): Described {
  const key = entry.target ?? ''
  const before = isRecord(entry.before) ? entry.before.value : undefined
  const after = isRecord(entry.after) ? entry.after : {}
  if (!isConfigKey(key)) {
    return { parts: [actor, ' changed ', { strong: key || 'a setting' }], details: [] }
  }
  const label = settingLabel(key as ConfigKey, hustle)
  const details: string[] = []
  const starts = startsLater(entry)
  if (starts) details.push(`At the daily reset, ${centralWhen(starts)}`)
  if (sameWire(before, after.value)) {
    return {
      parts: [actor, ' took back the change waiting for ', { strong: label }],
      details: [`It stays ${formatWire(key, before)}`],
    }
  }
  const unit = setting(key).unit
  if (unit === 'lines') {
    return {
      parts: [actor, ' changed ', { strong: label }],
      details: [...lineChanges(before, after.value), ...details],
    }
  }
  if (unit === 'words') {
    return {
      parts: [actor, ' changed the words for ', { strong: label }],
      details: [`${formatWire(key, before)} → ${formatWire(key, after.value)}`, ...details],
    }
  }
  return {
    parts: [
      actor,
      ' changed ',
      { strong: label },
      ' from ',
      { strong: formatWire(key, before) },
      ' to ',
      { strong: formatWire(key, after.value) },
    ],
    details,
  }
}

function seasonFieldLines(before: SeasonFields, after: SeasonFields): string[] {
  const lines: string[] = []
  if (after.name !== undefined) lines.push(`Name: ${before.name ?? '?'} → ${after.name}`)
  if (after.startsAt !== undefined)
    lines.push(`Starts: ${when(before.startsAt)} → ${when(after.startsAt)}`)
  if (after.endsAt !== undefined) lines.push(`Ends: ${when(before.endsAt)} → ${when(after.endsAt)}`)
  if (after.startingBalance !== undefined) {
    lines.push(
      `Starting chips: ${formatChips(amount(before.startingBalance))} → ${formatChips(amount(after.startingBalance))}`,
    )
  }
  return lines
}

/**
 * The sentence and details for one audit row. `hustle` is the third income
 * button's name now, for the settings named after it.
 */
export function describeEntry(entry: AuditEntryView, hustle?: string): Described {
  const actor: Part = { person: entry.actor }
  const who = (id: unknown): AuditPerson | null =>
    typeof id === 'string' ? (entry.people[id] ?? null) : null
  const byUsername = (name: string | null): AuditPerson | null =>
    Object.values(entry.people).find((p) => p.username.toLowerCase() === name?.toLowerCase()) ??
    null
  const seasonName = entry.season?.name ?? 'the season'

  switch (entry.action) {
    case 'chips.adjusted': {
      const { before, after } = entry as unknown as AdjustAudit
      const delta = amount(after?.delta)
      const self = entry.actor?.id === after?.userId
      const account = after?.account ?? 'wallet'
      const whose: Part[] = self
        ? [` their own ${account}`]
        : [' ', { person: who(after?.userId) }, `’s ${account}`]
      const verb = delta > 0n ? ` added ${chipCount(delta)} to` : ` took ${chipCount(-delta)} from`
      const shown = account === 'vault' ? 'Vault' : 'Wallet'
      return {
        parts: [actor, verb, ...whose],
        details: [
          `${shown}: ${formatChips(amount(before?.value))} → ${formatChips(amount(after?.value))}`,
        ],
      }
    }
    case 'giveaway.given': {
      const { after } = entry as unknown as GiveawayAudit
      const recipients = after?.recipients ?? []
      const people = recipients.map((r) => who(r.userId))
      const share = amount(after?.share)
      const count = recipients.length
      const total = `${count} players, ${chipCount(amount(after?.total))} in all`
      if (count === 1) {
        return {
          parts: [actor, ' gave ', ...joinPeople(people), ` ${chipCount(share)}`],
          details: [],
        }
      }
      if (after?.split) {
        const between: Part[] = after.everyone ? [`all ${count} players`] : joinPeople(people)
        return {
          parts: [
            actor,
            ` split ${chipCount(amount(after.amount))} between `,
            ...between,
            `, ${formatChips(share)} each`,
          ],
          details: [total],
        }
      }
      if (after?.everyone) {
        return { parts: [actor, ` gave everyone ${chipCount(share)}`], details: [total] }
      }
      return {
        parts: [actor, ' gave ', ...joinPeople(people), ` ${chipCount(share)} each`],
        details: [total],
      }
    }
    case 'config.changed':
      return describeConfig(entry, actor, hustle)
    case 'season.created': {
      const after = isRecord(entry.after) ? entry.after : {}
      return {
        parts: [actor, ' scheduled ', { strong: String(after.name ?? seasonName) }],
        details: [
          `${day(after.startsAt)} to ${day(after.endsAt)}, ${chipCount(amount(after.startingBalance))} each to start`,
        ],
      }
    }
    case 'season.ended_early': {
      const { before, after } = entry as unknown as SeasonEndAudit
      if (after?.immediate) {
        return {
          parts: [actor, ' ended ', { strong: seasonName }, ' early'],
          details: [`It was to end ${when(before?.endsAt)}`],
        }
      }
      return {
        parts: [actor, ' moved the end of ', { strong: seasonName }, ` to ${when(after?.endsAt)}`],
        details: [`It was ${when(before?.endsAt)}`],
      }
    }
    case 'season.updated': {
      const { before = {}, after = {} } = entry as unknown as Partial<SeasonEditAudit>
      const fields = Object.keys(after)
      if (fields.length === 1 && after.name !== undefined) {
        return {
          parts: [
            actor,
            ' renamed ',
            { strong: before.name ?? seasonName },
            ' to ',
            { strong: after.name },
          ],
          details: [],
        }
      }
      return {
        parts: [actor, ' changed ', { strong: seasonName }],
        details: seasonFieldLines(before, after),
      }
    }
    case 'player.disabled': {
      const after = isRecord(entry.after) ? entry.after : {}
      const player = who(after.userId) ?? byUsername(entry.target)
      return { parts: [actor, ' disabled ', { person: player }, '’s account'], details: [] }
    }
    case 'player.enabled': {
      const after = isRecord(entry.after) ? entry.after : {}
      const player = who(after.userId) ?? byUsername(entry.target)
      return { parts: [actor, ' let ', { person: player }, ' sign in again'], details: [] }
    }
    case 'reset_code.created': {
      const player = byUsername(entry.target)
      return {
        parts: [
          actor,
          ' made a password reset code for ',
          player ? { person: player } : { strong: entry.target ?? 'a player' },
        ],
        details: [],
      }
    }
    case 'chat.deleted': {
      const before = isRecord(entry.before) ? entry.before : {}
      if (before.kind === 'system') return { parts: [actor, ' deleted a system post'], details: [] }
      return {
        parts: [actor, ' deleted a message from ', { person: who(before.userId) }],
        details: [],
      }
    }
    default:
      return {
        parts: [actor, ` did ${entry.action}`, ...(entry.target ? [` (${entry.target})`] : [])],
        details: [],
      }
  }
}

/** The sentence as plain text, for a title or a screen reader's summary. */
export function plainText(parts: readonly Part[]): string {
  return parts
    .map((part) =>
      typeof part === 'string'
        ? part
        : 'person' in part
          ? (part.person?.displayName ?? 'Someone')
          : part.strong,
    )
    .join('')
}

/** A change waiting for the reset: "Steal attempts per day: 2 → 5". */
export function describePending(
  change: PendingChangeView,
  hustle?: string,
): { label: string; change: string } {
  if (!isConfigKey(change.key)) return { label: change.key, change: '' }
  const key = change.key as ConfigKey
  const unit = setting(key).unit
  if (unit === 'lines') {
    const now = Array.isArray(change.value) ? change.value.length : 0
    return {
      label: settingLabel(key, hustle),
      change: `${formatWire(key, change.current)} → ${now} lines`,
    }
  }
  return {
    label: settingLabel(key, hustle),
    change: `${formatWire(key, change.current)} → ${formatWire(key, change.value)}`,
  }
}
