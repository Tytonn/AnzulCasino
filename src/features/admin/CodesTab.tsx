/**
 * Invite and reset codes (spec: Admin panel > Invite codes: create, see
 * which are used and by whom). The foundation makes and lists them; reset
 * codes are made from a player's row on the Players tab too.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import type { InviteCodeView } from '../../../shared/accounts.ts'
import { api, errorMessage } from '../../kit/api.ts'
import { Button } from '../../kit/Button.tsx'
import { useNow } from '../../kit/clock.ts'
import { CopyIcon, PlusIcon } from '../../kit/icons.tsx'
import { toast } from '../../kit/toast.tsx'
import { adminKeys, useInvites } from './data.ts'
import { Badge, Card, EmptyState, ErrorState, Segmented, SkeletonRows, timeAgo } from './ui.tsx'

type Show = 'open' | 'used' | 'all'

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.good(`${what} copied.`)
  } catch {
    toast.error('Could not copy it. Select the code and copy it yourself.')
  }
}

/** A message to paste to a friend: where to sign up, and the code. */
function inviteMessage(code: string): string {
  return `You’re invited to Anzul Casino. Sign up at ${window.location.origin}/signup with the invite code ${code}.`
}

function CodeRow({ code, now }: { code: InviteCodeView; now: Date }) {
  const used = code.usedBy !== null
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <code
        className={`font-mono text-base font-semibold tracking-wider ${used ? 'text-faint line-through' : 'text-text'}`}
      >
        {code.code}
      </code>
      {code.kind === 'reset' ? (
        <Badge tone="gold">Reset for {code.forUsername}</Badge>
      ) : (
        <Badge>Invite</Badge>
      )}
      <span className="min-w-0 flex-1 basis-40 text-sm text-muted">
        {used
          ? `Used by ${code.usedBy}${code.usedAt ? ` ${timeAgo(new Date(code.usedAt), now)}` : ''}`
          : `Made ${timeAgo(new Date(code.createdAt), now)}`}
      </span>
      {!used && (
        <span className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => void copy(code.code, 'Code')}>
            <CopyIcon className="size-4" />
            Code
          </Button>
          {code.kind === 'invite' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void copy(inviteMessage(code.code), 'Invite message')}
            >
              <CopyIcon className="size-4" />
              Message
            </Button>
          )}
        </span>
      )}
    </li>
  )
}

export default function CodesTab() {
  const queryClient = useQueryClient()
  const codes = useInvites()
  const now = useNow(60_000)
  const [show, setShow] = useState<Show>('open')
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<InviteCodeView | null>(null)

  async function create() {
    setBusy(true)
    try {
      const { code } = await api.post<{ code: InviteCodeView }>('/api/invites', { kind: 'invite' })
      setMade(code)
      queryClient.setQueryData<InviteCodeView[]>(adminKeys.invites, (old) =>
        old ? [code, ...old] : old,
      )
      void queryClient.invalidateQueries({ queryKey: adminKeys.invites })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const all = codes.data ?? []
  const shown = all.filter((c) =>
    show === 'all' ? true : show === 'used' ? c.usedBy !== null : c.usedBy === null,
  )
  const open = all.filter((c) => c.usedBy === null).length

  return (
    <div className="space-y-5">
      <Card
        title="Invite a friend"
        actions={
          <Button variant="primary" disabled={busy} onClick={() => void create()}>
            <PlusIcon className="size-4" />
            {busy ? 'Making it…' : 'New invite code'}
          </Button>
        }
      >
        <p className="text-sm text-muted">
          Each code signs up one player. Copy the invite message, with the signup link and the code,
          and send it to them.
        </p>
        {made && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-accent/40 bg-accent/10 p-3">
            <code className="basis-full font-mono text-lg font-semibold tracking-wider whitespace-nowrap sm:flex-1 sm:basis-auto">
              {made.code}
            </code>
            <Button size="sm" onClick={() => void copy(inviteMessage(made.code), 'Invite message')}>
              <CopyIcon className="size-4" />
              Copy invite message
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void copy(made.code, 'Code')}>
              Copy code
            </Button>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Codes</h2>
        <Segmented
          size="sm"
          label="Which codes"
          value={show}
          onChange={setShow}
          options={[
            { value: 'open', label: `Not used (${open})` },
            { value: 'used', label: 'Used' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>

      {codes.isPending && <SkeletonRows count={4} height="h-12" />}
      {codes.isError && (
        <ErrorState
          message={`The codes did not load. ${errorMessage(codes.error)}`}
          retry={() => void codes.refetch()}
        />
      )}
      {codes.isSuccess && shown.length === 0 && (
        <EmptyState title={show === 'used' ? 'No code has been used yet' : 'No codes waiting'}>
          {show === 'used' ? undefined : 'Make an invite code above.'}
        </EmptyState>
      )}
      {shown.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface-1 px-4 shadow-card">
          {shown.map((code) => (
            <CodeRow key={code.code} code={code} now={now} />
          ))}
        </ul>
      )}
    </div>
  )
}
