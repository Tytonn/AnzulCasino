/**
 * The settings editor's arithmetic (spec: Admin panel > Config): the
 * sections it groups settings into, a label for each key, and how each unit
 * is typed and turned back into the value the server stores. Pure, so the
 * unit tests cover it, and checked with the same shared rules the server
 * uses, so most mistakes show on the row before a save.
 */
import {
  COMMAND_KEYS,
  CONFIG_KEYS,
  type ConfigGroup,
  type ConfigKey,
  type ConfigValue,
  commandWordClash,
  DELAYED_GROUPS,
  formatConfigValue,
  parseConfigValue,
  setting,
} from '../../../shared/config.ts'

/** A setting's value as it travels: a number (chips in hundredths, shares in basis points), text, or a list. */
export type WireValue = number | string | string[]

/** What an input holds while the admin types: text for numbers, names and lines; a list for a command's words. */
export type Draft = string | string[]

export interface Section {
  group: ConfigGroup
  title: string
  blurb: string
}

/** The editor's sections, in the order they show. Every group has one. */
export const SECTIONS: readonly Section[] = [
  {
    group: 'commands',
    title: 'Commands',
    blurb:
      'What players type in the message box. Each command has a name and up to seven aliases, and no word can belong to two commands.',
  },
  {
    group: 'stream',
    title: 'Stream',
    blurb: 'How the stream shows finished rounds and the balance and leaderboard commands.',
  },
  {
    group: 'text',
    title: 'Work and crime',
    blurb:
      'The third income button’s name, and the lines picked at random to show with each result.',
  },
  { group: 'seasons', title: 'Seasons', blurb: 'What each new season starts with.' },
  {
    group: 'economy',
    title: 'Economy',
    blurb: 'The streak bonus, challenges, and what work, crime and the third button pay.',
  },
  { group: 'ranks', title: 'Ranks', blurb: 'Each rank’s price, daily income and unlock day.' },
  {
    group: 'giveaways',
    title: 'Chat drops',
    blurb: 'How often a pot drops in chat, and its size.',
  },
  { group: 'steals', title: 'Steals', blurb: 'Attempts, chances, rates, fines and the loss cap.' },
  { group: 'shields', title: 'Shields', blurb: 'What a shield charge costs and how many to hold.' },
  {
    group: 'vault',
    title: 'Vault',
    blurb: 'How much of a player’s net worth the vault keeps safe.',
  },
  { group: 'games', title: 'Games', blurb: 'Bets, house edges and round timings.' },
  { group: 'social', title: 'Chat', blurb: 'Chat limits and when a player shows as away.' },
]

/** True when a change to this group waits for the next daily reset. */
export function groupWaits(group: ConfigGroup): boolean {
  return DELAYED_GROUPS.includes(group)
}

/** The keys of one section, in the order shared/config.ts lists them. */
export function sectionKeys(group: ConfigGroup): ConfigKey[] {
  return CONFIG_KEYS.filter((key) => setting(key).group === group)
}

/** Unit words a key ends with; the input shows the unit beside it instead. */
const UNIT_SUFFIX = /_(pct|ms|seconds|minutes|hours|days|times)$/

const LABELS: Partial<Record<ConfigKey, string>> = {
  command_prefix: 'Prefix',
  hustle_name: 'Third button’s name',
  stream_round_runs: 'Finished rounds',
  stream_bal_lb: 'Balance and leaderboard answers',
}

/**
 * A setting's name for people: "Work pay max", "Bronze price", "Blackjack".
 * `hustle` is the third income button's name now, which stands in for the
 * word "hustle" in its settings, as players see it.
 */
export function settingLabel(key: ConfigKey, hustle?: string): string {
  const s = setting(key)
  if (s.unit === 'words') return key === 'command_hustle' && hustle ? hustle : s.label
  const fixed = LABELS[key]
  if (fixed) return fixed
  let name = key.replace(UNIT_SUFFIX, '')
  if (s.group === 'ranks') name = name.replace(/^tier_/, '')
  const words = name.split('_').map((word) => (word === 'hustle' ? (hustle ?? 'Hustle') : word))
  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * A setting's description as the editor shows it. One shared description
 * names another setting by its key, so it reads in the editor's words.
 */
export function settingDescription(key: ConfigKey, hustle?: string): string {
  if (key === 'command_hustle') {
    return `${hustle ?? 'Hustle'}: pays or fines, then waits out its cooldown. Its button’s name is under Work and crime.`
  }
  return setting(key).description
}

/** What goes beside a number input: "chips", "%", "hours". Empty for a plain count. */
export function unitSuffix(key: ConfigKey): string {
  const { unit } = setting(key)
  switch (unit) {
    case 'chips':
      return 'chips'
    case 'share':
      return '%'
    case 'times':
      return '×'
    case 'milliseconds':
      return 'ms'
    case 'seconds':
    case 'minutes':
    case 'hours':
    case 'days':
      return unit
    default:
      return ''
  }
}

/** Hundredths as typed: 250 is "2.5", 200 is "2", 1234 is "12.34". */
export function hundredthsText(value: number): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(value))
  const whole = Math.floor(abs / 100)
  const rest = abs % 100
  // Grouped, so 10,000,000 reads at a glance; parseHundredths takes the commas back out.
  const grouped = whole.toLocaleString('en-US')
  if (rest === 0) return `${sign}${grouped}`
  return `${sign}${grouped}.${String(rest).padStart(2, '0').replace(/0$/, '')}`
}

/** "2.5" or "1,000.25" as hundredths, or null when it is not a plain amount. */
export function parseHundredths(text: string): number | null {
  const clean = text.trim().replace(/,/g, '')
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(clean)
  if (!match) return null
  const whole = Number(match[1])
  const rest = Number((match[2] ?? '').padEnd(2, '0'))
  const value = whole * 100 + rest
  return Number.isSafeInteger(value) ? value : null
}

/** The value an input starts from. */
export function toDraft(key: ConfigKey, wire: unknown): Draft {
  const { unit } = setting(key)
  if (unit === 'words') return Array.isArray(wire) ? wire.map(String) : []
  if (unit === 'lines') return Array.isArray(wire) ? wire.map(String).join('\n') : ''
  if (unit === 'text' || unit === 'choice') return typeof wire === 'string' ? wire : ''
  if (typeof wire !== 'number') return ''
  if (unit === 'chips' || unit === 'share') return hundredthsText(wire)
  return String(wire)
}

/** A line list from the textarea: one per line, blank lines dropped. */
export function draftLines(draft: string): string[] {
  return draft
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export type Checked = { ok: true; value: WireValue } | { ok: false; error: string }

/** The shared rule's sentence, with the setting's name in place of its key. */
export function friendlyError(key: ConfigKey, message: string, hustle?: string): string {
  return message.split(key).join(settingLabel(key, hustle))
}

/**
 * Turns what was typed into the value to save, checked against the
 * setting's unit and limits with the server's own rules.
 */
export function fromDraft(key: ConfigKey, draft: Draft, hustle?: string): Checked {
  const s = setting(key)
  let value: WireValue
  if (s.unit === 'words') {
    value = (Array.isArray(draft) ? draft : []).map((w) => w.trim().toLowerCase())
  } else if (s.unit === 'lines') {
    const lines = draftLines(typeof draft === 'string' ? draft : '')
    const long = lines.findIndex((line) => line.length > s.maxLength)
    if (long >= 0) {
      return {
        ok: false,
        error: `Line ${long + 1} is ${lines[long]?.length} characters. Keep each line to ${s.maxLength}.`,
      }
    }
    if (lines.length === 0) return { ok: false, error: 'Add at least one line.' }
    if (lines.length > s.maxLines) {
      return { ok: false, error: `That is ${lines.length} lines. Keep it to ${s.maxLines}.` }
    }
    value = lines
  } else if (s.unit === 'text' || s.unit === 'choice') {
    value = typeof draft === 'string' ? draft.trim() : ''
    if (s.unit === 'text' && !value) return { ok: false, error: 'Type a name.' }
  } else {
    const text = typeof draft === 'string' ? draft : ''
    if (!text.trim()) return { ok: false, error: 'Type a value.' }
    if (s.unit === 'chips' || s.unit === 'share') {
      const parsed = parseHundredths(text)
      if (parsed === null) {
        return {
          ok: false,
          error:
            s.unit === 'chips'
              ? 'Type a number of chips, such as 5 or 2.50.'
              : 'Type a percentage, such as 45 or 1.5.',
        }
      }
      value = parsed
    } else {
      const clean = text.trim().replace(/,/g, '')
      if (!/^\d+$/.test(clean)) return { ok: false, error: 'Type a whole number.' }
      value = Number(clean)
    }
    const { min, max } = s
    const low = Number(min)
    const high = Number(max)
    if (value < low || value > high) {
      const shown = (n: number) => formatConfigValue(key, s.unit === 'chips' ? BigInt(n) : n)
      return { ok: false, error: `Use ${shown(low)} to ${shown(high)}.` }
    }
  }
  const parsed = parseConfigValue(key, value)
  if (!parsed.ok) return { ok: false, error: friendlyError(key, parsed.error, hustle) }
  return { ok: true, value }
}

/** Two wire values are the same setting value. */
export function sameWire(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** A wire value as the shared helpers read it: chips as bigint. */
export function fromWire(key: ConfigKey, wire: unknown): ConfigValue {
  const { unit } = setting(key)
  if (unit === 'chips' && typeof wire === 'number') return BigInt(wire)
  return wire as ConfigValue
}

/** A wire value for people: "2.50 chips", "45%", "bj, blackjack", a choice's label. */
export function formatWire(key: ConfigKey, wire: unknown): string {
  return formatConfigValue(key, fromWire(key, wire))
}

/**
 * Warns while the admin types, before the server refuses it: a word another
 * command has, counting the other commands' unsaved words too.
 */
export function wordClash(
  key: ConfigKey,
  words: readonly string[],
  commands: Partial<Record<ConfigKey, readonly string[]>>,
): string | undefined {
  const current: Partial<Record<ConfigKey, ConfigValue>> = {}
  for (const other of COMMAND_KEYS) {
    const theirs = commands[other]
    if (theirs) current[other] = theirs
  }
  return commandWordClash(key, words, current)
}
