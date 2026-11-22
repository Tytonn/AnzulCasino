/**
 * Players (spec: Admin panel > Players and Chips): every account with its
 * chips this season and when it was last here, a manual chip adjustment
 * with a required reason, a password reset code, and disabling or enabling
 * an account. Each dialog shows what the chat post will say first.
 */
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'

import type { InviteCodeView } from '../../../shared/accounts.ts'
import { chipCount, formatChips } from '../../../shared/chips.ts'
import {
  type AdminPlayerView,
  adjustNoticeText,
  adjustPostText,
  MAX_ADMIN_AMOUNT,
  REASON_MAX,
} from '../../../shared/features/admin.ts'
import type { LedgerAccount } from '../../../shared/ledger.ts'
import { takesBets } from '../../../shared/seasons.ts'
import { api, errorMessage, requestKey } from '../../kit/api.ts'
import { Button } from '../../kit/Button.tsx'
import { useNow } from '../../kit/clock.ts'
import { CopyIcon } from '../../kit/icons.tsx'
import { Avatar } from '../../kit/PlayerName.tsx'
import { queryKeys, useMe, useSeason } from '../../kit/queries.ts'
import { toast } from '../../kit/toast.tsx'
import { chipsProblem, parseChips } from './config-edit.ts'
import { adminKeys, useAdminPlayers } from './data.ts'
import { SearchIcon } from './icons.tsx'
import {
  Badge,
  ChatPreview,
  dangerButton,
  dangerGhost,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  inputClass,
  Note,
  Segmented,
  SkeletonRows,
  SuffixInput,
  timeAgo,
} from './ui.tsx'

type Action =
  | { kind: 'adjust'; player: AdminPlayerView }
  | { kind: 'disable'; player: AdminPlayerView }
  | { kind: 'enable'; player: AdminPlayerView }
  | { kind: 'reset'; player: AdminPlayerView }

/** Puts a player's fresh row into the panel's list. */
function useReplacePlayer() {
  const queryClient = useQueryClient()
  return (player: AdminPlayerView) => {
    queryClient.setQueryData<{ seasonId: number | null; players: AdminPlayerView[] }>(
      adminKeys.players,
      (old) =>
        old && { ...old, players: old.players.map((p) => (p.id === player.id ? player : p)) },
    )
  }
}

function Chips({ player }: { player: AdminPlayerView }) {
  if (!player.wallet) return <span className="text-faint">No chips this season</span>
  return (
    <span className="tabular-nums">
      <span className="text-text">{formatChips(player.wallet.balance)}</span>
      <span className="text-faint"> wallet</span>
      {player.wallet.vault > 0 && (
        <>
          <span className="text-faint"> · </span>
          <span className="text-text">{formatChips(player.wallet.vault)}</span>
          <span className="text-faint"> vault</span>
        </>
      )}
    </span>
  )
}

function PlayerRow({
  player,
  me,
  seasonRunning,
  now,
  act,
}: {
  player: AdminPlayerView
  me: string
  seasonRunning: boolean
  now: Date
  act: (action: Action) => void
}) {
  const disabled = player.disabledAt !== null
  const seen = player.lastSeenAt ? timeAgo(new Date(player.lastSeenAt), now) : 'never'
  return (
    <li
      className={`flex flex-wrap items-center gap-x-4 gap-y-3 py-3.5 ${disabled ? 'opacity-70' : ''}`}
    >
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
        <Avatar player={player} size="md" ring={disabled ? 'away' : undefined} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-semibold">{player.displayName}</span>
            <span className="truncate text-sm text-faint">@{player.username}</span>
            {player.role === 'admin' && <Badge tone="accent">Admin</Badge>}
            {player.id === me && <Badge>You</Badge>}
            {disabled && <Badge tone="loss">Disabled</Badge>}
          </p>
          <p className="mt-0.5 text-sm text-muted">
            <Chips player={player} />
            <span className="text-faint"> · last here {seen}</span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => act({ kind: 'adjust', player })}
          disabled={!seasonRunning || (disabled && !player.wallet)}
          title={seasonRunning ? undefined : 'Chips only move while a season is running.'}
        >
          Adjust chips
        </Button>
        <Button size="sm" variant="ghost" onClick={() => act({ kind: 'reset', player })}>
          Reset code
        </Button>
        {player.id !== me &&
          (disabled ? (
            <Button size="sm" variant="ghost" onClick={() => act({ kind: 'enable', player })}>
              Enable
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className={dangerGhost}
              onClick={() => act({ kind: 'disable', player })}
            >
              Disable
            </Button>
          ))}
      </div>
    </li>
  )
}

function AdjustDialog({
  open,
  player,
  onClose,
}: {
  open: boolean
  player: AdminPlayerView
  onClose: () => void
}) {
  const me = useMe()
  const replace = useReplacePlayer()
  const [account, setAccount] = useState<LedgerAccount>('wallet')
  const [direction, setDirection] = useState<'add' | 'take'>('add')
  const [amountText, setAmountText] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(requestKey)

  const self = player.id === me.id
  const held = BigInt(
    account === 'wallet' ? (player.wallet?.balance ?? 0) : (player.wallet?.vault ?? 0),
  )
  const parsed = amountText.trim() ? parseChips(amountText) : null
  const amountError =
    amountText.trim() && (parsed === null || parsed === 0)
      ? chipsProblem(amountText, 'Type a number of chips above zero, such as 5 or 250.')
      : parsed !== null && parsed > MAX_ADMIN_AMOUNT
        ? 'That is more than a billion chips.'
        : parsed !== null && direction === 'take' && BigInt(parsed) > held
          ? `${self ? 'You have' : `${player.displayName} has`} only ${chipCount(held)} in the ${account}.`
          : null
  const delta = parsed ? BigInt(direction === 'add' ? parsed : -parsed) : 0n
  const cleanReason = reason.trim()
  const ready =
    delta !== 0n && !amountError && cleanReason.length >= 3 && cleanReason.length <= REASON_MAX
  const preview =
    ready || delta !== 0n
      ? adjustPostText({
          admin: me.displayName,
          player: player.displayName,
          self,
          amount: delta,
          account,
          reason: cleanReason || '…',
        })
      : null

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready) return
    setBusy(true)
    try {
      const { player: fresh } = await api.post<{ player: AdminPlayerView }>(
        '/api/admin/chips',
        { userId: player.id, amount: Number(delta), account, reason: cleanReason },
        { key },
      )
      replace(fresh)
      setKey(requestKey())
      toast.good(
        delta > 0n
          ? `Added ${chipCount(delta)} to ${self ? 'your' : `${player.displayName}’s`} ${account}.`
          : `Took ${chipCount(-delta)} from ${self ? 'your' : `${player.displayName}’s`} ${account}.`,
      )
      onClose()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const verb = direction === 'add' ? 'Add' : 'Take'
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Adjust ${self ? 'your' : `${player.displayName}’s`} chips`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="admin-adjust" disabled={!ready || busy}>
            {busy ? 'Saving…' : parsed ? `${verb} ${chipCount(parsed)}` : verb}
          </Button>
        </>
      }
    >
      <form id="admin-adjust" onSubmit={(e) => void submit(e)} className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Segmented
            label="Add or take"
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'add', label: 'Add' },
              { value: 'take', label: 'Take' },
            ]}
          />
          <Segmented
            label="Wallet or vault"
            value={account}
            onChange={setAccount}
            options={[
              { value: 'wallet', label: 'Wallet' },
              { value: 'vault', label: 'Vault' },
            ]}
          />
        </div>
        <Field
          label="Chips"
          error={amountError}
          hint={`${self ? 'You have' : `${player.displayName} has`} ${chipCount(held)} in the ${account}${
            player.wallet ? '' : ' (their starting chips come first)'
          }.`}
        >
          {(id, describedBy) => (
            <SuffixInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={amountError ? true : undefined}
              inputMode="numeric"
              autoComplete="off"
              placeholder="10"
              suffix="chips"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Reason"
          hint={`Required. Everyone reads it in chat and on the Audit page. ${cleanReason.length}/${REASON_MAX}`}
        >
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              className={inputClass}
              maxLength={REASON_MAX}
              placeholder="Refund for the coin flip that froze"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        {preview && <ChatPreview body={preview} />}
        {preview && !self && (
          <p className="text-xs text-faint">
            {player.displayName} also gets a note:{' '}
            {adjustNoticeText(me.displayName, delta, account, cleanReason || '…')}
          </p>
        )}
      </form>
    </Dialog>
  )
}

function StatusDialog({
  open,
  player,
  enable,
  onClose,
}: {
  open: boolean
  player: AdminPlayerView
  enable: boolean
  onClose: () => void
}) {
  const replace = useReplacePlayer()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [key] = useState(requestKey)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const { player: fresh } = await api.post<{ player: AdminPlayerView }>(
        `/api/admin/players/${player.id}/${enable ? 'enable' : 'disable'}`,
        { reason: reason.trim() || undefined },
        { key },
      )
      replace(fresh)
      void queryClient.invalidateQueries({ queryKey: queryKeys.players })
      void queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard })
      toast.good(
        enable
          ? `${player.displayName} can sign in again.`
          : `${player.displayName} is disabled and signed out.`,
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
      title={enable ? `Enable ${player.displayName}?` : `Disable ${player.displayName}?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={enable ? 'primary' : 'secondary'}
            className={enable ? '' : dangerButton}
            type="submit"
            form="admin-status"
            disabled={busy}
          >
            {busy
              ? 'Saving…'
              : enable
                ? `Enable ${player.displayName}`
                : `Disable ${player.displayName}`}
          </Button>
        </>
      }
    >
      <form id="admin-status" onSubmit={(e) => void submit(e)} className="space-y-4">
        <p className="text-sm text-muted">
          {enable
            ? `${player.displayName} can sign in again, and comes back to the leaderboard with their chips as they were.`
            : `${player.displayName} is signed out at once and cannot sign in. They leave the leaderboard and the online list, and are left out of a season’s final standings. Their chips stay where they are, so enabling them again puts everything back.`}
        </p>
        <Field label="Reason" hint="Optional. Shown on the Audit page.">
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              className={inputClass}
              maxLength={REASON_MAX}
              placeholder={enable ? 'Back from a break' : 'Left the group'}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  )
}

function ResetDialog({
  open,
  player,
  onClose,
}: {
  open: boolean
  player: AdminPlayerView
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [code, setCode] = useState<InviteCodeView | null>(null)
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    try {
      const made = await api.post<{ code: InviteCodeView }>('/api/invites', {
        kind: 'reset',
        username: player.username,
      })
      setCode(made.code)
      void queryClient.invalidateQueries({ queryKey: adminKeys.invites })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.good('Copied.')
    } catch {
      toast.error('Could not copy it. Select the code and copy it yourself.')
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Reset code for ${player.displayName}`}
      footer={
        code ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void create()}>
              {busy ? 'Making it…' : 'Make a reset code'}
            </Button>
          </>
        )
      }
    >
      {code ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Give this to {player.displayName}. They choose a new password with it on the reset page,
            and it works once.
          </p>
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 p-3">
            <code className="min-w-0 flex-1 truncate font-mono text-lg font-semibold tracking-wider">
              {code.code}
            </code>
            <Button size="sm" onClick={() => void copy(code.code)} aria-label={`Copy ${code.code}`}>
              <CopyIcon className="size-4" />
              Copy
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            A reset code lets whoever holds it set a new password for {player.displayName}, so
            making one is written to the public Audit page.
          </p>
          <Note>Only give it to {player.displayName}, and only if they asked.</Note>
        </div>
      )}
    </Dialog>
  )
}

export default function PlayersTab() {
  const me = useMe()
  const players = useAdminPlayers()
  const now = useNow(60_000)
  const season = useSeason().data?.current
  const [query, setQuery] = useState('')
  const [action, setAction] = useState<Action | null>(null)
  const [open, setOpen] = useState(false)
  const [round, setRound] = useState(0)
  const act = (next: Action) => {
    setAction(next)
    setRound((n) => n + 1)
    setOpen(true)
  }
  const close = () => setOpen(false)

  const all = players.data?.players ?? []
  const q = query.trim().toLowerCase()
  const shown = q
    ? all.filter(
        (p) => p.displayName.toLowerCase().includes(q) || p.username.toLowerCase().includes(q),
      )
    : all
  const active = all.filter((p) => !p.disabledAt).length
  const seasonRunning = !!season && takesBets(season.phase)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {players.data
            ? `${active} active ${active === 1 ? 'player' : 'players'}${
                all.length > active ? `, ${all.length - active} disabled` : ''
              }. Chips are this season’s.`
            : 'Every account, with its chips this season.'}
        </p>
        {all.length > 6 && (
          <label className="relative block w-full sm:w-64">
            <span className="sr-only">Find a player</span>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <input
              className={`${inputClass} pl-9`}
              placeholder="Find a player"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
      </div>

      {players.isPending && <SkeletonRows count={5} height="h-16" />}
      {players.isError && (
        <ErrorState
          message={`The players did not load. ${errorMessage(players.error)}`}
          retry={() => void players.refetch()}
        />
      )}
      {players.isSuccess && shown.length === 0 && (
        <EmptyState title={query ? `Nobody matches “${query}”` : 'No players yet'}>
          {query ? 'Try part of their name or username.' : 'Make an invite code on the Codes tab.'}
        </EmptyState>
      )}
      {shown.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface-1 px-4 shadow-card">
          {shown.map((player) => (
            <PlayerRow
              key={player.id}
              player={player}
              me={me.id}
              seasonRunning={seasonRunning}
              now={now}
              act={act}
            />
          ))}
        </ul>
      )}

      {action?.kind === 'adjust' && (
        <AdjustDialog key={round} open={open} player={action.player} onClose={close} />
      )}
      {(action?.kind === 'disable' || action?.kind === 'enable') && (
        <StatusDialog
          key={round}
          open={open}
          player={action.player}
          enable={action.kind === 'enable'}
          onClose={close}
        />
      )}
      {action?.kind === 'reset' && (
        <ResetDialog key={round} open={open} player={action.player} onClose={close} />
      )}
    </div>
  )
}
