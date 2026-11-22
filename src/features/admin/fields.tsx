/**
 * The settings editor's inputs, one per unit (shared/config.ts): numbers
 * with their unit beside them, a short name, a list of lines, a choice of a
 * few options, and a command's words as chips with the prefix in front.
 */
import { type KeyboardEvent, useState } from 'react'

import { type ConfigKey, setting } from '../../../shared/config.ts'
import { CloseIcon, StarIcon } from '../../kit/icons.tsx'
import { type Draft, draftLines, formatWire, unitSuffix } from './config-edit.ts'
import { inputClass, Segmented, SuffixInput } from './ui.tsx'

export interface InputProps {
  settingKey: ConfigKey
  id: string
  labelId: string
  describedBy?: string
  invalid: boolean
  draft: Draft
  onDraft: (draft: Draft) => void
  /** The command prefix as it will be, for the words chips. */
  prefix: string
}

function NumberInput({ settingKey, id, describedBy, invalid, draft, onDraft }: InputProps) {
  const { unit } = setting(settingKey)
  return (
    <SuffixInput
      id={id}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      inputMode={unit === 'chips' || unit === 'share' ? 'decimal' : 'numeric'}
      autoComplete="off"
      suffix={unitSuffix(settingKey)}
      value={typeof draft === 'string' ? draft : ''}
      onChange={(e) => onDraft(e.target.value)}
      className="w-full sm:w-48"
    />
  )
}

function TextInput({ settingKey, id, describedBy, invalid, draft, onDraft }: InputProps) {
  const s = setting(settingKey)
  const symbols = s.unit === 'text' && s.symbolsOnly
  return (
    <div className={symbols ? 'w-24' : 'w-full sm:w-64'}>
      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        spellCheck={!symbols}
        maxLength={s.unit === 'text' ? s.maxLength + 10 : undefined}
        value={typeof draft === 'string' ? draft : ''}
        onChange={(e) => onDraft(e.target.value)}
        className={`${inputClass} ${symbols ? 'text-center font-mono text-lg' : ''}`}
      />
    </div>
  )
}

function LinesInput({ settingKey, id, describedBy, invalid, draft, onDraft }: InputProps) {
  const s = setting(settingKey)
  const text = typeof draft === 'string' ? draft : ''
  const count = draftLines(text).length
  const max = s.unit === 'lines' ? s : null
  return (
    <div>
      <textarea
        id={id}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        spellCheck
        rows={Math.min(14, Math.max(4, text.split('\n').length + 1))}
        value={text}
        onChange={(e) => onDraft(e.target.value)}
        className={`${inputClass} scroll-quiet h-auto resize-y py-2 leading-6`}
      />
      <p className="mt-1 text-xs text-faint tabular-nums">
        {count === 1 ? '1 line' : `${count} lines`}
        {max ? `, one per row. Up to ${max.maxLines} lines of ${max.maxLength} characters.` : ''}
      </p>
    </div>
  )
}

function ChoiceInput({ settingKey, labelId, draft, onDraft }: InputProps) {
  const s = setting(settingKey)
  if (s.unit !== 'choice') return null
  return (
    <div aria-labelledby={labelId}>
      <Segmented
        label={s.description}
        value={typeof draft === 'string' ? draft : s.default}
        onChange={(value) => onDraft(value)}
        options={s.options.map((o) => ({ value: o.value, label: o.label }))}
      />
    </div>
  )
}

/** A word as the command box will take it: trimmed and lowercase. */
function clean(word: string): string {
  return word.trim().toLowerCase()
}

function WordsInput({ settingKey, id, describedBy, invalid, draft, onDraft, prefix }: InputProps) {
  const s = setting(settingKey)
  const words = Array.isArray(draft) ? draft : []
  const [typed, setTyped] = useState('')
  const max = s.unit === 'words' ? s.maxWords : 8
  const full = words.length >= max

  function add(raw: string) {
    const word = clean(raw)
    if (!word) return
    if (!words.includes(word) && !full) onDraft([...words, word])
    setTyped('')
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || event.key === ' ') {
      event.preventDefault()
      add(typed)
    } else if (event.key === 'Backspace' && !typed && words.length > 1) {
      onDraft(words.slice(0, -1))
    }
  }

  return (
    <div
      className={`flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border bg-surface-2 p-1.5 transition-colors focus-within:border-accent ${
        invalid ? 'border-loss' : 'border-border hover:border-border-strong'
      }`}
    >
      {words.map((word, i) => {
        const name = i === 0
        return (
          <span
            key={`${word}-${i}`}
            className={`inline-flex h-7 items-center gap-0.5 rounded-sm border pl-2 text-sm font-medium ${
              name
                ? 'border-accent/50 bg-accent/15 text-text'
                : 'border-border bg-surface-3 text-muted'
            }`}
          >
            {name ? (
              <span className="flex items-center gap-1" title="The command’s name in the list">
                <StarIcon className="size-3 text-accent-strong" />
                <span className="font-mono">
                  {prefix}
                  {word}
                </span>
              </span>
            ) : (
              <button
                type="button"
                className="font-mono hover:text-text"
                title="Make this the command’s name"
                aria-label={`Make ${prefix}${word} the name`}
                onClick={() => onDraft([word, ...words.filter((_, j) => j !== i)])}
              >
                {prefix}
                {word}
              </button>
            )}
            <button
              type="button"
              aria-label={`Remove ${prefix}${word}`}
              disabled={words.length === 1}
              onClick={() => onDraft(words.filter((_, j) => j !== i))}
              className="grid size-6 place-items-center rounded-sm text-faint hover:text-text disabled:opacity-30"
            >
              <CloseIcon className="size-3.5" />
            </button>
          </span>
        )
      })}
      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        disabled={full}
        placeholder={full ? `${max} words at most` : words.length ? 'Add an alias' : 'Add a word'}
        value={typed}
        onChange={(e) => setTyped(e.target.value.replace(/[\s,]/g, ''))}
        onKeyDown={onKey}
        onBlur={() => add(typed)}
        className="h-7 min-w-28 flex-1 bg-transparent px-1.5 font-mono text-sm text-text placeholder:font-sans placeholder:text-faint focus:outline-none disabled:opacity-60"
      />
    </div>
  )
}

/** The input for a setting, by its unit. */
export function SettingInput(props: InputProps) {
  const { unit } = setting(props.settingKey)
  if (unit === 'words') return <WordsInput {...props} />
  if (unit === 'lines') return <LinesInput {...props} />
  if (unit === 'choice') return <ChoiceInput {...props} />
  if (unit === 'text') return <TextInput {...props} />
  return <NumberInput {...props} />
}

/** Units drawn across the row's full width, under the name. */
export function wideInput(key: ConfigKey): boolean {
  const { unit } = setting(key)
  return unit === 'lines' || unit === 'words'
}

/**
 * A setting's value in a line of text, such as its default: a command's
 * words with the prefix in front, and the prefix itself, in code type.
 */
export function ShownValue({
  settingKey,
  wire,
  prefix,
}: {
  settingKey: ConfigKey
  wire: unknown
  prefix: string
}) {
  const s = setting(settingKey)
  if (s.unit === 'words' && Array.isArray(wire)) {
    return (
      <span className="inline-flex flex-wrap gap-x-1.5">
        {wire.map((word) => (
          <code key={String(word)} className="font-mono text-muted">
            {prefix}
            {String(word)}
          </code>
        ))}
      </span>
    )
  }
  if (s.unit === 'text' && s.symbolsOnly && typeof wire === 'string') {
    return <code className="font-mono text-sm leading-none text-muted">{wire}</code>
  }
  return <>{formatWire(settingKey, wire)}</>
}
