/**
 * Seasons (spec: Admin panel > Seasons: create, schedule, end early): every
 * season with its dates in the game's time zone, scheduling the next one,
 * changing one before it starts, renaming, and ending the running one early,
 * now or at a sooner time. Ending early shows the chat post first and cannot
 * be undone.
 */
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'

import { chipCount, formatChips } from '../../../shared/chips.ts'
import { centralWhen, seasonEndPostText, REASON_MAX } from '../../../shared/features/admin.ts'
import { nextReset } from '../../../shared/game-day.ts'
import type { SeasonPhase, SeasonView } from '../../../shared/seasons.ts'
import { api, errorMessage, requestKey } from '../../kit/api.ts'
import { Button } from '../../kit/Button.tsx'
import { serverNow, useNow } from '../../kit/clock.ts'
import { queryKeys, useConfig, useMe } from '../../kit/queries.ts'
import { toast } from '../../kit/toast.tsx'
import { hundredthsText, parseHundredths } from './config-edit.ts'
import { adminKeys, useSeasons } from './data.ts'
import { AlertIcon } from './icons.tsx'
import {
  Badge,
  Card,
  ChatPreview,
  dangerButton,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  inputClass,
  localInput,
  Note,
  Segmented,
  SkeletonRows,
  SuffixInput,
} from './ui.tsx'

const PHASE: Record<
  SeasonPhase,
  { label: string; tone: 'gold' | 'online' | 'neutral' | 'accent' }
> = {
  upcoming: { label: 'Scheduled', tone: 'accent' },
  open: { label: 'Running', tone: 'online' },
  final_day: { label: 'Final day', tone: 'gold' },
  over: { label: 'Over', tone: 'neutral' },
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** A datetime-local value as a Date, or null when it is empty or not a time. */
function fromLocal(value: string): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function useRefreshSeasons() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.seasons })
    void queryClient.invalidateQueries({ queryKey: queryKeys.season })
  }
}

function EndDialog({
  open,
  season,
  onClose,
}: {
  open: boolean
  season: SeasonView
  onClose: () => void
}) {
  const me = useMe()
  const config = useConfig().data
  const refresh = useRefreshSeasons()
  const now = useNow(15_000)
  const end = new Date(season.endsAt)
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [at, setAt] = useState(() =>
    localInput(new Date(Math.min(end.getTime() - HOUR, serverNow() + DAY))),
  )
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(requestKey)

  const picked = when === 'later' ? fromLocal(at) : null
  const atError =
    when !== 'later'
      ? null
      : !picked
        ? 'Pick the new end time.'
        : picked >= end
          ? `Pick a time before its current end, ${centralWhen(end)}.`
          : picked <= now
            ? 'That time has passed. To end it now, choose End now.'
            : null
  const freezeHours = config?.final_freeze_hours ?? 24
  const intoFinalDay = picked && !atError && picked.getTime() - now.getTime() <= freezeHours * HOUR
  const cleanReason = reason.trim()
  const ready = !atError && cleanReason.length <= REASON_MAX
  const post = seasonEndPostText({
    admin: me.displayName,
    season: season.name,
    endsAt: when === 'later' && picked && !atError ? picked : null,
    reason: cleanReason || null,
  })

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready) return
    setBusy(true)
    try {
      await api.post(
        `/api/admin/seasons/${season.id}/end`,
        {
          ...(when === 'later' && picked ? { at: picked.toISOString() } : {}),
          reason: cleanReason || undefined,
        },
        { key },
      )
      setKey(requestKey())
      refresh()
      toast.good(
        when === 'now'
          ? `${season.name} is over. The podium goes up once open rounds finish.`
          : `${season.name} now ends ${centralWhen(picked as Date)}.`,
      )
      onClose()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`End ${season.name} early`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            className={dangerButton}
            type="submit"
            form="admin-end-season"
            disabled={!ready || busy}
          >
            {busy ? 'Saving…' : when === 'now' ? `End ${season.name} now` : 'Move the end'}
          </Button>
        </>
      }
    >
      <form id="admin-end-season" onSubmit={(e) => void submit(e)} className="space-y-4">
        <Segmented
          label="When it ends"
          value={when}
          onChange={setWhen}
          options={[
            { value: 'now', label: 'End now' },
            { value: 'later', label: 'At a sooner time' },
          ]}
        />
        {when === 'later' && (
          <Field
            label="New end"
            error={atError}
            hint={
              picked
                ? `${centralWhen(picked)}. It was ${centralWhen(end)}.`
                : `Before ${centralWhen(end)}.`
            }
          >
            {(id, describedBy) => (
              <input
                id={id}
                type="datetime-local"
                aria-describedby={describedBy}
                aria-invalid={atError ? true : undefined}
                className={inputClass}
                value={at}
                onChange={(e) => setAt(e.target.value)}
              />
            )}
          </Field>
        )}
        {intoFinalDay && (
          <Note tone="gold">
            That is less than {freezeHours} hours away, so the final day starts at once: steals,
            shields, vault moves and rank purchases stop.
          </Note>
        )}
        <Field label="Reason" hint="Optional. Shown in chat and on the Audit page.">
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              className={inputClass}
              maxLength={REASON_MAX}
              placeholder="Starting the new rules sooner"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        <ChatPreview body={post} />
        <Note tone="loss" icon={<AlertIcon className="size-4 text-loss" />}>
          This cannot be undone. From the end, no game takes a new bet. Rounds already open play
          out, then the standings freeze and the podium goes up.
        </Note>
      </form>
    </Dialog>
  )
}

function EditDialog({
  open,
  season,
  onClose,
}: {
  open: boolean
  season: SeasonView
  onClose: () => void
}) {
  const refresh = useRefreshSeasons()
  const upcoming = season.phase === 'upcoming'
  const [name, setName] = useState(season.name)
  const [startsAt, setStartsAt] = useState(localInput(new Date(season.startsAt)))
  const [endsAt, setEndsAt] = useState(localInput(new Date(season.endsAt)))
  const [balance, setBalance] = useState(hundredthsText(season.startingBalance))
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(requestKey)

  const start = fromLocal(startsAt)
  const end = fromLocal(endsAt)
  const chips = parseHundredths(balance)
  const nameError = name.trim() ? null : 'Name the season.'
  const dateError = !upcoming
    ? null
    : !start || !end
      ? 'Pick both times.'
      : end <= start
        ? 'It must end after it starts.'
        : null
  const balanceError =
    !upcoming || (chips !== null && chips > 0) ? null : 'Type the starting chips, such as 100.'

  const body: Record<string, unknown> = {}
  if (name.trim() !== season.name) body.name = name.trim()
  if (upcoming && start && start.getTime() !== new Date(season.startsAt).getTime())
    body.startsAt = start.toISOString()
  if (upcoming && end && end.getTime() !== new Date(season.endsAt).getTime())
    body.endsAt = end.toISOString()
  if (upcoming && chips !== null && chips !== season.startingBalance) body.startingBalance = chips
  const ready = !nameError && !dateError && !balanceError && Object.keys(body).length > 0

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready) return
    setBusy(true)
    try {
      await api.patch(`/api/admin/seasons/${season.id}`, body, { key })
      setKey(requestKey())
      refresh()
      toast.good(`Saved ${body.name ? String(body.name) : season.name}.`)
      onClose()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={upcoming ? `Change ${season.name}` : `Rename ${season.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="admin-edit-season"
            disabled={!ready || busy}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="admin-edit-season" onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label="Name" error={nameError}>
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              className={inputClass}
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        {upcoming ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts" hint={start ? centralWhen(start) : undefined}>
                {(id, describedBy) => (
                  <input
                    id={id}
                    type="datetime-local"
                    aria-describedby={describedBy}
                    className={inputClass}
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Ends" error={dateError} hint={end ? centralWhen(end) : undefined}>
                {(id, describedBy) => (
                  <input
                    id={id}
                    type="datetime-local"
                    aria-describedby={describedBy}
                    aria-invalid={dateError ? true : undefined}
                    className={inputClass}
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field
              label="Starting chips"
              error={balanceError}
              hint="What each player gets when it starts."
            >
              {(id, describedBy) => (
                <SuffixInput
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="decimal"
                  suffix="chips"
                  value={balance}
                  onChange={(e) => setBalance(e.target.value)}
                />
              )}
            </Field>
          </>
        ) : (
          <p className="text-sm text-muted">
            {season.name} has started, so only its name can change. To finish it sooner, end it
            early.
          </p>
        )}
      </form>
    </Dialog>
  )
}

/**
 * Where a new season fits by default: the next daily reset, or the moment
 * the last season ends when that is later, since seasons cannot overlap.
 */
function nextFree(seasons: SeasonView[]): { at: Date; after: SeasonView | null } {
  const reset = nextReset(new Date(serverNow()))
  const last = seasons.reduce<SeasonView | null>(
    (latest, s) => (!latest || new Date(s.endsAt) > new Date(latest.endsAt) ? s : latest),
    null,
  )
  return last && new Date(last.endsAt) > reset
    ? { at: new Date(last.endsAt), after: last }
    : { at: reset, after: null }
}

function ScheduleCard({ seasons }: { seasons: SeasonView[] }) {
  const config = useConfig().data
  const refresh = useRefreshSeasons()
  const [free] = useState(() => nextFree(seasons))
  const [name, setName] = useState('')
  const [startsAt, setStartsAt] = useState(() => localInput(free.at))
  const [days, setDays] = useState('30')
  const [balance, setBalance] = useState('')
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(requestKey)

  const start = fromLocal(startsAt)
  const length = Number(days)
  const end =
    start && Number.isInteger(length) && length > 0
      ? new Date(start.getTime() + length * DAY)
      : null
  const chips = balance.trim() ? parseHundredths(balance) : null
  const balanceError =
    balance.trim() && !(chips && chips > 0) ? 'Type the starting chips, such as 100.' : null
  const ready = !!name.trim() && !!start && !!end && length <= 366 && !balanceError
  const suggestion = `Season ${seasons.length + 1}`

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || !start || !end) return
    setBusy(true)
    try {
      await api.post(
        '/api/seasons',
        {
          name: name.trim(),
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          ...(chips ? { startingBalance: chips } : {}),
        },
        { key },
      )
      setKey(requestKey())
      refresh()
      toast.good(`${name.trim()} is scheduled for ${centralWhen(start)}.`)
      setName('')
      // The next one fits right after this one.
      setStartsAt(localInput(end))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Schedule a season">
      <form onSubmit={(e) => void submit(e)} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          {(id) => (
            <input
              id={id}
              className={inputClass}
              maxLength={40}
              placeholder={suggestion}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Starts"
          hint={
            start
              ? start.getTime() !== free.at.getTime()
                ? `${centralWhen(start)}.`
                : free.after
                  ? `${centralWhen(start)}, as ${free.after.name} ends.`
                  : `${centralWhen(start)}, the next daily reset.`
              : undefined
          }
        >
          {(id, describedBy) => (
            <input
              id={id}
              type="datetime-local"
              aria-describedby={describedBy}
              className={inputClass}
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          )}
        </Field>
        <Field label="Length" hint={end ? `Ends ${centralWhen(end)}.` : 'In days.'}>
          {(id, describedBy) => (
            <SuffixInput
              id={id}
              aria-describedby={describedBy}
              inputMode="numeric"
              suffix="days"
              value={days}
              onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
            />
          )}
        </Field>
        <Field
          label="Starting chips"
          className="sm:col-span-2"
          error={balanceError}
          hint={
            config
              ? `Leave it empty to use the setting, ${chipCount(config.starting_balance)}.`
              : 'Leave it empty to use the setting.'
          }
        >
          {(id, describedBy) => (
            <SuffixInput
              id={id}
              aria-describedby={describedBy}
              inputMode="decimal"
              suffix="chips"
              placeholder={config ? formatChips(config.starting_balance) : ''}
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <Button variant="primary" type="submit" disabled={!ready || busy}>
            {busy ? 'Scheduling…' : 'Schedule it'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function SeasonRow({
  season,
  act,
}: {
  season: SeasonView
  act: (kind: 'end' | 'edit', season: SeasonView) => void
}) {
  const phase = PHASE[season.phase]
  const running = season.phase === 'open' || season.phase === 'final_day'
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3.5">
      <div className="min-w-0 flex-1 basis-60">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{season.name}</span>
          <Badge tone={phase.tone}>{phase.label}</Badge>
        </p>
        <p className="mt-0.5 text-sm text-muted">
          <span className="whitespace-nowrap">{centralWhen(new Date(season.startsAt))}</span> to{' '}
          <span className="whitespace-nowrap">{centralWhen(new Date(season.endsAt))}</span>
        </p>
        <p className="text-xs text-faint">{chipCount(season.startingBalance)} each to start</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => act('edit', season)}>
          {season.phase === 'upcoming' ? 'Change' : 'Rename'}
        </Button>
        {running && (
          <Button
            size="sm"
            variant="secondary"
            className={dangerButton}
            onClick={() => act('end', season)}
          >
            End early
          </Button>
        )}
      </div>
    </li>
  )
}

export default function SeasonsTab() {
  const seasons = useSeasons()
  const [action, setAction] = useState<{ kind: 'end' | 'edit'; season: SeasonView } | null>(null)
  const [open, setOpen] = useState(false)
  const [round, setRound] = useState(0)
  const act = (kind: 'end' | 'edit', season: SeasonView) => {
    setAction({ kind, season })
    setRound((n) => n + 1)
    setOpen(true)
  }

  const list = seasons.data ?? []
  return (
    <div className="space-y-5">
      {seasons.isPending && <SkeletonRows count={3} height="h-16" />}
      {seasons.isError && (
        <ErrorState
          message={`The seasons did not load. ${errorMessage(seasons.error)}`}
          retry={() => void seasons.refetch()}
        />
      )}
      {seasons.isSuccess && list.length === 0 && (
        <EmptyState title="No seasons yet">Schedule the first one below.</EmptyState>
      )}
      {list.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface-1 px-4 shadow-card">
          {list.map((season) => (
            <SeasonRow key={season.id} season={season} act={act} />
          ))}
        </ul>
      )}
      {seasons.isSuccess && <ScheduleCard seasons={list} />}

      {action?.kind === 'end' && (
        <EndDialog key={round} open={open} season={action.season} onClose={() => setOpen(false)} />
      )}
      {action?.kind === 'edit' && (
        <EditDialog key={round} open={open} season={action.season} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}
