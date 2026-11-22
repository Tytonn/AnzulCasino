/**
 * Giveaways (spec: Economy > Giveaways): the same chips to each player
 * chosen, or a pot split between them, everyone included if the admin
 * likes. The summary and the chat post update as the admin types, and a
 * last look comes before anything is given.
 */
import { type FormEvent, useMemo, useState } from 'react'

import { chipCount, formatChips } from '../../../shared/chips.ts'
import {
  type AdminPlayerView,
  type GiveawayResponse,
  giveawayPostText,
  giveawayShares,
  MAX_ADMIN_AMOUNT,
  nameList,
  REASON_MAX,
} from '../../../shared/features/admin.ts'
import { takesBets } from '../../../shared/seasons.ts'
import { api, errorMessage, requestKey } from '../../kit/api.ts'
import { Button } from '../../kit/Button.tsx'
import { Avatar } from '../../kit/PlayerName.tsx'
import { useMe, useSeason } from '../../kit/queries.ts'
import { toast } from '../../kit/toast.tsx'
import { parseHundredths } from './config-edit.ts'
import { useAdminPlayers } from './data.ts'
import {
  Card,
  ChatPreview,
  Dialog,
  ErrorState,
  Field,
  inputClass,
  Note,
  Segmented,
  SkeletonRows,
  SuffixInput,
} from './ui.tsx'

type Who = 'everyone' | 'some'
type Mode = 'each' | 'split'

const byName = (a: AdminPlayerView, b: AdminPlayerView) =>
  a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' })

export default function GiveawayTab() {
  const me = useMe()
  const players = useAdminPlayers()
  const season = useSeason().data?.current
  const running = !!season && takesBets(season.phase)

  const [who, setWho] = useState<Who>('everyone')
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [mode, setMode] = useState<Mode>('each')
  const [amountText, setAmountText] = useState('')
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(requestKey)

  const active = useMemo(
    () => (players.data?.players ?? []).filter((p) => !p.disabledAt).sort(byName),
    [players.data],
  )
  const recipients = who === 'everyone' ? active : active.filter((p) => picked.has(p.id))
  const parsed = amountText.trim() ? parseHundredths(amountText) : null
  const amountError =
    amountText.trim() && (parsed === null || parsed === 0)
      ? 'Type a number of chips above zero, such as 5 or 2.50.'
      : parsed !== null && parsed > MAX_ADMIN_AMOUNT
        ? 'That is more than a billion chips.'
        : null
  const amount = parsed && !amountError ? BigInt(parsed) : 0n
  const shares = giveawayShares(amount, recipients.length, mode === 'split')
  const tooSmall = mode === 'split' && amount > 0n && recipients.length > 0 && shares.share <= 0n
  const cleanNote = note.trim()
  const ready =
    running && recipients.length > 0 && amount > 0n && !tooSmall && cleanNote.length <= REASON_MAX

  const post =
    recipients.length > 0 && amount > 0n && !tooSmall
      ? giveawayPostText({
          admin: me.displayName,
          names: recipients.map((p) => p.displayName),
          everyone: who === 'everyone',
          split: mode === 'split',
          amount,
          share: shares.share,
          note: cleanNote || null,
        })
      : null

  function toggle(id: string) {
    setPicked((old) => {
      const next = new Set(old)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function give() {
    setBusy(true)
    try {
      const result = await api.post<GiveawayResponse>(
        '/api/admin/giveaways',
        {
          to: who === 'everyone' ? 'everyone' : recipients.map((p) => p.id),
          amount: Number(amount),
          split: mode === 'split',
          note: cleanNote || undefined,
        },
        { key },
      )
      setKey(requestKey())
      toast.good(
        `Gave ${chipCount(result.total)} to ${result.recipients.length} ${
          result.recipients.length === 1 ? 'player' : 'players'
        }.`,
      )
      setConfirming(false)
      setAmountText('')
      setNote('')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  function review(event: FormEvent) {
    event.preventDefault()
    if (ready) setConfirming(true)
  }

  if (players.isPending) return <SkeletonRows count={4} height="h-20" />
  if (players.isError) {
    return (
      <ErrorState
        message={`The players did not load. ${errorMessage(players.error)}`}
        retry={() => void players.refetch()}
      />
    )
  }

  const each = shares.share
  return (
    <form
      onSubmit={review}
      className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]"
    >
      <Card title="Give chips">
        <div className="space-y-5">
          {!running && (
            <Note tone="gold">No season is running, so there are no chips to give right now.</Note>
          )}
          <div>
            <p className="mb-1.5 text-sm font-medium">To</p>
            <Segmented
              label="Who gets chips"
              value={who}
              onChange={setWho}
              options={[
                { value: 'everyone', label: `Everyone (${active.length})` },
                { value: 'some', label: 'Pick players' },
              ]}
            />
            {who === 'some' && (
              <div className="mt-3">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-faint">
                  <span>
                    {picked.size === 0 ? 'Nobody picked yet' : `${recipients.length} picked`}
                  </span>
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPicked(new Set(active.map((p) => p.id)))}
                    >
                      All
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                      None
                    </Button>
                  </span>
                </div>
                <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {active.map((p) => {
                    const on = picked.has(p.id)
                    return (
                      <li key={p.id}>
                        <label
                          className={`flex h-11 cursor-pointer items-center gap-2.5 rounded-md border px-3 text-sm transition ${
                            on
                              ? 'border-accent bg-accent/10'
                              : 'border-border hover:border-border-strong'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="size-4 accent-accent"
                            checked={on}
                            onChange={() => toggle(p.id)}
                          />
                          <Avatar player={p} size="xs" />
                          <span className="truncate font-medium">{p.displayName}</span>
                          {p.id === me.id && <span className="text-xs text-faint">you</span>}
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium">How</p>
            <Segmented
              label="How the chips are given"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'each', label: 'Same amount each' },
                { value: 'split', label: 'Split a pot' },
              ]}
            />
          </div>

          <Field
            label={mode === 'split' ? 'The pot' : 'Chips each'}
            error={
              amountError ??
              (tooSmall ? 'Too little to split: each share needs at least 0.01.' : null)
            }
            hint={
              mode === 'split'
                ? 'Split evenly. Each share rounds down to a hundredth, so the pot is never overpaid.'
                : 'Every player gets this much.'
            }
          >
            {(id, describedBy) => (
              <SuffixInput
                id={id}
                aria-describedby={describedBy}
                aria-invalid={amountError || tooSmall ? true : undefined}
                inputMode="decimal"
                autoComplete="off"
                placeholder={mode === 'split' ? '50' : '5'}
                suffix="chips"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
              />
            )}
          </Field>

          <Field
            label="Note"
            hint={`Optional. Shown in chat, in each player’s note and on the Audit page. ${cleanNote.length}/${REASON_MAX}`}
          >
            {(id, describedBy) => (
              <input
                id={id}
                aria-describedby={describedBy}
                className={inputClass}
                maxLength={REASON_MAX}
                placeholder="Happy Friday"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
        </div>
      </Card>

      <div className="space-y-4">
        <Card title="Summary">
          {recipients.length === 0 ? (
            <p className="text-sm text-muted">Pick at least one player.</p>
          ) : amount === 0n || tooSmall ? (
            <p className="text-sm text-muted">
              {recipients.length === 1 ? '1 player' : `${recipients.length} players`}:{' '}
              {nameList(
                recipients.map((p) => p.displayName),
                6,
              )}
              .
            </p>
          ) : (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Each player gets</dt>
                <dd className="font-semibold tabular-nums">{chipCount(each)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Players</dt>
                <dd className="tabular-nums">{recipients.length}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-border pt-2">
                <dt className="text-muted">In all</dt>
                <dd className="font-semibold text-gold tabular-nums">{chipCount(shares.total)}</dd>
              </div>
              {shares.leftover > 0n && (
                <p className="text-xs text-faint">
                  {formatChips(shares.leftover)} of the pot is left over, since shares round down.
                </p>
              )}
            </dl>
          )}
          {post && (
            <div className="mt-4">
              <ChatPreview body={post} />
            </div>
          )}
          <Button type="submit" variant="gold" size="lg" className="mt-4 w-full" disabled={!ready}>
            {ready ? `Give ${chipCount(shares.total)}` : 'Give chips'}
          </Button>
        </Card>
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Give these chips?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Back
            </Button>
            <Button variant="gold" disabled={busy} onClick={() => void give()}>
              {busy ? 'Giving…' : `Give ${chipCount(shares.total)}`}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          {recipients.length === 1
            ? `${recipients[0]?.displayName} gets ${chipCount(each)}.`
            : `${recipients.length} players get ${chipCount(each)} each, ${chipCount(shares.total)} in all.`}{' '}
          Each of them gets a note, and it goes on the Audit page.
        </p>
        {post && <ChatPreview body={post} />}
      </Dialog>
    </form>
  )
}
