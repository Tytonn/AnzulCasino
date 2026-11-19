/**
 * Chat drops (spec: Giveaways): a pot lands in chat at a random time, and
 * the first few players to grab it split it. The Grab button sits under the
 * drop's post in chat, and a pill at the top of the page carries it into
 * every room, so a player in the middle of a hand on a phone still sees it.
 * Everyone watches the shares go as they are grabbed.
 */
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'

import { chipCount, formatChips } from '../../../shared/chips.ts'
import { dropFromMeta, type DropView } from '../../../shared/features/economy.ts'
import { Button } from '../../kit/Button.tsx'
import { useNow } from '../../kit/clock.ts'
import { CloseIcon } from '../../kit/icons.tsx'
import { Avatar } from '../../kit/PlayerName.tsx'
import { useMe, usePlayer } from '../../kit/queries.ts'
import type { SlotProps } from '../../shell/manifests.ts'
import { grabDrop, useBusy } from './actions.ts'
import { useEconomy } from './data.ts'
import { DropIcon, TickIcon } from './icons.tsx'

/** The pill shows a drop for this long after it lands; the chat keeps it open after. */
const PILL_MS = 15 * 60_000

function Claimer({ userId, amount }: { userId: string; amount: number }) {
  const player = usePlayer(userId)
  const name = player?.displayName ?? 'Someone'
  return (
    <motion.span
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 600, damping: 22 }}
      title={`${name} grabbed ${chipCount(amount)}`}
      className="-ml-1.5 first:ml-0"
    >
      <Avatar player={player} size="xs" className="ring-2 ring-surface-1" />
      <span className="sr-only">{name}</span>
    </motion.span>
  )
}

function Claimers({ drop }: { drop: DropView }) {
  if (drop.claims.length === 0) return null
  return (
    <span className="flex items-center" aria-label="Grabbed by">
      {drop.claims.map((c) => (
        <Claimer key={c.userId} userId={c.userId} amount={c.amount} />
      ))}
    </span>
  )
}

function GrabButton({ drop, size = 'sm' }: { drop: DropView; size?: 'sm' | 'md' }) {
  const queryClient = useQueryClient()
  const busy = useBusy(`drop:${drop.id}`)
  return (
    <Button
      variant="gold"
      size={size}
      disabled={busy}
      onClick={() => void grabDrop(queryClient, drop.id)}
    >
      <DropIcon className="size-4" />
      {busy ? 'Grabbing…' : `Grab ${formatChips(drop.share)}`}
    </Button>
  )
}

function DropState({ dropId }: { dropId: number }) {
  const { data: state } = useEconomy()
  const me = useMe()
  if (!state) return null
  const drop = state.drops.find((d) => d.id === dropId)
  if (!drop) {
    return <p className="mt-1.5 text-center text-[0.7rem] text-faint">This drop has closed.</p>
  }
  const mine = drop.claims.find((c) => c.userId === me.id)
  const left = Math.max(0, drop.winners - drop.claims.length)

  let words: string
  if (mine) words = `You grabbed ${chipCount(mine.amount)}.`
  else if (left === 0) words = `All ${drop.winners} shares are gone.`
  else if (!drop.open) words = 'Closed: a newer drop landed.'
  else words = `${left} of ${drop.winners} ${drop.winners === 1 ? 'share' : 'shares'} left`

  return (
    <div
      className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5"
      data-economy-drop={drop.id}
    >
      {drop.open && !mine && <GrabButton drop={drop} />}
      <span
        className={`inline-flex items-center gap-1 text-[0.7rem] font-medium ${mine ? 'text-gold' : 'text-muted'}`}
      >
        {mine && <TickIcon className="size-3.5" />}
        {words}
      </span>
      <Claimers drop={drop} />
    </div>
  )
}

/** Under a drop's post in chat (the `chat-message` slot). */
export function DropGrab({ message }: SlotProps['chat-message']) {
  if (message.kind !== 'system') return null
  const drop = dropFromMeta(message.meta)
  if (!drop) return null
  return <DropState dropId={drop.id} />
}

/** The pill at the top of the page while a drop is open and the player has not grabbed it. */
export function DropPill() {
  const { data: state } = useEconomy()
  const me = useMe()
  const now = useNow(5_000).getTime()
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set())

  const drop = state?.drops.find((d) => d.open) ?? null
  const show =
    drop !== null &&
    !hidden.has(drop.id) &&
    !drop.claims.some((c) => c.userId === me.id) &&
    now - Date.parse(drop.postedAt) < PILL_MS

  const top = (document.querySelector('header')?.getBoundingClientRect().bottom ?? 64) + 10
  const left = drop ? Math.max(0, drop.winners - drop.claims.length) : 0

  return (
    <AnimatePresence>
      {show && drop && (
        <motion.div
          key={drop.id}
          role="status"
          aria-label="Chat drop"
          initial={{ opacity: 0, y: -16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.97, transition: { duration: 0.15 } }}
          transition={{ type: 'spring', stiffness: 460, damping: 30 }}
          style={{ top }}
          className="fixed inset-x-3 z-30 mx-auto flex max-w-md items-center gap-3 rounded-full border border-gold/50 bg-surface-2/95 py-1.5 pr-1.5 pl-2 shadow-pop backdrop-blur-md"
          data-economy="drop-pill"
        >
          <motion.span
            className="grid size-8 shrink-0 place-items-center rounded-full bg-gold/15 text-gold"
            animate={{ rotate: [0, -12, 10, -6, 0] }}
            transition={{ duration: 0.9, repeat: Infinity, repeatDelay: 2.4 }}
          >
            <DropIcon className="size-[1.1rem]" />
          </motion.span>
          <p className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-semibold text-gold">Chat drop!</span>
            <span className="block truncate text-xs text-muted">
              {formatChips(drop.share)} each · {left} of {drop.winners} left
            </span>
          </p>
          <GrabButton drop={drop} />
          <button
            type="button"
            onClick={() => setHidden((h) => new Set([...h, drop.id]))}
            aria-label="Hide this drop"
            className="grid size-8 shrink-0 place-items-center rounded-full text-faint hover:bg-surface-3 hover:text-text active:scale-95"
          >
            <CloseIcon className="size-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
