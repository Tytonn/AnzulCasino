/**
 * Reading the message box (spec: Commands). Anything typed after the prefix
 * and a letter is a command; everything else is chat, so "..." and ".5"
 * stay chat. A command's words come from its setting, so the admin panel
 * renames it at once; what it does comes from the manifest that declared it.
 *
 *   const commands = resolveCommands(specs, config)
 *   parseInput('.bj 50', '.', commands)   // { kind: 'command', command, word: 'bj', args: '50' }
 *   parseInput('.bjj', '.', commands)     // { kind: 'unknown', word: 'bjj', suggestion: '.bj' }
 *
 * Pure functions, so the unit tests read them directly.
 */
import { parseBetAmount } from '../../../shared/bet-amount.ts'
import { type CommandKey, type ConfigValues, setting } from '../../../shared/config.ts'
import type { PlayerSummary } from '../../../shared/players.ts'
import type { Wire } from '../../../shared/wire.ts'
import type { CommandSpec } from '../manifests.ts'

export interface Command {
  spec: CommandSpec
  key: CommandKey
  /** Its words from the settings. The first is its name. */
  words: readonly string[]
  /** Its name in the settings, such as "Blackjack". */
  label: string
}

/** Each spec with its words from the settings. A spec whose setting has no words is left out. */
export function resolveCommands(
  specs: readonly CommandSpec[],
  config: Pick<Wire<ConfigValues>, CommandKey> | undefined,
): Command[] {
  const commands: Command[] = []
  const taken = new Set<string>()
  for (const spec of specs) {
    const definition = setting(spec.key)
    const fromConfig = config?.[spec.key]
    const words = (Array.isArray(fromConfig) ? fromConfig : definition.default) as string[]
    // Two specs on one setting: the first one keeps it.
    if (taken.has(spec.key)) continue
    taken.add(spec.key)
    if (words.length === 0) continue
    const label = 'label' in definition ? definition.label : spec.key
    commands.push({ spec, key: spec.key, words, label })
  }
  return commands
}

export type Parsed =
  /** Not a command: send it as a message. */
  | { kind: 'chat' }
  /** Only the prefix so far. */
  | { kind: 'prefix' }
  | { kind: 'command'; command: Command; word: string; args: string }
  | { kind: 'unknown'; word: string; suggestion: string | null }

const COMMAND = /^([a-z][a-z0-9]*)([\s\S]*)$/i

export function parseInput(text: string, prefix: string, commands: readonly Command[]): Parsed {
  if (!prefix || !text.startsWith(prefix)) return { kind: 'chat' }
  const rest = text.slice(prefix.length)
  if (rest === '') return { kind: 'prefix' }
  const match = COMMAND.exec(rest)
  if (!match) return { kind: 'chat' }
  const word = (match[1] ?? '').toLowerCase()
  const after = match[2] ?? ''
  const command = commands.find((c) => c.words.includes(word))
  if (command) return { kind: 'command', command, word, args: after.trim() }
  return { kind: 'unknown', word, suggestion: suggest(word, prefix, commands) }
}

/** Edits between two words: a letter added, dropped or changed. */
export function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      )
    }
    previous = current
  }
  return previous[b.length] ?? 0
}

/** What the player probably meant by a word no command has, or null. */
export function suggest(word: string, prefix: string, commands: readonly Command[]): string | null {
  const words = commands.flatMap((c) => c.words)
  // ".bj50": the word ran into its amount.
  for (const w of words) {
    const tail = word.slice(w.length)
    if (word.startsWith(w) && /^\d/.test(tail)) return `${prefix}${w} ${tail}`
  }
  const most = word.length <= 3 ? 1 : 2
  let best: { word: string; edits: number } | null = null
  for (const w of words) {
    const edits = distance(word, w)
    if (edits <= most && (!best || edits < best.edits)) best = { word: w, edits }
  }
  if (best) return `${prefix}${best.word}`
  const longer = words.find((w) => w.startsWith(word))
  return longer ? `${prefix}${longer}` : null
}

export function unknownHint(word: string, prefix: string, suggestion: string | null): string {
  return suggestion
    ? `There is no ${prefix}${word}. Did you mean ${suggestion}?`
    : `There is no ${prefix}${word}. Type ${prefix}help to see every command.`
}

/** One line of the command list: a command, and the word of it that matched. */
export interface ListRow {
  command: Command
  word: string
}

/**
 * The command list while the player types a command's word: every command
 * with a word that starts with what is typed, an exact word first. Null once
 * the word is done (a space after it) or when this is not a command.
 */
export function listFor(
  text: string,
  prefix: string,
  commands: readonly Command[],
): ListRow[] | null {
  if (!prefix || !text.startsWith(prefix)) return null
  const typed = text.slice(prefix.length)
  if (typed !== '' && !/^[a-z][a-z0-9]*$/i.test(typed)) return null
  const lower = typed.toLowerCase()
  const rows: { row: ListRow; rank: number; order: number }[] = []
  commands.forEach((command, order) => {
    // A game still to come shows once its word is typed, not in the whole list.
    if (command.spec.soon && lower === '') return
    const word =
      command.words.find((w) => w === lower) ?? command.words.find((w) => w.startsWith(lower))
    if (!word) return
    const rank = word === lower ? 0 : word === command.words[0] ? 1 : 2
    rows.push({ row: { command, word }, rank, order })
  })
  return rows.sort((a, b) => a.rank - b.rank || a.order - b.order).map((r) => r.row)
}

export type ChoiceSplit =
  { ok: true; rest: string; choice: string | null } | { ok: false; error: string }

/**
 * Takes the side a command's player named (CommandSpec.choices) out of what
 * they typed after its word, wherever it stands: "50 heads" and "t 50" both
 * leave the amount. Two different sides are refused.
 *
 *   splitChoice('t 50', [['heads', 'h'], ['tails', 't']])  // { ok, rest: '50', choice: 'tails' }
 */
export function splitChoice(args: string, choices: CommandSpec['choices']): ChoiceSplit {
  if (!choices?.length) return { ok: true, rest: args, choice: null }
  let choice: string | null = null
  const rest: string[] = []
  for (const token of args.split(/\s+/).filter(Boolean)) {
    const named = choices.find((words) => words.includes(token.toLowerCase()))
    if (!named) {
      rest.push(token)
      continue
    }
    if (choice !== null && choice !== named[0]) {
      return { ok: false, error: `Pick one: ${orList(choices.map((words) => words[0]))}.` }
    }
    choice = named[0]
  }
  return { ok: true, rest: rest.join(' '), choice }
}

/** "heads or tails", "red, black or green". */
function orList(words: readonly string[]): string {
  if (words.length < 2) return words.join('')
  return `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`
}

/** Why a command cannot run with these arguments yet, before anything is sent. */
export function checkArgs(command: Command, called: string, args: string): string | null {
  const { needs, args: what, example } = command.spec
  const split = splitChoice(args, command.spec.choices)
  if (!split.ok) return split.error
  if (needs === 'amount') {
    // "bet side" asks for a bet: the side can be left out.
    const noun = what?.split(/\s+/)[0] || 'amount'
    if (!split.rest) {
      return `${called} needs ${article(noun)} ${noun}, like ${called} ${example ?? '50'} or ${called} all.`
    }
    const parsed = parseBetAmount(split.rest, 0n)
    if (!parsed.ok) return parsed.error
  }
  if (needs === 'player' && !args) {
    return `${called} needs a player, like ${called} ${example ?? 'alice'}.`
  }
  return command.spec.check?.(args, called) ?? null
}

function article(noun: string): string {
  return /^[aeiou]/i.test(noun) ? 'an' : 'a'
}

/**
 * A player by what was typed: a username or a display name, in any case,
 * with or without the @; or the only player whose name starts with it.
 */
export function findPlayer(
  players: readonly PlayerSummary[] | undefined,
  typed: string,
): PlayerSummary | undefined {
  const wanted = typed.trim().replace(/^@/, '').toLowerCase()
  if (!wanted || !players) return undefined
  const exact = players.find(
    (p) => p.username.toLowerCase() === wanted || p.displayName.toLowerCase() === wanted,
  )
  if (exact) return exact
  const starts = players.filter(
    (p) =>
      p.username.toLowerCase().startsWith(wanted) || p.displayName.toLowerCase().startsWith(wanted),
  )
  return starts.length === 1 ? starts[0] : undefined
}

/** Players whose name starts with what was typed, for the list after .rob or .bal. */
export function playerMatches(
  players: readonly PlayerSummary[] | undefined,
  typed: string,
  except?: string,
): PlayerSummary[] {
  const wanted = typed.trim().replace(/^@/, '').toLowerCase()
  return (players ?? [])
    .filter((p) => p.id !== except)
    .filter(
      (p) =>
        !wanted ||
        p.username.toLowerCase().startsWith(wanted) ||
        p.displayName.toLowerCase().startsWith(wanted),
    )
    .slice(0, 6)
}
