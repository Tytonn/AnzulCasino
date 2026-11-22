/**
 * The message box (spec: Commands): chat, and every command typed after the
 * prefix. The prefix opens the command list above the box, one line on what
 * each does; Tab or Enter completes a command's word, and a player's name
 * after .rob or .bal or an @ in chat. A command runs instead of posting, and
 * its text is never sent as chat. When it cannot run, its text stays in the
 * box with the reason just above it, for the player alone. Up brings back
 * what you sent before.
 *
 * While one of your cards has the keys (src/kit/cards.ts), the box lets go
 * of the keyboard. A key the card does not answer to comes back here and
 * types, as does any letter typed while nothing else has focus.
 */
import { useQueryClient } from '@tanstack/react-query'
import {
  type KeyboardEvent as KeyEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { useNavigate } from 'react-router'

import { parseBetAmount } from '../../../shared/bet-amount.ts'
import { CHAT_MAX_LENGTH, type ChatMessage, chatLength } from '../../../shared/chat.ts'
import { formatChips } from '../../../shared/chips.ts'
import type { PlayerSummary } from '../../../shared/players.ts'
import { api, ApiError, errorMessage } from '../../kit/api.ts'
import { CommandRefusal, returnKeys, showCard, useCardKeys } from '../../kit/cards.ts'
import { CloseIcon, SendIcon } from '../../kit/icons.tsx'
import { isShortcut, shortcutKey } from '../../kit/Kbd.tsx'
import { TOUCH } from '../../kit/media.ts'
import { Avatar, PlayerName } from '../../kit/PlayerName.tsx'
import { useMe, usePlayers, useWallet } from '../../kit/queries.ts'
import { Slot } from '../Slot.tsx'
import {
  checkArgs,
  type Command,
  listFor,
  type ListRow,
  parseInput,
  type Parsed,
  playerMatches,
  unknownHint,
} from './commands.ts'
import { addToStream, newestId } from './live.ts'
import { addPrivate } from './private.ts'
import { useCommands } from './shell-commands.tsx'
import { useStreamUi } from './ui.ts'

/** What you sent in this tab, newest last, for the Up key. */
const sent: string[] = []
const SENT_KEEP = 30

function remember(text: string) {
  if (sent.at(-1) !== text) sent.push(text)
  if (sent.length > SENT_KEEP) sent.shift()
}

/** A reason a command did not run, and maybe what to type instead. */
interface Hint {
  text: string
  /** Replaces the command's word, such as ".bj" for ".bjj". */
  fix?: string
}

/** What shows above the box while typing. */
type Popup =
  | { kind: 'commands'; rows: ListRow[] }
  | { kind: 'players'; rows: PlayerSummary[]; start: number; mention: boolean }
  | { kind: 'usage'; command: Command; word: string; args: string }
  | null

const MENTION = /(?:^|\s)@([A-Za-z0-9_]*)$/

function popupFor(input: {
  text: string
  prefix: string
  commands: readonly Command[]
  parsed: Parsed
  players: readonly PlayerSummary[] | undefined
  me: string
}): Popup {
  const { text, prefix, commands, parsed, players, me } = input
  const rows = listFor(text, prefix, commands)
  if (rows) return rows.length > 0 ? { kind: 'commands', rows } : null
  if (parsed.kind === 'command') {
    const { command, word, args } = parsed
    const { spec } = command
    if ((spec.args === 'player' || spec.needs === 'player') && !/\s/.test(args)) {
      const found = playerMatches(players, args, me)
      const exact = found.some(
        (p) => p.username.toLowerCase() === args.replace(/^@/, '').toLowerCase(),
      )
      if (found.length > 0 && !exact) {
        return { kind: 'players', rows: found, start: text.length - args.length, mention: false }
      }
    }
    return { kind: 'usage', command, word, args }
  }
  if (parsed.kind === 'chat') {
    const mention = MENTION.exec(text)
    if (mention) {
      const typed = mention[1] ?? ''
      const found = playerMatches(players, typed, me)
      const exact = found.some((p) => p.username.toLowerCase() === typed.toLowerCase())
      if (found.length > 0 && !exact) {
        return {
          kind: 'players',
          rows: found,
          start: text.length - typed.length - 1,
          mention: true,
        }
      }
    }
  }
  return null
}

export function Composer({ active }: { active: boolean }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const me = useMe()
  const { data: players } = usePlayers()
  const wallet = useWallet()
  const { commands, prefix } = useCommands()
  const toBottom = useStreamUi((s) => s.toBottom)
  const keysRound = useCardKeys((s) => s.roundId)

  const id = useId()
  const listId = `${id}-list`
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [hint, setHint] = useState<Hint | null>(null)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  // The list's highlight and Escape belong to the text they were made for.
  const [pick, setPick] = useState({ text: '', index: 0 })
  const [closedFor, setClosedFor] = useState<string | null>(null)
  const recall = useRef<number | null>(null)

  const parsed = parseInput(text, prefix, commands)
  const popup =
    closedFor === text ? null : popupFor({ text, prefix, commands, parsed, players, me: me.id })
  const rows = popup?.kind === 'commands' || popup?.kind === 'players' ? popup.rows : []
  const highlight = pick.text === text ? Math.min(pick.index, Math.max(0, rows.length - 1)) : 0
  const length = parsed.kind === 'chat' ? chatLength(text.trim()) : 0
  const tooLong = length > CHAT_MAX_LENGTH

  function change(value: string) {
    setText(value)
    setHint(null)
    recall.current = null
  }

  function focus() {
    input.current?.focus()
  }

  // On a desktop the box has the keyboard from the start.
  useEffect(() => {
    if (active && !matchMedia(TOUCH).matches) focus()
  }, [active])

  // When a card gives the keys back, the box takes them again on a desktop.
  const hadKeys = useRef(false)
  useEffect(() => {
    const had = hadKeys.current
    hadKeys.current = keysRound !== null
    if (!had || keysRound !== null || !active || matchMedia(TOUCH).matches) return
    if (document.activeElement === document.body || document.activeElement === null) focus()
  }, [keysRound, active])

  // Typing while nothing else listens types here: a letter the card with
  // the keys does not answer to, or any letter with nothing focused. Escape
  // takes the keys back from the card.
  useEffect(() => {
    if (!active) return
    function onKey(event: KeyboardEvent) {
      const box = input.current
      if (!box || event.defaultPrevented || document.activeElement === box) return
      if (event.key === 'Escape') {
        if (useCardKeys.getState().roundId === null) return
        const target = event.target as HTMLElement | null
        if (target?.closest?.('[role="dialog"], [role="menu"]')) return
        returnKeys()
        if (!matchMedia(TOUCH).matches) box.focus()
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key.length !== 1 || event.key === ' ') return
      if (!isShortcut(event)) return
      const { roundId, claimed } = useCardKeys.getState()
      if (roundId !== null && claimed.includes(shortcutKey(event))) return
      // Focused now, the key types into the box.
      box.focus()
      returnKeys()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  function complete(index = highlight) {
    if (popup?.kind === 'commands') {
      const row = popup.rows[index]
      if (!row) return
      const takes = row.command.spec.args !== undefined
      change(`${prefix}${row.word}${takes ? ' ' : ''}`)
    } else if (popup?.kind === 'players') {
      const player = popup.rows[index]
      if (!player) return
      const name = popup.mention ? `@${player.username} ` : player.username
      change(`${text.slice(0, popup.start)}${name}`)
    }
    focus()
  }

  async function sendChat(body: string) {
    running.current = true
    setBusy(true)
    try {
      const { message } = await api.post<{ message: ChatMessage }>('/api/chat', { body })
      addToStream(queryClient, message)
      remember(body)
      change('')
      toBottom()
    } catch (error) {
      setHint({ text: errorMessage(error) })
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  async function runCommand(command: Command, word: string, args: string) {
    const called = `${prefix}${word}`
    const problem = checkArgs(command, called, args)
    if (problem) {
      setHint({ text: problem })
      return
    }
    running.current = true
    setBusy(true)
    toBottom()
    try {
      await command.spec.run({
        args,
        called,
        queryClient,
        me,
        navigate: (to) => void navigate(to),
        reply: (reply) => {
          addPrivate(reply, newestId(queryClient))
          toBottom()
        },
        showCard,
      })
      remember(text.trim())
      setText('')
      setHint(null)
      recall.current = null
    } catch (error) {
      const known = error instanceof CommandRefusal || error instanceof ApiError
      setHint({ text: known ? error.message : errorMessage(error) })
      if (!known) console.error(error)
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  function submit() {
    if (running.current) return
    const value = text.trim()
    if (!value) return
    const now = parseInput(value, prefix, commands)
    if (now.kind === 'chat') {
      if (!tooLong) void sendChat(value)
      return
    }
    if (now.kind === 'prefix') {
      setHint({ text: `Type a command after the ${prefix}, or ${prefix}help to see them all.` })
      return
    }
    if (now.kind === 'unknown') {
      setHint({
        text: unknownHint(now.word, prefix, now.suggestion),
        fix: now.suggestion ?? undefined,
      })
      return
    }
    void runCommand(now.command, now.word, now.args)
  }

  function onKeyDown(event: KeyEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    const open = rows.length > 0
    if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setPick({ text, index: (highlight + step + rows.length) % rows.length })
      return
    }
    if (open && event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault()
      complete()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      // A command's word typed in full runs; a partial one completes first.
      if (popup?.kind === 'commands' && parsed.kind !== 'command') complete()
      else if (popup?.kind === 'players' && popup.mention) complete()
      else if (popup?.kind === 'players') {
        const player = popup.rows[highlight]
        if (player && parsed.kind === 'command') {
          const args = player.username
          setText(`${text.slice(0, popup.start)}${args}`)
          void runCommand(parsed.command, parsed.word, args)
        }
      } else submit()
      return
    }
    if (event.key === 'Escape') {
      if (open || popup) {
        event.preventDefault()
        setClosedFor(text)
      } else if (hint) {
        event.preventDefault()
        setHint(null)
      }
      return
    }
    // Up and Down walk back through what you sent, from an empty box.
    if (!open && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      if (recall.current === null && (event.key === 'ArrowDown' || text !== '')) return
      event.preventDefault()
      const at = recall.current ?? sent.length
      const next = event.key === 'ArrowUp' ? Math.max(0, at - 1) : at + 1
      if (next >= sent.length) {
        recall.current = null
        setText('')
      } else if (sent[next] !== undefined) {
        recall.current = next
        setText(sent[next])
      }
    }
  }

  function fix(suggestion: string) {
    if (parsed.kind !== 'unknown') return
    change(`${suggestion}${text.slice(prefix.length + parsed.word.length)}`)
    focus()
  }

  const placeholder = `Chat, or type ${prefix} for commands`
  const activeOption = rows.length > 0 ? `${listId}-${highlight}` : undefined

  return (
    <div data-composer className="relative shrink-0 px-2 pb-2 md:px-4" onFocus={() => returnKeys()}>
      <div className="mx-auto w-full max-w-3xl">
        {popup && (
          <Popover
            popup={popup}
            listId={listId}
            highlight={highlight}
            prefix={prefix}
            balance={wallet?.balance}
            onPick={(index) => complete(index)}
            onHover={(index) => setPick({ text, index })}
            onArgs={(args) => {
              if (popup.kind !== 'usage') return
              change(`${prefix}${popup.word} ${args}`)
              focus()
            }}
          />
        )}
        {hint && (
          <div
            role="status"
            data-hint
            className="mb-1.5 flex items-start gap-2 rounded-md border border-dashed border-border-strong bg-surface-1 px-3 py-2 text-sm"
          >
            <span className="mt-0.5 shrink-0 text-[0.62rem] font-semibold tracking-[0.06em] text-faint uppercase">
              Only you
            </span>
            <p className="min-w-0 flex-1 text-text">{hint.text}</p>
            {hint.fix && (
              <button
                type="button"
                onClick={() => fix(hint.fix ?? '')}
                className="shrink-0 font-mono text-[0.8rem] font-semibold text-accent hover:underline"
              >
                Use {hint.fix}
              </button>
            )}
            <button
              type="button"
              onClick={() => setHint(null)}
              aria-label="Dismiss"
              className="-my-1 -mr-1.5 grid size-7 shrink-0 place-items-center rounded-full text-faint hover:bg-surface-3 hover:text-text"
            >
              <CloseIcon className="size-3.5" />
            </button>
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 p-1 shadow-pop focus-within:border-accent"
        >
          <button
            type="button"
            onClick={() => {
              if (!text) change(prefix)
              focus()
            }}
            aria-label="Commands"
            title="Commands"
            className="grid h-9 min-w-9 shrink-0 place-items-center rounded-md bg-surface-3 px-2 font-mono text-xl leading-none font-black text-text hover:bg-border-strong"
          >
            {prefix}
          </button>
          <Slot
            name="chat-composer"
            props={{ sent: (message) => addToStream(queryClient, message) }}
          />
          <label className="sr-only" htmlFor={id}>
            Message or command
          </label>
          <div className="relative min-w-0 flex-1">
            <input
              ref={input}
              id={id}
              value={text}
              onChange={(e) => change(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={parsed.kind === 'chat'}
              enterKeyHint="send"
              role="combobox"
              aria-expanded={rows.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeOption}
              className={`h-9 w-full bg-transparent px-1 text-[0.95rem] text-text placeholder:text-faint focus:outline-none ${parsed.kind === 'chat' ? '' : 'font-mono text-[0.9rem]'}`}
            />
            {length > CHAT_MAX_LENGTH - 50 && (
              <span
                className={`absolute top-1/2 right-1 -translate-y-1/2 text-[0.7rem] tabular-nums ${tooLong ? 'text-loss' : 'text-faint'}`}
              >
                {CHAT_MAX_LENGTH - length}
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={!text.trim() || tooLong || busy}
            aria-label={parsed.kind === 'chat' ? 'Send' : 'Run'}
            className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-on-accent transition hover:bg-accent-strong active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SendIcon className={`size-4 ${busy ? 'animate-pulse' : ''}`} />
          </button>
        </form>
      </div>
    </div>
  )
}

function Popover({
  popup,
  listId,
  highlight,
  prefix,
  balance,
  onPick,
  onHover,
  onArgs,
}: {
  popup: NonNullable<Popup>
  listId: string
  highlight: number
  prefix: string
  balance: number | undefined
  onPick: (index: number) => void
  onHover: (index: number) => void
  onArgs: (args: string) => void
}) {
  const frame = 'mb-1.5 overflow-hidden rounded-md border border-border bg-surface-2 shadow-pop'
  if (popup.kind === 'usage') {
    return <Usage {...popup} prefix={prefix} balance={balance} className={frame} onArgs={onArgs} />
  }
  return (
    <div className={frame}>
      <p className="px-3 pt-2 pb-1 text-[0.62rem] font-semibold tracking-[0.1em] text-faint uppercase">
        {popup.kind === 'commands' ? 'Commands' : 'Players'}
      </p>
      <ul
        id={listId}
        role="listbox"
        aria-label={popup.kind === 'commands' ? 'Commands' : 'Players'}
        className="scroll-quiet max-h-[min(45dvh,20rem)] overflow-y-auto pb-1"
      >
        {popup.kind === 'commands'
          ? popup.rows.map((row, i) => (
              <Option
                key={row.command.key}
                id={`${listId}-${i}`}
                selected={i === highlight}
                onPick={() => onPick(i)}
                onHover={() => onHover(i)}
              >
                <span className="w-28 shrink-0 truncate font-mono text-[0.82rem] font-semibold text-text sm:w-36">
                  {prefix}
                  {row.word}
                  {row.command.spec.args && (
                    <span className="font-normal text-faint"> {row.command.spec.args}</span>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted">
                  {row.command.spec.description}
                </span>
                {row.command.words.length > 1 && (
                  <span className="hidden shrink-0 font-mono text-[0.72rem] text-faint sm:inline">
                    {row.command.words
                      .filter((w) => w !== row.word)
                      .slice(0, 2)
                      .map((w) => `${prefix}${w}`)
                      .join(' ')}
                  </span>
                )}
              </Option>
            ))
          : popup.rows.map((player, i) => (
              <Option
                key={player.id}
                id={`${listId}-${i}`}
                selected={i === highlight}
                onPick={() => onPick(i)}
                onHover={() => onHover(i)}
              >
                <Avatar player={player} size="xs" />
                <PlayerName player={player} badge={false} />
                <span className="truncate text-xs text-faint">@{player.username}</span>
              </Option>
            ))}
      </ul>
    </div>
  )
}

function Option({
  id,
  selected,
  onPick,
  onHover,
  children,
}: {
  id: string
  selected: boolean
  onPick: () => void
  onHover: () => void
  children: ReactNode
}) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      // The box keeps the focus, so typing carries on.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPick}
      onMouseMove={selected ? undefined : onHover}
      className={`mx-1 flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm ${selected ? 'bg-accent/15' : ''}`}
    >
      {children}
    </li>
  )
}

/** The command typed so far: what it takes, what it does, and quick picks for an amount. */
function Usage({
  command,
  word,
  args,
  prefix,
  balance,
  className,
  onArgs,
}: {
  command: Command
  word: string
  args: string
  prefix: string
  balance: number | undefined
  className: string
  onArgs: (args: string) => void
}) {
  const { spec } = command
  const amount = spec.needs === 'amount' && args ? parseBetAmount(args, BigInt(balance ?? 0)) : null
  const picks = spec.needs === 'amount' ? [spec.example ?? '50', 'half', 'all'] : []
  return (
    <div className={`${className} flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm`}>
      <span className="font-mono text-[0.82rem] font-semibold text-text">
        {prefix}
        {word}
        {spec.args && <span className="font-normal text-faint"> {spec.args}</span>}
      </span>
      <span className="min-w-0 flex-1 text-muted">{spec.description}</span>
      {amount?.ok && amount.keyword && balance !== undefined && (
        <span className="text-xs text-faint tabular-nums">= {formatChips(amount.amount)}</span>
      )}
      {picks.length > 0 && (
        <span className="flex gap-1">
          {picks.map((pick) => (
            <button
              key={pick}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onArgs(pick)}
              className={`rounded-full border px-2 py-0.5 font-mono text-xs ${args === pick ? 'border-accent text-accent' : 'border-border text-muted hover:border-border-strong hover:text-text'}`}
            >
              {pick}
            </button>
          ))}
        </span>
      )}
    </div>
  )
}
