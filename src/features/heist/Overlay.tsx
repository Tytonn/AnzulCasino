/**
 * Heist's piece of the shell, mounted once for the session (the `overlay`
 * slot):
 *
 * - HeistSync keeps the heist state and the steals log current from live
 *   events, without polling, and refetches after a reconnect.
 * - The alerts tell you the moment someone robs you, your shield blocks
 *   them, or they get caught, with a button to rob them back.
 * - The heist panel and the steal dialog, loaded the first time they open.
 */
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { lazy, type ReactNode, Suspense, useEffect } from 'react'
import { useLocation } from 'react-router'
import { create } from 'zustand'

import { formatChips } from '../../../shared/chips.ts'
import { userChannel } from '../../../shared/events.ts'
import { Button } from '../../kit/Button.tsx'
import { CloseIcon, ShieldIcon } from '../../kit/icons.tsx'
import { serverNow } from '../../kit/clock.ts'
import { Avatar, PlayerName } from '../../kit/PlayerName.tsx'
import { useMe, usePlayer } from '../../kit/queries.ts'
import { afterReveal } from '../../kit/reveal.ts'
import { playSound } from '../../kit/sfx.ts'
import { useLiveEvent, useResync } from '../../live/index.ts'
import { MaskIcon, SirenIcon } from './art.tsx'
import { addToLog, appliedSteals, heistKeys, patchHeist, useHeistUi } from './data.ts'
import { applySteal, shortDuration } from './derive.ts'

const HeistPanel = lazy(() => import('./Panel.tsx').then((m) => ({ default: m.HeistPanel })))
const StealDialog = lazy(() =>
  import('./StealDialog.tsx').then((m) => ({ default: m.StealDialog })),
)

export function HeistOverlay() {
  const me = useMe()
  const panel = useHeistUi((s) => s.panel)
  const target = useHeistUi((s) => s.stealTarget)
  const loaded = useLoaded(panel !== null, target !== null)
  const { pathname } = useLocation()

  // Walking to another page closes the panel, like every other sheet.
  useEffect(() => {
    useHeistUi.getState().closePanel()
  }, [pathname])

  return (
    <>
      <HeistSync meId={me.id} />
      <HeistAlerts />
      <Suspense fallback={null}>
        {loaded.panel && <HeistPanel />}
        {loaded.dialog && <StealDialog />}
      </Suspense>
    </>
  )
}

/** Remembers what has opened once, so it stays mounted and can animate closed. */
const useOpened = create<{ panel: boolean; dialog: boolean }>(() => ({
  panel: false,
  dialog: false,
}))

function useLoaded(panel: boolean, dialog: boolean) {
  const opened = useOpened()
  useEffect(() => {
    if (panel && !useOpened.getState().panel) useOpened.setState({ panel: true })
    if (dialog && !useOpened.getState().dialog) useOpened.setState({ dialog: true })
  }, [panel, dialog])
  return { panel: opened.panel || panel, dialog: opened.dialog || dialog }
}

// ---------------------------------------------------------------- live

function HeistSync({ meId }: { meId: string }) {
  const queryClient = useQueryClient()

  // A fresh copy waits for your own reveal, so a steal on screen is not
  // counted once by the copy and again when the vault opens.
  useResync(() => {
    afterReveal(meId, () => {
      void queryClient.invalidateQueries({ queryKey: heistKeys.all }, { cancelRefetch: false })
    })
  })

  // Every attempt: the log, and the target's immunity and cap in the list.
  // News of a steal waits for the thief's reveal, so nothing gives it away.
  useLiveEvent('feed', 'steal.result', (steal) => {
    afterReveal(steal.thiefId, () => {
      addToLog(queryClient, steal)
      if (appliedSteals.has(steal.id)) return
      appliedSteals.add(steal.id)
      patchHeist(queryClient, (state) => {
        const next = applySteal(state, steal, meId)
        if (next !== 'refetch') return next
        void queryClient.invalidateQueries({ queryKey: heistKeys.state })
        return state
      })
    })
  })

  const mine = userChannel(meId)
  useLiveEvent(mine, 'robbed', (event) => {
    pushAlert({
      kind: 'robbed',
      thiefId: event.thiefId,
      amount: event.amount,
      immuneUntil: event.immuneUntil,
    })
  })
  useLiveEvent(mine, 'shield.blocked', (event) => {
    patchHeist(queryClient, (s) => ({
      ...s,
      me: { ...s.me, charges: event.charges, immuneUntil: event.immuneUntil },
    }))
    pushAlert({
      kind: 'blocked',
      thiefId: event.thiefId,
      amount: 0,
      charges: event.charges,
      immuneUntil: event.immuneUntil,
    })
  })
  useLiveEvent(mine, 'steal.foiled', (event) => {
    pushAlert({ kind: 'foiled', thiefId: event.thiefId, amount: event.fine })
  })
  // Your own shield, extra attempt or vault changed in another tab.
  useLiveEvent(mine, 'heist.changed', () => {
    afterReveal(meId, () => {
      void queryClient.invalidateQueries({ queryKey: heistKeys.state })
    })
  })

  return null
}

// ---------------------------------------------------------------- alerts

interface Alert {
  id: number
  kind: 'robbed' | 'blocked' | 'foiled'
  thiefId: string
  /** Chips taken from you, or the fine paid to you. */
  amount: number
  charges?: number
  /** "3h", worked out when the news arrives. */
  immuneFor?: string
}

const SHOW_MS = 8_000
const MAX_ALERTS = 3
let nextAlert = 1

const useAlerts = create<{ alerts: Alert[] }>(() => ({ alerts: [] }))

function dismissAlert(id: number) {
  useAlerts.setState((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) }))
}

function pushAlert({
  immuneUntil,
  ...alert
}: Omit<Alert, 'id' | 'immuneFor'> & { immuneUntil?: string }) {
  const id = nextAlert++
  const immuneFor = immuneUntil
    ? shortDuration(Math.max(0, Date.parse(immuneUntil) - serverNow()))
    : undefined
  useAlerts.setState((s) => ({
    alerts: [...s.alerts, { ...alert, id, immuneFor }].slice(-MAX_ALERTS),
  }))
  setTimeout(() => dismissAlert(id), SHOW_MS)
  if (alert.kind === 'robbed') {
    playSound('steal')
    setTimeout(() => playSound('loss'), 260)
  } else if (alert.kind === 'blocked') playSound('block')
  else playSound('win')
}

function HeistAlerts() {
  const alerts = useAlerts((s) => s.alerts)
  return (
    <div
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+6.75rem)] z-[45] flex flex-col items-center gap-2 px-4 md:top-[6.75rem]"
    >
      <AnimatePresence initial={false}>
        {alerts.map((alert) => (
          <AlertCard key={alert.id} alert={alert} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function AlertCard({ alert }: { alert: Alert }) {
  const thief = usePlayer(alert.thiefId)
  const rob = useHeistUi((s) => s.rob)
  const { immuneFor } = alert

  const look = {
    robbed: { color: 'var(--heist-alarm)', icon: <SirenIcon className="size-5" /> },
    blocked: { color: 'var(--heist-shield)', icon: <ShieldIcon className="size-5" /> },
    foiled: { color: 'var(--gold)', icon: <MaskIcon className="size-5" /> },
  }[alert.kind]

  const name = <PlayerName player={thief} badge={false} />
  let title: ReactNode
  let line: string
  if (alert.kind === 'robbed') {
    title = <>{name} robbed you</>
    line = `−${formatChips(alert.amount)} chips.${immuneFor ? ` You are immune for ${immuneFor}.` : ''}`
  } else if (alert.kind === 'blocked') {
    title = <>Your shield blocked {name}</>
    line = `${alert.charges === 1 ? '1 charge' : `${alert.charges ?? 0} charges`} left.${immuneFor ? ` Immune for ${immuneFor}.` : ''}`
  } else {
    title = <>{name} got caught robbing you</>
    line =
      alert.amount > 0
        ? `+${formatChips(alert.amount)} chips: their fine is yours.`
        : 'They had nothing to fine.'
  }

  return (
    <motion.div
      layout
      role="alert"
      initial={{ opacity: 0, y: -24, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.97, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 460, damping: 28 }}
      className="pointer-events-auto relative w-full max-w-md overflow-hidden rounded-lg border bg-surface-2 shadow-pop"
      style={{
        borderColor: `color-mix(in oklab, ${look.color} 60%, transparent)`,
        boxShadow: `0 0 0 1px color-mix(in oklab, ${look.color} 25%, transparent), 0 18px 48px -12px color-mix(in oklab, ${look.color} 45%, transparent)`,
      }}
    >
      {alert.kind === 'robbed' && (
        <div
          className="heist-alarm pointer-events-none absolute inset-0"
          style={{ background: `linear-gradient(90deg, var(--heist-alarm-glow), transparent 60%)` }}
        />
      )}
      <div className="relative flex items-center gap-3 p-3 pr-2">
        <div className="relative shrink-0">
          <Avatar player={thief} size="md" />
          <span
            className="absolute -right-1.5 -bottom-1.5 grid size-6 place-items-center rounded-full border-2 border-surface-2"
            style={{ backgroundColor: look.color, color: 'var(--bg)' }}
          >
            {look.icon}
          </span>
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="line-clamp-2 text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-xs text-muted">{line}</p>
        </div>
        {alert.kind !== 'blocked' && (
          <Button
            size="sm"
            variant={alert.kind === 'robbed' ? 'gold' : 'secondary'}
            onClick={() => {
              dismissAlert(alert.id)
              rob(alert.thiefId)
            }}
          >
            Rob back
          </Button>
        )}
        <button
          type="button"
          onClick={() => dismissAlert(alert.id)}
          aria-label="Dismiss"
          className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-text"
        >
          <CloseIcon className="size-4" />
        </button>
      </div>
      <motion.div
        className="h-0.5 origin-left"
        style={{ backgroundColor: look.color }}
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: SHOW_MS / 1000, ease: 'linear' }}
      />
    </motion.div>
  )
}
