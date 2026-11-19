/**
 * A minimal admin page for the first days, before the admin lane's panel:
 * invite codes, reset codes and seasons (spec: Admin panel). Everything it
 * does goes through the same endpoints and audit log as the real panel.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useState } from 'react'

import type { InviteCodeView } from '../../../shared/accounts.ts'
import { chips, formatChips } from '../../../shared/chips.ts'
import { nextReset } from '../../../shared/game-day.ts'
import type { SeasonView } from '../../../shared/seasons.ts'
import { api, errorMessage, requestKey } from '../../kit/api.ts'
import { serverNow } from '../../kit/clock.ts'
import { CopyIcon, PlusIcon } from '../../kit/icons.tsx'
import { queryKeys, useConfig, useMe } from '../../kit/queries.ts'
import { toast } from '../../kit/toast.tsx'
import { useTitle } from '../title.ts'
import { AdminOnly } from './Placeholder.tsx'

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** A Date as the value of a datetime-local input, in this browser's time zone. */
function localInput(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface-1 p-5 shadow-card">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}

const input =
  'h-10 w-full rounded-md border border-border bg-surface-2 px-3 text-sm text-text focus:border-accent focus:outline-none'
const button =
  'inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong active:scale-[0.98] disabled:opacity-50'

function Invites() {
  const queryClient = useQueryClient()
  const codes = useQuery({
    queryKey: ['invites'],
    queryFn: async () => (await api.get<{ codes: InviteCodeView[] }>('/api/invites')).codes,
  })
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)

  async function create(body: { kind: 'invite' } | { kind: 'reset'; username: string }) {
    setBusy(true)
    try {
      const { code } = await api.post<{ code: InviteCodeView }>('/api/invites', body)
      await navigator.clipboard?.writeText(code.code).catch(() => {})
      toast.good(
        code.kind === 'invite'
          ? `Invite code ${code.code} is ready (copied).`
          : `Reset code for ${code.forUsername} is ${code.code} (copied).`,
      )
      setUsername('')
      void queryClient.invalidateQueries({ queryKey: ['invites'] })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Invite and reset codes">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => void create({ kind: 'invite' })}
        >
          <PlusIcon className="size-4" />
          New invite code
        </button>
        <form
          className="flex min-w-64 flex-1 gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            void create({ kind: 'reset', username })
          }}
        >
          <input
            className={`${input} min-w-0 flex-1`}
            placeholder="Their username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-label="Username for a reset code"
          />
          <button
            type="submit"
            className={`${button} shrink-0`}
            disabled={busy || !username.trim()}
          >
            Reset code
          </button>
        </form>
      </div>
      <p className="mt-2 text-xs text-faint">
        Reset codes are written to the public audit log, because they would let an admin into that
        account.
      </p>
      <ul className="mt-4 divide-y divide-border text-sm">
        {codes.isPending && <li className="skeleton h-8" />}
        {codes.data?.length === 0 && <li className="py-2 text-muted">No codes yet.</li>}
        {codes.data?.slice(0, 20).map((code) => (
          <li key={code.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <code
              className={`font-mono font-semibold ${code.usedBy ? 'text-faint line-through' : 'text-text'}`}
            >
              {code.code}
            </code>
            {!code.usedBy && (
              <button
                type="button"
                className="text-faint hover:text-text"
                aria-label={`Copy ${code.code}`}
                onClick={() => void navigator.clipboard?.writeText(code.code)}
              >
                <CopyIcon className="size-4" />
              </button>
            )}
            <span className="text-muted">
              {code.kind === 'reset' ? `reset for ${code.forUsername}` : 'invite'}
            </span>
            <span className="ml-auto text-xs text-faint">
              {code.usedBy
                ? `used by ${code.usedBy}`
                : `made ${when.format(new Date(code.createdAt))}`}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function Seasons() {
  const queryClient = useQueryClient()
  const config = useConfig().data
  const seasons = useQuery({
    queryKey: ['seasons'],
    queryFn: async () => (await api.get<{ seasons: SeasonView[] }>('/api/seasons')).seasons,
  })
  const [name, setName] = useState('')
  const [startsAt, setStartsAt] = useState(() => localInput(nextReset(new Date(serverNow()))))
  const [days, setDays] = useState('30')
  const [balance, setBalance] = useState('')
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(requestKey)

  async function create(event: FormEvent) {
    event.preventDefault()
    const start = new Date(startsAt)
    const length = Number(days)
    if (Number.isNaN(start.getTime()) || !(length > 0)) {
      toast.error('Pick a start time and a length in days.')
      return
    }
    setBusy(true)
    try {
      await api.post(
        '/api/seasons',
        {
          name,
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + length * 86_400_000).toISOString(),
          ...(balance.trim() ? { startingBalance: Number(chips(Number(balance))) } : {}),
        },
        { key },
      )
      toast.good(`${name} is scheduled.`)
      setName('')
      setKey(requestKey())
      void queryClient.invalidateQueries({ queryKey: ['seasons'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.season })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Seasons">
      <form onSubmit={(e) => void create(e)} className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium">Name</span>
          <input
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Season 2"
            required
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Starts</span>
          <input
            className={input}
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            required
          />
          <span className="mt-1 block text-xs text-faint">
            Defaults to the next 4:00 AM Central reset.
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Length in days</span>
          <input
            className={input}
            type="number"
            min="1"
            max="120"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            required
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium">Starting chips</span>
          <input
            className={input}
            type="number"
            min="1"
            step="1"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder={config ? `${formatChips(config.starting_balance)} (the setting)` : ''}
          />
        </label>
        <div className="sm:col-span-2">
          <button type="submit" className={button} disabled={busy || !name.trim()}>
            Schedule the season
          </button>
        </div>
      </form>
      <ul className="mt-5 divide-y divide-border text-sm">
        {seasons.isPending && <li className="skeleton h-8" />}
        {seasons.data?.length === 0 && <li className="py-2 text-muted">No seasons yet.</li>}
        {seasons.data?.map((season) => (
          <li key={season.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
            <span className="font-semibold">{season.name}</span>
            <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-muted">
              {season.phase.replace('_', ' ')}
            </span>
            <span className="ml-auto text-xs text-muted">
              {when.format(new Date(season.startsAt))} to {when.format(new Date(season.endsAt))} ·{' '}
              {formatChips(season.startingBalance)} chips each
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

export function SetupPage() {
  const me = useMe()
  useTitle('Setup')
  if (me.role !== 'admin') return <AdminOnly />
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-4 md:p-8">
      <header>
        <h1 className="text-2xl font-bold">Setup</h1>
        <p className="mt-1 text-sm text-muted">
          Invite codes and seasons, until the full admin panel opens.
        </p>
      </header>
      <Invites />
      <Seasons />
    </div>
  )
}
