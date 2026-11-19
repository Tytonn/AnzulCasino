/**
 * The economy's part of every page (the `overlay` slot, mounted once): the
 * result card, the Daily panel and the chat-drop pill, the Shift shortcuts
 * for the top-bar buttons, and the live news that keeps the economy current:
 *
 * - `economy.changed` on the player's channel: another tab pressed, collected
 *   or claimed. Fetch the economy if the news is newer than what is shown.
 * - `chat.message` with a drop, and `drop.claimed`: drops land and fill up.
 * - `round.settled` for the player's own rounds: a challenge may be done.
 *   Fetch once the reveal is over, and say so when one is.
 * - `season.state`: the final day or the end.
 *
 * Nothing polls. The two moments a page cannot work out by itself, the
 * daily reset and the season's end, refetch once, and only on a page
 * someone is looking at.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useRef } from 'react'

import { chipCount } from '../../../shared/chips.ts'
import {
  commandName,
  couldAdvance,
  describeChallenge,
  dropFromMeta,
  type EconomyState,
} from '../../../shared/features/economy.ts'
import { userChannel } from '../../../shared/events.ts'
import { serverNow } from '../../kit/clock.ts'
import { isShortcut } from '../../kit/Kbd.tsx'
import { useMe, useSeason } from '../../kit/queries.ts'
import { afterReveal } from '../../kit/reveal.ts'
import { playSound } from '../../kit/sfx.ts'
import { toast } from '../../kit/toast.tsx'
import { useLiveEvent, useResync } from '../../live/index.ts'
import { gameById } from '../../shell/registry.ts'
import { collect, press } from './actions.ts'
import { DailyPanelLayer, toggleDailyPanel } from './DailyPanel.tsx'
import {
  addDrop,
  addDropClaim,
  economyKey,
  incomeNow,
  longWait,
  msUntil,
  useEconomy,
  useHustleName,
} from './data.ts'
import { DropPill } from './Drops.tsx'
import { shortcutFor } from './keys.ts'
import { ResultLayer } from './ResultCard.tsx'

/** A page counts as looked at if someone touched it in the last quarter hour. */
const ACTIVE_MS = 15 * 60_000

/** Rounds settling in a burst (a roulette spin, fast flips) fetch once. */
const SETTLE_MS = 700

function useLookedAt() {
  const last = useRef(0)
  useEffect(() => {
    const touch = () => {
      last.current = Date.now()
    }
    touch()
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    for (const name of events) window.addEventListener(name, touch, { passive: true })
    return () => {
      for (const name of events) window.removeEventListener(name, touch)
    }
  }, [])
  return () => document.visibilityState === 'visible' && Date.now() - last.current < ACTIVE_MS
}

export function EconomyOverlay() {
  const me = useMe()
  const queryClient = useQueryClient()
  const { data: state } = useEconomy()
  const season = useSeason().data
  const hustleName = useHustleName()
  const lookedAt = useLookedAt()
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const refetch = () => void queryClient.invalidateQueries({ queryKey: economyKey })
  const cached = () => queryClient.getQueryData<EconomyState | null>(economyKey) ?? null

  useResync(refetch)

  useLiveEvent(userChannel(me.id), 'economy.changed', (news, { version }) => {
    const shown = cached()
    if (shown && shown.seasonId === news.seasonId && shown.version >= version) return
    refetch()
  })

  useLiveEvent('feed', 'season.state', refetch)

  useLiveEvent('chat', 'chat.message', (message) => {
    if (message.kind !== 'system') return
    const drop = dropFromMeta(message.meta)
    if (!drop) return
    addDrop(queryClient, {
      id: drop.id,
      messageId: message.id,
      pot: drop.pot,
      winners: drop.winners,
      share: drop.share,
      postedAt: message.createdAt,
      open: true,
      claims: [],
    })
    playSound('sparkle')
  })

  useLiveEvent('chat', 'drop.claimed', (claim) => addDropClaim(queryClient, claim))

  useLiveEvent('feed', 'round.settled', (round) => {
    if (round.userId !== me.id) return
    const shown = cached()
    if (!shown || shown.seasonId !== round.seasonId) return
    if (!shown.challenges.list.some((c) => !c.done && couldAdvance(c, round))) return
    // After the reveal, so a "challenge done" never gives a result away.
    afterReveal(me.id, () => {
      clearTimeout(settleTimer.current)
      settleTimer.current = setTimeout(refetch, SETTLE_MS)
    })
  })

  useEffect(() => () => clearTimeout(settleTimer.current), [])

  // A challenge that turns done says so once, with what it pays.
  const done = useRef<Map<string, boolean> | null>(null)
  useEffect(() => {
    if (!state) return
    const day = state.challenges.day
    const before = done.current
    const after = new Map(state.challenges.list.map((c) => [`${day}:${c.index}`, c.done]))
    if (before) {
      for (const c of state.challenges.list) {
        if (!c.done || c.claimed || before.get(`${day}:${c.index}`) !== false) continue
        const text = describeChallenge(c, c.game ? gameById(c.game)?.name : undefined)
        playSound('sparkle')
        toast.good(`Challenge done: ${text}. Claim ${chipCount(c.reward)} in Daily.`)
      }
    }
    done.current = after
  }, [state])

  // The daily reset brings new challenges and the next streak day.
  const resetsAt = state?.challenges.resetsAt
  useEffect(() => {
    if (!resetsAt) return
    const wait = Date.parse(resetsAt) - serverNow() + 1_500
    if (wait <= 0 || wait > 2 * 86_400_000) return
    const timer = setTimeout(() => {
      if (lookedAt()) refetch()
    }, wait)
    return () => clearTimeout(timer)
    // lookedAt and refetch read the latest values when the timer fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetsAt])

  // At the season's end the buttons go: there is nothing left to earn.
  const endsAt = season?.current?.endsAt
  useEffect(() => {
    if (!endsAt) return
    const wait = Date.parse(endsAt) - serverNow() + 2_000
    if (wait <= 0 || wait > 2 * 86_400_000) return
    const timer = setTimeout(() => {
      if (document.visibilityState === 'visible') refetch()
    }, wait)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt])

  // Shift and a letter presses a top-bar button from anywhere (keys.ts).
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || !isShortcut(event)) return
    const action = shortcutFor(event, hustleName)
    if (!action) return
    const shown = cached()
    if (!shown) return
    event.preventDefault()
    const anchor = document.querySelector(`[data-economy="${action}"]`)
    if (action === 'daily') {
      toggleDailyPanel(anchor)
      return
    }
    if (action === 'collect') {
      if (incomeNow(shown, serverNow()).total <= 0) toast.info('Nothing to collect yet.')
      else void collect(queryClient, anchor)
      return
    }
    const name = commandName(action, hustleName)
    const left = msUntil(shown.cooldowns[action], serverNow())
    if (left > 0) toast.info(`${name} is ready again in ${longWait(left)}.`)
    else void press(queryClient, action, name, anchor)
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event)
    // Capture, so a room's own letter keys never see a Shift shortcut meant for these.
    window.addEventListener('keydown', listener, { capture: true })
    return () => window.removeEventListener('keydown', listener, { capture: true })
  }, [])

  return (
    <>
      <DropPill />
      <DailyPanelLayer />
      <ResultLayer />
    </>
  )
}
