/**
 * Every setting (spec: Admin panel > Config, Work and crime names and lines;
 * the chat shell's commands and stream switches), grouped by what it is
 * about, with its default, who changed it last, and what is waiting for the
 * daily reset. Edits collect into one save, shown in a bar at the bottom,
 * with an optional reason for the Audit page. A refusal shows on its row.
 */
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useCallback, useEffect, useEffectEvent, useId, useMemo, useState } from 'react'
import { useBlocker } from 'react-router'

import {
  COMMAND_KEYS,
  CONFIG,
  CONFIG_KEYS,
  type ConfigKey,
  configDefaults,
  configWireValue,
  isConfigKey,
  setting,
} from '../../../shared/config.ts'
import {
  type AdminConfigState,
  centralWhen,
  type ConfigSaveResponse,
  type LastChangeView,
  type PendingChangeView,
  REASON_MAX,
} from '../../../shared/features/admin.ts'
import { api, ApiError, errorMessage, requestKey } from '../../kit/api.ts'
import { Button } from '../../kit/Button.tsx'
import { formatCountdown, useNow } from '../../kit/clock.ts'
import { Kbd } from '../../kit/Kbd.tsx'
import { queryKeys } from '../../kit/queries.ts'
import { toast } from '../../kit/toast.tsx'
import {
  type Draft,
  friendlyError,
  fromDraft,
  groupWaits,
  sameWire,
  SECTIONS,
  sectionKeys,
  settingDescription,
  settingLabel,
  toDraft,
  wordClash,
} from './config-edit.ts'
import { adminKeys, useAdminConfig } from './data.ts'
import { SettingInput, ShownValue, wideInput } from './fields.tsx'
import { HourglassIcon, SearchIcon, UndoIcon } from './icons.tsx'
import {
  Badge,
  Dialog,
  EmptyState,
  ErrorState,
  inputClass,
  SkeletonRows,
  shortDate,
} from './ui.tsx'

type Drafts = Partial<Record<ConfigKey, Draft>>

interface RowCheck {
  dirty: boolean
  error: string | null
  value?: unknown
}

/** The save shortcut as this computer writes it. */
const SAVE_KEYS =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘S' : 'Ctrl S'

const DEFAULTS: Record<string, unknown> = Object.fromEntries(
  Object.entries(configDefaults()).map(([key, value]) => [key, configWireValue(value)]),
)

const RowView = memo(function RowView({
  settingKey,
  draft,
  baseline,
  current,
  pending,
  changed,
  check,
  hustle,
  prefix,
  onDraft,
  onClear,
}: {
  settingKey: ConfigKey
  draft: Draft
  baseline: unknown
  current: unknown
  pending: PendingChangeView | undefined
  changed: LastChangeView | undefined
  check: RowCheck
  hustle: string
  prefix: string
  onDraft: (key: ConfigKey, draft: Draft) => void
  onClear: (key: ConfigKey) => void
}) {
  const id = useId()
  const label = settingLabel(settingKey, hustle)
  const fallback = DEFAULTS[settingKey]
  const atDefault = sameWire(check.value ?? baseline, fallback)
  const wide = wideInput(settingKey)
  const note = check.error ? `${id}-error` : undefined
  const set = (next: Draft) => onDraft(settingKey, next)

  return (
    <div
      id={`setting-${settingKey}`}
      className={`grid gap-x-6 gap-y-2 py-4 ${wide ? '' : 'sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start'}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <label id={`${id}-label`} htmlFor={id} className="font-semibold">
            {label}
          </label>
          {check.dirty && !check.error && <Badge tone="accent">Unsaved</Badge>}
          {pending && !check.dirty && <Badge tone="gold">Waiting for the reset</Badge>}
        </div>
        <p className="mt-0.5 text-sm text-muted">{settingDescription(settingKey, hustle)}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
          <span className="inline-flex flex-wrap items-baseline gap-x-1">
            Default <ShownValue settingKey={settingKey} wire={fallback} prefix={prefix} />
          </span>
          {pending && (
            <span className="inline-flex flex-wrap items-baseline gap-x-1">
              · In force until the reset:{' '}
              <ShownValue settingKey={settingKey} wire={current} prefix={prefix} />
            </span>
          )}
          {changed && !pending && (
            <span>
              · Changed {changed.by ? `by ${changed.by.displayName} ` : ''}
              {shortDate.format(new Date(changed.at))}
            </span>
          )}
          {check.dirty && (
            <button
              type="button"
              onClick={() => onClear(settingKey)}
              className="inline-flex items-center gap-1 font-medium text-muted hover:text-text"
            >
              <UndoIcon className="size-3.5" />
              Undo
            </button>
          )}
          {!check.dirty && pending && (
            <button
              type="button"
              onClick={() => set(toDraft(settingKey, current))}
              className="font-medium text-muted hover:text-text"
            >
              Take it back
            </button>
          )}
          {!atDefault && (
            <button
              type="button"
              onClick={() => set(toDraft(settingKey, fallback))}
              className="font-medium text-muted hover:text-text"
            >
              Use the default
            </button>
          )}
        </p>
      </div>
      <div className={wide ? '' : 'sm:pt-0.5'}>
        <SettingInput
          settingKey={settingKey}
          id={id}
          labelId={`${id}-label`}
          describedBy={note}
          invalid={!!check.error}
          draft={draft}
          onDraft={set}
          prefix={prefix}
        />
        {check.error && (
          <p id={note} role="alert" className="mt-1.5 max-w-md text-xs text-loss">
            {check.error}
          </p>
        )}
      </div>
    </div>
  )
})

function SectionHeader({
  title,
  blurb,
  waits,
  nextReset,
}: {
  title: string
  blurb: string
  waits: boolean
  nextReset: string
}) {
  const now = useNow(30_000)
  const at = new Date(nextReset)
  return (
    <header className="border-b border-border pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {waits && (
          <Badge tone="gold">
            <HourglassIcon className="mr-1 size-3" />
            Starts at the next reset
          </Badge>
        )}
      </div>
      <p className="mt-0.5 text-sm text-muted">{blurb}</p>
      {waits && (
        <p className="mt-1 text-xs text-faint">
          Changes here wait for the daily reset, {centralWhen(at)}
          {at > now ? `, in ${formatCountdown(at.getTime() - now.getTime())}` : ''}, and show on the
          Audit page until then.
        </p>
      )}
    </header>
  )
}

function matches(key: ConfigKey, query: string, hustle: string): boolean {
  if (!query) return true
  const s = setting(key)
  const haystack = [key, settingLabel(key, hustle), settingDescription(key, hustle)]
  if (s.unit === 'words') haystack.push(...s.default)
  return haystack.some((text) => text.toLowerCase().includes(query))
}

function Editor({ state }: { state: AdminConfigState }) {
  const queryClient = useQueryClient()
  const [drafts, setDrafts] = useState<Drafts>({})
  const [refused, setRefused] = useState<{ key: ConfigKey; message: string } | null>(null)
  const [query, setQuery] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [requestId, setRequestId] = useState(requestKey)

  const pending = useMemo(
    () => new Map(state.pending.map((change) => [change.key, change])),
    [state.pending],
  )
  /** What each key will be once everything scheduled takes effect: what an edit is compared to. */
  const baseline = useCallback(
    (key: ConfigKey) => (pending.has(key) ? pending.get(key)?.value : state.values[key]),
    [pending, state.values],
  )

  const hustleCheck =
    drafts.hustle_name === undefined ? null : fromDraft('hustle_name', drafts.hustle_name)
  const hustle =
    hustleCheck?.ok && typeof hustleCheck.value === 'string'
      ? hustleCheck.value
      : String(baseline('hustle_name') ?? CONFIG.hustle_name.default)
  const prefixCheck =
    drafts.command_prefix === undefined ? null : fromDraft('command_prefix', drafts.command_prefix)
  const prefix =
    prefixCheck?.ok && typeof prefixCheck.value === 'string'
      ? prefixCheck.value
      : String(baseline('command_prefix') ?? '.')

  const checks = useMemo(() => {
    const words: Partial<Record<ConfigKey, readonly string[]>> = {}
    for (const key of COMMAND_KEYS) {
      const draft = drafts[key]
      const shown = Array.isArray(draft) ? draft.map((w) => w.trim().toLowerCase()) : baseline(key)
      words[key] = Array.isArray(shown) ? shown.map(String) : []
    }
    const out = new Map<ConfigKey, RowCheck>()
    for (const key of CONFIG_KEYS) {
      const draft = drafts[key]
      if (draft === undefined) {
        out.set(key, {
          dirty: false,
          error: refused?.key === key ? refused.message : null,
        })
        continue
      }
      const checked = fromDraft(key, draft, hustle)
      let error = checked.ok ? null : checked.error
      if (checked.ok && setting(key).unit === 'words') {
        error = wordClash(key, checked.value as string[], words) ?? null
      }
      if (!error && refused?.key === key) error = refused.message
      const dirty = !checked.ok || !sameWire(checked.value, baseline(key))
      out.set(key, { dirty, error, value: checked.ok ? checked.value : undefined })
    }
    return out
  }, [drafts, baseline, hustle, refused])

  const dirtyKeys = CONFIG_KEYS.filter((key) => checks.get(key)?.dirty)
  const problems = dirtyKeys.filter((key) => checks.get(key)?.error)
  const changes = dirtyKeys
    .filter((key) => !checks.get(key)?.error)
    .map((key) => ({ key, value: checks.get(key)?.value }))

  const onDraft = useCallback((key: ConfigKey, draft: Draft) => {
    setDrafts((old) => ({ ...old, [key]: draft }))
    setRefused((old) => (old?.key === key ? null : old))
  }, [])
  const onClear = useCallback((key: ConfigKey) => {
    setDrafts((old) => {
      const next = { ...old }
      delete next[key]
      return next
    })
    setRefused((old) => (old?.key === key ? null : old))
  }, [])

  function discard() {
    setDrafts({})
    setRefused(null)
  }

  async function save() {
    if (busy || changes.length === 0 || problems.length > 0) return
    setBusy(true)
    try {
      const res = await api.post<ConfigSaveResponse>(
        '/api/admin/config',
        { changes, reason: reason.trim() || undefined },
        { key: requestId },
      )
      queryClient.setQueryData(adminKeys.config, res.state)
      void queryClient.invalidateQueries({ queryKey: queryKeys.config })
      void queryClient.invalidateQueries({ queryKey: adminKeys.audit })
      setDrafts({})
      setRefused(null)
      setReason('')
      setRequestId(requestKey())
      const count = res.saved.length
      const later = res.saved.filter((s) => s.effectiveAt === res.state.nextReset).length
      if (count === 0) toast.info('Nothing changed, so there was nothing to save.')
      else {
        const what = count === 1 ? '1 setting' : `${count} settings`
        const when =
          later === 0
            ? ''
            : later === count
              ? ` ${count === 1 ? 'It starts' : 'They start'} at the next reset.`
              : ` ${later} of them start at the next reset.`
        toast.good(`Saved ${what}.${when}`)
      }
    } catch (error) {
      const key = error instanceof ApiError ? error.extra.key : undefined
      if (typeof key === 'string' && isConfigKey(key)) {
        setRefused({ key, message: friendlyError(key, errorMessage(error), hustle) })
        if (drafts[key] === undefined)
          setDrafts((old) => ({ ...old, [key]: toDraft(key, baseline(key)) }))
        document
          .getElementById(`setting-${key}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else {
        toast.error(errorMessage(error))
      }
    } finally {
      setBusy(false)
    }
  }

  // Cmd or Ctrl and S saves, as in an editor.
  const onSave = useEffectEvent(() => void save())
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        onSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Unsaved edits are not lost by leaving the tab or the page.
  const unsaved = dirtyKeys.length > 0
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      unsaved &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  )
  useEffect(() => {
    if (!unsaved) return
    const onLeave = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [unsaved])

  const q = query.trim().toLowerCase()
  const sections = SECTIONS.map((section) => ({
    ...section,
    keys: sectionKeys(section.group).filter((key) => matches(key, q, hustle)),
  })).filter((section) => section.keys.length > 0)

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <label className="relative block">
          <span className="sr-only">Find a setting</span>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input
            type="search"
            className={`${inputClass} pl-9`}
            placeholder="Find a setting, such as crime or blackjack"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {!q && (
          <nav
            aria-label="Setting groups"
            className="scroll-quiet -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0"
          >
            {SECTIONS.map((section) => (
              <button
                key={section.group}
                type="button"
                onClick={() =>
                  document
                    .getElementById(`settings-${section.group}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
                className="h-8 shrink-0 rounded-full border border-border px-3 text-sm text-muted transition hover:border-border-strong hover:text-text"
              >
                {section.title}
              </button>
            ))}
          </nav>
        )}
      </div>

      {sections.length === 0 && (
        <EmptyState title={`No setting matches “${query.trim()}”`}>
          Try a word from its name or description, such as steal, cooldown or prefix.
        </EmptyState>
      )}

      {sections.map((section) => (
        <section
          key={section.group}
          id={`settings-${section.group}`}
          aria-label={section.title}
          className="scroll-mt-4 rounded-lg border border-border bg-surface-1 px-4 pt-4 shadow-card sm:px-5"
        >
          <SectionHeader
            title={section.title}
            blurb={section.blurb}
            waits={groupWaits(section.group)}
            nextReset={state.nextReset}
          />
          <div className="divide-y divide-border/70">
            {section.keys.map((key) => (
              <RowView
                key={key}
                settingKey={key}
                draft={drafts[key] ?? toDraft(key, baseline(key))}
                baseline={baseline(key)}
                current={state.values[key]}
                pending={pending.get(key)}
                changed={state.changed[key]}
                check={checks.get(key) ?? { dirty: false, error: null }}
                hustle={hustle}
                prefix={prefix}
                onDraft={onDraft}
                onClear={onClear}
              />
            ))}
          </div>
        </section>
      ))}

      <AnimatePresence>
        {unsaved && (
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="sticky bottom-[calc(3.6rem+env(safe-area-inset-bottom)+0.75rem)] z-10 md:bottom-3"
          >
            <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border-strong bg-glass p-3 shadow-pop backdrop-blur">
              <p className="min-w-0 text-sm font-semibold" aria-live="polite">
                {dirtyKeys.length === 1
                  ? '1 unsaved change'
                  : `${dirtyKeys.length} unsaved changes`}
                {problems.length > 0 && (
                  <button
                    type="button"
                    className="ml-1.5 font-medium text-loss underline-offset-2 hover:underline"
                    onClick={() =>
                      document
                        .getElementById(`setting-${problems[0]}`)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }
                  >
                    · {problems.length} to fix
                  </button>
                )}
              </p>
              <input
                aria-label="Why (optional, shown on the Audit page)"
                className={`${inputClass} h-9 flex-1 basis-48`}
                maxLength={REASON_MAX}
                placeholder="Why? Optional, shown on the Audit page"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex gap-2">
                <Button variant="ghost" onClick={discard} disabled={busy}>
                  Discard
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void save()}
                  disabled={busy || problems.length > 0 || changes.length === 0}
                >
                  {busy ? 'Saving…' : 'Save'}
                  <Kbd>{SAVE_KEYS}</Kbd>
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        title="Leave without saving?"
        footer={
          <>
            <Button variant="ghost" onClick={() => blocker.reset?.()}>
              Keep editing
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                discard()
                blocker.proceed?.()
              }}
            >
              Discard and leave
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          {dirtyKeys.length === 1
            ? 'You changed a setting and have not saved it.'
            : `You changed ${dirtyKeys.length} settings and have not saved them.`}
        </p>
      </Dialog>
    </div>
  )
}

export default function SettingsTab() {
  const config = useAdminConfig()
  if (config.isPending) return <SkeletonRows count={6} height="h-20" />
  if (config.isError || !config.data) {
    return (
      <ErrorState
        message={`The settings did not load. ${errorMessage(config.error)}`}
        retry={() => void config.refetch()}
      />
    )
  }
  return <Editor state={config.data} />
}
