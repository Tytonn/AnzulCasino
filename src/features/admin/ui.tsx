/**
 * The admin pages' small pieces: cards, fields, inputs, a segmented switch,
 * badges, dialogs, the chat-post preview, and the loading, empty and error
 * states. Theme tokens only, and nothing fixed to the viewport except the
 * kit's own dialog, so each page stands alone in the classic shell and in
 * the chat shell's panel.
 */
import { type InputHTMLAttributes, type ReactNode, useId } from 'react'

import type { AuditPerson } from '../../../shared/features/admin.ts'
import { Button } from '../../kit/Button.tsx'
import { Avatar } from '../../kit/PlayerName.tsx'
import { Sheet } from '../../kit/Sheet.tsx'

/**
 * Classes that make a secondary button read as a destructive one. They are
 * marked important, since the button's own colors would otherwise win.
 */
export const dangerButton =
  'border-loss/50! text-loss! hover:border-loss! hover:bg-loss/10! disabled:hover:border-loss/50! disabled:hover:bg-surface-2!'

/** The same for a ghost button: red words, a red tint on hover. */
export const dangerGhost = 'text-loss! hover:bg-loss/10!'

export const inputClass =
  'h-10 w-full min-w-0 rounded-md border border-border bg-surface-2 px-3 text-sm text-text placeholder:text-faint transition-colors hover:border-border-strong focus:border-accent focus:outline-none disabled:opacity-50 aria-invalid:border-loss'

export function Card({
  title,
  actions,
  children,
  className = '',
  id,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}) {
  const headingId = useId()
  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className={`rounded-lg border border-border bg-surface-1 p-4 shadow-card sm:p-5 ${className}`}
    >
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && (
            <h2 id={headingId} className="text-base font-semibold">
              {title}
            </h2>
          )}
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

/** A labelled control with a hint below it, or the error in its place. */
export function Field({
  label,
  hint,
  error,
  children,
  className = '',
}: {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  children: (id: string, describedBy: string | undefined) => ReactNode
  className?: string
}) {
  const id = useId()
  const noteId = `${id}-note`
  const note = error || hint
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children(id, note ? noteId : undefined)}
      {note && (
        <p
          id={noteId}
          role={error ? 'alert' : undefined}
          className={`mt-1.5 text-xs ${error ? 'text-loss' : 'text-faint'}`}
        >
          {note}
        </p>
      )}
    </div>
  )
}

/** A text input with a unit after it, such as "chips" or "%". */
export function SuffixInput({
  suffix,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { suffix?: string }) {
  return (
    <div className={`relative ${className}`}>
      <input
        {...props}
        className={`${inputClass} tabular-nums ${suffix ? (suffix.length > 2 ? 'pr-20' : 'pr-9') : ''}`}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-faint">
          {suffix}
        </span>
      )}
    </div>
  )
}

/** A few options, one chosen: a row of buttons that acts as one radio group. */
export function Segmented<V extends string>({
  label,
  options,
  value,
  onChange,
  size = 'md',
  className = '',
}: {
  label: string
  options: readonly { value: V; label: ReactNode }[]
  value: V
  onChange: (value: V) => void
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`inline-flex max-w-full flex-wrap gap-1 rounded-md border border-border bg-surface-2 p-1 ${className}`}
    >
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={`rounded-sm px-3 font-medium transition duration-150 ${
              size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm'
            } ${
              on
                ? 'bg-accent text-on-accent shadow-card'
                : 'text-muted hover:bg-surface-3 hover:text-text'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

type Tone = 'neutral' | 'accent' | 'gold' | 'loss' | 'online'

const TONES: Record<Tone, string> = {
  neutral: 'border-border bg-surface-3 text-muted',
  accent: 'border-accent/40 bg-accent/15 text-accent-strong',
  gold: 'border-gold/40 bg-gold/10 text-gold',
  loss: 'border-loss/40 bg-loss/10 text-loss',
  online: 'border-online/40 bg-online/10 text-online',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[0.7rem] font-semibold whitespace-nowrap ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}

/** A centered dialog with its own scrolling body and a row of buttons at the bottom. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} placement="center">
      <div className="scroll-quiet min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        {children}
      </div>
      {footer && (
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-surface-1 px-4 py-3">
          {footer}
        </footer>
      )}
    </Sheet>
  )
}

/** How a post will look in chat, so the admin sees what everyone will read. */
export function ChatPreview({ body, label = 'Posts in chat' }: { body: string; label?: string }) {
  return (
    <figure className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
      <figcaption className="mb-1 text-[0.7rem] font-semibold tracking-wide text-faint uppercase">
        {label}
      </figcaption>
      <p className="text-sm break-words text-text">{body}</p>
    </figure>
  )
}

/** A short note in a tinted box. */
export function Note({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: 'neutral' | 'gold' | 'loss'
  icon?: ReactNode
  children: ReactNode
}) {
  const box =
    tone === 'gold'
      ? 'border-gold/40 bg-gold/10'
      : tone === 'loss'
        ? 'border-loss/40 bg-loss/10'
        : 'border-border bg-surface-2'
  return (
    <div className={`flex gap-2.5 rounded-md border px-3 py-2.5 text-sm ${box}`}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function SkeletonRows({ count = 4, height = 'h-12' }: { count?: number; height?: string }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`skeleton ${height}`} />
      ))}
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{children}</p>}
    </div>
  )
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-loss/40 bg-loss/10 px-4 py-3 text-sm"
    >
      <span>{message}</span>
      {retry && (
        <Button size="sm" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  )
}

/** A player as the audit log and the admin panel name them, with their avatar. */
export function Person({
  person,
  size = 'xs',
}: {
  person: AuditPerson | null | undefined
  size?: 'xs' | 'sm'
}) {
  if (!person) return <span className="font-semibold text-faint">Someone</span>
  return (
    <span className="inline-flex max-w-full items-baseline gap-1 align-bottom">
      <Avatar player={person} size={size} className="self-center" />
      <span className="truncate font-semibold text-text">{person.displayName}</span>
    </span>
  )
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** "just now", "5 minutes ago", "yesterday", "3 days ago". */
export function timeAgo(at: Date, now: Date): string {
  const seconds = Math.round((at.getTime() - now.getTime()) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) return 'just now'
  if (abs < 3_600) return relative.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return relative.format(Math.round(seconds / 3_600), 'hour')
  if (abs < 30 * 86_400) return relative.format(Math.round(seconds / 86_400), 'day')
  return relative.format(Math.round(seconds / (30 * 86_400)), 'month')
}

/** A Date as the value of a datetime-local input, in this browser's time zone. */
export function localInput(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

export const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
