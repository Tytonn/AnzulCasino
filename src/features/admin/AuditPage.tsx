/**
 * The Audit page (spec: Admin and trust > The audit page): every admin
 * action, newest first, for every player to read, with the setting changes
 * still waiting for the daily reset at the top. New actions arrive live
 * (Live.tsx), and older ones load a page at a time.
 */
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import {
  AUDIT_KIND_LABELS,
  AUDIT_KINDS,
  type AuditEntryView,
  type AuditKind,
  centralWhen,
  type PendingChangeView,
} from '../../../shared/features/admin.ts'
import { Button } from '../../kit/Button.tsx'
import { errorMessage } from '../../kit/api.ts'
import { formatCountdown, useNow } from '../../kit/clock.ts'
import { ChatIcon, ChipIcon, PersonIcon, ScrollIcon } from '../../kit/icons.tsx'
import { useConfig } from '../../kit/queries.ts'
import {
  type Described,
  describeEntry,
  describePending,
  type Part,
  plainText,
} from './audit-text.ts'
import { useAuditLog } from './data.ts'
import { CalendarIcon, GearIcon, GiftIcon, HourglassIcon } from './icons.tsx'
import { Badge, EmptyState, ErrorState, Person, SkeletonRows } from './ui.tsx'

const KIND_ICON: Record<AuditKind, (props: { className?: string }) => ReactNode> = {
  chips: ChipIcon,
  config: GearIcon,
  seasons: CalendarIcon,
  accounts: PersonIcon,
  chat: ChatIcon,
}

const KIND_TINT: Record<AuditKind, string> = {
  chips: 'text-gold bg-gold/10 border-gold/30',
  config: 'text-accent-strong bg-accent/10 border-accent/30',
  seasons: 'text-online bg-online/10 border-online/30',
  accounts: 'text-muted bg-surface-3 border-border',
  chat: 'text-muted bg-surface-3 border-border',
}

const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const full = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' })
const dayName = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/** "Today", "Yesterday", or "Sat, Nov 21", in this browser's time zone. */
export function dayLabel(date: Date, now: Date): string {
  if (dayKey(date) === dayKey(now)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday'
  return dayName.format(date)
}

const POSSESSIVE = '’s'

function Sentence({ parts }: { parts: readonly Part[] }) {
  const nodes: ReactNode[] = []
  parts.forEach((part, i) => {
    const next = parts[i + 1]
    if (typeof part === 'string') {
      // A possessive went with the name before it.
      const prev = parts[i - 1]
      const glued = typeof prev === 'object' && 'person' in prev && part.startsWith(POSSESSIVE)
      const text = glued ? part.slice(POSSESSIVE.length) : part
      if (text) nodes.push(<span key={i}>{text}</span>)
    } else if ('person' in part) {
      const owns = typeof next === 'string' && next.startsWith(POSSESSIVE)
      nodes.push(
        owns ? (
          <span key={i} className="whitespace-nowrap">
            <Person person={part.person} />
            {POSSESSIVE}
          </span>
        ) : (
          <Person key={i} person={part.person} />
        ),
      )
    } else {
      nodes.push(
        <b key={i} className="font-semibold text-text">
          {part.strong}
        </b>,
      )
    }
  })
  return <>{nodes}</>
}

function KindIcon({ kind }: { kind: AuditKind | null }) {
  const Icon = kind ? KIND_ICON[kind] : ScrollIcon
  const tint = kind ? KIND_TINT[kind] : KIND_TINT.chat
  return (
    <span className={`grid size-8 shrink-0 place-items-center rounded-full border ${tint}`}>
      <Icon className="size-4" />
    </span>
  )
}

function waitsUntil(entry: AuditEntryView): Date | null {
  const after = entry.after as { effectiveAt?: unknown } | null
  if (entry.action !== 'config.changed' || typeof after?.effectiveAt !== 'string') return null
  return new Date(after.effectiveAt)
}

function Entry({ entry, now, hustle }: { entry: AuditEntryView; now: Date; hustle?: string }) {
  const said: Described = useMemo(() => describeEntry(entry, hustle), [entry, hustle])
  const at = new Date(entry.at)
  const waits = waitsUntil(entry)
  const giveaway = entry.action.startsWith('giveaway.')
  return (
    <div className="flex gap-3 py-3">
      {giveaway ? (
        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-gold/30 bg-gold/10 text-gold">
          <GiftIcon className="size-4" />
        </span>
      ) : (
        <KindIcon kind={entry.kind} />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-6 break-words text-muted" title={plainText(said.parts)}>
          <Sentence parts={said.parts} />
        </p>
        {entry.reason && <p className="mt-0.5 text-sm break-words text-text">“{entry.reason}”</p>}
        {said.details.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs break-words text-faint">
            {said.details.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
        {waits && waits > now && (
          <p className="mt-1.5">
            <Badge tone="gold">
              Starts at the reset, in {formatCountdown(waits.getTime() - now.getTime())}
            </Badge>
          </p>
        )}
      </div>
      <time
        dateTime={entry.at}
        title={full.format(at)}
        className="shrink-0 pt-0.5 text-xs whitespace-nowrap text-faint"
      >
        {time.format(at)}
      </time>
    </div>
  )
}

function Pending({
  pending,
  nextReset,
  hustle,
}: {
  pending: PendingChangeView[]
  nextReset: string
  hustle?: string
}) {
  const now = useNow(30_000)
  const at = new Date(nextReset)
  return (
    <section
      aria-labelledby="audit-pending"
      className="mb-6 rounded-lg border border-gold/40 bg-gold/5 p-4 shadow-card"
    >
      <h2 id="audit-pending" className="flex items-center gap-2 text-base font-semibold">
        <HourglassIcon className="size-4.5 text-gold" />
        Coming at the next reset
      </h2>
      <p className="mt-1 text-sm text-muted">
        Changes to the economy and steals start at the daily reset, {centralWhen(at)}
        {at > now ? `, in ${formatCountdown(at.getTime() - now.getTime())}` : ''}. They are listed
        here first so nobody is caught out.
      </p>
      <ul className="mt-3 divide-y divide-border/70">
        {pending.map((change) => {
          const shown = describePending(change, hustle)
          return (
            <li key={change.key} className="py-2.5 text-sm">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <b className="font-semibold">{shown.label}</b>
                <span className="text-muted tabular-nums">{shown.change}</span>
              </p>
              <p className="mt-0.5 text-xs text-faint">
                By <Person person={change.by} />
                {change.reason ? ` · “${change.reason}”` : ''}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const FILTERS: readonly (AuditKind | null)[] = [null, ...AUDIT_KINDS]

export default function AuditPage() {
  const [kind, setKind] = useState<AuditKind | null>(null)
  const log = useAuditLog(kind)
  const now = useNow(30_000)
  const hustle = useConfig().data?.hustle_name
  const more = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = log

  // Older entries load as the end of the list comes into view.
  useEffect(() => {
    const target = more.current
    if (!target || !hasNextPage) return
    const observer = new IntersectionObserver((seen) => {
      if (seen.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage()
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const first = log.data?.pages[0]
  const entries = useMemo(() => log.data?.pages.flatMap((p) => p.entries) ?? [], [log.data])
  const days = useMemo(() => {
    const groups: { label: string; entries: AuditEntryView[] }[] = []
    for (const entry of entries) {
      const label = dayLabel(new Date(entry.at), now)
      const last = groups.at(-1)
      if (last?.label === label) last.entries.push(entry)
      else groups.push({ label, entries: [entry] })
    }
    return groups
  }, [entries, now])

  return (
    <section aria-labelledby="audit-title" className="mx-auto w-full max-w-3xl p-4 pb-12 md:p-6">
      <header className="mb-6">
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <ScrollIcon className="size-4" />
          Every admin power is public
        </p>
        <h1 id="audit-title" className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">
          Audit log
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Each time an admin moves chips, changes a setting, ends a season or touches an account, it
          shows up here for everyone. Chip moves also post in chat.
        </p>
      </header>

      {first && first.pending.length > 0 && kind === null && (
        <Pending pending={first.pending} nextReset={first.nextReset} hustle={hustle} />
      )}

      <div role="tablist" aria-label="Show" className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((option) => {
          const on = option === kind
          return (
            <button
              key={option ?? 'all'}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setKind(option)}
              className={`h-8 shrink-0 rounded-full border px-3.5 text-sm font-medium transition duration-150 ${
                on
                  ? 'border-accent bg-accent/15 text-text'
                  : 'border-border text-muted hover:border-border-strong hover:text-text'
              }`}
            >
              {option ? AUDIT_KIND_LABELS[option] : 'Everything'}
            </button>
          )
        })}
      </div>

      {log.isPending && <SkeletonRows count={6} height="h-14" />}
      {log.isError && (
        <ErrorState
          message={`The audit log did not load. ${errorMessage(log.error)}`}
          retry={() => void log.refetch()}
        />
      )}
      {log.isSuccess && entries.length === 0 && (
        <EmptyState
          title={
            kind ? `No ${AUDIT_KIND_LABELS[kind].toLowerCase()} actions yet` : 'Nothing here yet'
          }
        >
          When an admin moves chips, changes a setting or ends a season, it shows up here.
        </EmptyState>
      )}

      {days.map((group) => (
        <section key={group.label} aria-label={group.label} className="mt-4 first:mt-0">
          <h2 className="py-1.5 text-xs font-semibold tracking-wide text-faint uppercase">
            {group.label}
          </h2>
          <ul className="divide-y divide-border/70">
            <AnimatePresence initial={false}>
              {group.entries.map((entry) => (
                <motion.li
                  key={entry.id}
                  layout="position"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <Entry entry={entry} now={now} hustle={hustle} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </section>
      ))}

      {hasNextPage && (
        <div ref={more} className="mt-4 flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage ? 'Loading older actions…' : 'Show older actions'}
          </Button>
        </div>
      )}
      {log.isSuccess && entries.length > 0 && !hasNextPage && (
        <p className="mt-6 text-center text-xs text-faint">
          That is everything, back to the first action.
        </p>
      )}
    </section>
  )
}
