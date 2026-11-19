/**
 * Keyboard shortcuts for the top-bar buttons, which sit in every room (spec:
 * Sound and keys). Rooms own the plain letters, so these take Shift:
 *
 *   Shift+W  work        Shift+C  crime     Shift+D  the Daily panel
 *   Shift+S  slut        Shift+I  collect
 *
 * The hustle button takes the first letter of its name when that is free.
 */
import type { IncomeCommand } from '../../../shared/features/economy.ts'

export type ShortcutAction = IncomeCommand | 'collect' | 'daily'

const FIXED: Record<Exclude<ShortcutAction, 'hustle'>, string> = {
  work: 'w',
  crime: 'c',
  collect: 'i',
  daily: 'd',
}

const TAKEN = new Set(Object.values(FIXED))

/** The letter pressed with Shift for `action`. */
export function shortcutLetter(action: ShortcutAction, hustleName = 'Slut'): string {
  if (action !== 'hustle') return FIXED[action]
  const first = hustleName.trim().charAt(0).toLowerCase()
  return /^[a-z]$/.test(first) && !TAKEN.has(first) ? first : 's'
}

/** " (Shift+W)", for a tooltip. */
export function shortcutHint(action: ShortcutAction, hustleName?: string): string {
  return ` (Shift+${shortcutLetter(action, hustleName).toUpperCase()})`
}

/** The action a key press asks for, or null. Only Shift with a letter counts. */
export function shortcutFor(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey'>,
  hustleName?: string,
): ShortcutAction | null {
  if (!event.shiftKey || event.key.length !== 1) return null
  const letter = event.key.toLowerCase()
  const actions: ShortcutAction[] = ['work', 'hustle', 'crime', 'collect', 'daily']
  return actions.find((action) => shortcutLetter(action, hustleName) === letter) ?? null
}
