/**
 * Keyboard shortcuts (spec: Sound and keys: "Every game has keyboard
 * shortcuts, shown as small hints on the buttons"). The hint is hidden on
 * touch screens, where there is no keyboard to hint at.
 *
 *   useShortcuts({ h: hit, s: stand }, { enabled: open !== null })
 *   <button onClick={hit}>Hit <Kbd>H</Kbd></button>
 *
 * Shortcuts stay quiet while the player types in a text box, such as the bet
 * box or chat, and while a sheet or menu is open. Escape leaves the bet box.
 */
import { type ReactNode, useEffect, useRef } from 'react'

export function Kbd({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      aria-hidden="true"
      className={`ml-1.5 hidden rounded-[5px] border border-current/25 px-1 py-px font-sans text-[0.65rem] leading-none font-semibold opacity-70 [@media(pointer:fine)]:inline-block ${className}`}
    >
      {children}
    </kbd>
  )
}

/** Input types that take typing. Buttons, checkboxes and sliders do not. */
const TEXT_INPUTS = new Set([
  'text',
  'search',
  'number',
  'email',
  'password',
  'tel',
  'url',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
])

/** Whether a key event should go to a game's shortcuts, not to a text box or a menu. */
export function isShortcut(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return false
  const target = event.target as HTMLElement | null
  if (!target || typeof target.closest !== 'function') return true
  if (target.isContentEditable) return false
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return false
  if (tag === 'INPUT' && TEXT_INPUTS.has((target as HTMLInputElement).type)) return false
  // Open dialogs (chat sheet, profile card) keep their keys.
  return !target.closest('[role="dialog"], [role="menu"], [role="listbox"]')
}

/**
 * Whether Enter or Space would already press the focused control (a button
 * or link), so a shortcut on those keys must not fire as well.
 */
export function pressesFocused(event: KeyboardEvent): boolean {
  if (event.key !== 'Enter' && event.key !== ' ') return false
  const target = event.target as HTMLElement | null
  if (!target || typeof target.closest !== 'function') return false
  return target.closest('button, a[href], input, [role="button"], [role="radio"], summary') !== null
}

/** A key as a shortcut map names it: lowercase letters, "Enter", "Space", "Escape". */
export function shortcutKey(event: KeyboardEvent): string {
  if (event.key === ' ') return 'Space'
  return event.key.length === 1 ? event.key.toLowerCase() : event.key
}

export type Shortcuts = Partial<Record<string, () => void>>

/**
 * Runs `shortcuts[key]` on a key press anywhere in the page, unless the
 * player is typing or a dialog is open. Keys are lowercase letters, digits,
 * or "Enter", "Space", "ArrowLeft" and so on. The map may change on every
 * render.
 */
export function useShortcuts(shortcuts: Shortcuts, options: { enabled?: boolean } = {}): void {
  const enabled = options.enabled ?? true
  const latest = useRef(shortcuts)
  useEffect(() => {
    latest.current = shortcuts
  })
  useEffect(() => {
    if (!enabled) return
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || !isShortcut(event) || pressesFocused(event)) return
      const run = latest.current[shortcutKey(event)]
      if (!run) return
      event.preventDefault()
      run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
