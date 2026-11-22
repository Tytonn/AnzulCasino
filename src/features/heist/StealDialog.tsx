/**
 * The steal (spec: Steal rules). Three steps in one card over the page:
 *
 * 1. Size it up: you against them, the odds, what a success takes and what
 *    getting caught costs, or why they cannot be robbed right now.
 * 2. Crack the vault: the request goes out at once and the dial clicks
 *    through a combination for a moment of suspense (click or Enter skips
 *    it). News of the result, about you and about the target, waits.
 * 3. The ending: the door swings open on gold, the alarm goes off, or a
 *    shield slams down. Then the news plays out: the top bar, the
 *    leaderboard, chat and the ticker.
 *
 * Enter robs, skips and finishes; Escape closes (or skips while cracking).
 */
import { useQueryClient } from '@tanstack/react-query'
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { chipCount, formatChips, formatChipsShort, formatShare } from '../../../shared/chips.ts'
import { blockMessage, type StealResponse, stealFine } from '../../../shared/features/heist.ts'
import type { StandingView } from '../../../shared/seasons.ts'
import { api, errorMessage, requestKey } from '../../kit/api.ts'
import { Button } from '../../kit/Button.tsx'
import { Kbd, pressesFocused } from '../../kit/Kbd.tsx'
import { Avatar, PlayerName } from '../../kit/PlayerName.tsx'
import { applyWallet, usePlayer } from '../../kit/queries.ts'
import { afterReveal, holdReveal } from '../../kit/reveal.ts'
import { playSound } from '../../kit/sfx.ts'
import { Sheet } from '../../kit/Sheet.tsx'
import { useBuyExtraAttempt } from './actions.ts'
import { MaskIcon, Pips } from './art.tsx'
import { addToLog, appliedSteals, heistKeys, patchHeist, useHeist, useHeistUi } from './data.ts'
import { applySteal, hoursInWords, shortDuration } from './derive.ts'
import { VaultScene, type VaultMood } from './VaultScene.tsx'

/**
 * The dial's suspense before the ending shows: about seven clicks, long
 * enough to feel the heist, short enough not to wait on. A tap skips it.
 */
const SUSPENSE_MS = 1_200
const REDUCED_SUSPENSE_MS = 300
/** How long each ending runs before the news plays out. */
const ENDING_MS = { success: 1_500, failed: 900, blocked: 700 } as const
const REDUCED_ENDING_MS = 150

type Step =
  | { kind: 'confirm'; error: string | null }
  | { kind: 'cracking' }
  | { kind: 'result'; answer: StealResponse; bigHaul: boolean }

export function StealDialog() {
  const targetId = useHeistUi((s) => s.stealTarget)
  const dismissSteal = useHeistUi((s) => s.dismissSteal)
  return (
    <Sheet
      open={targetId !== null}
      onClose={dismissSteal}
      title="Rob a player"
      placement="center"
      hideTitle
    >
      {targetId && <StealFlow key={targetId} targetId={targetId} />}
    </Sheet>
  )
}

function StealFlow({ targetId }: { targetId: string }) {
  const heist = useHeist()
  const queryClient = useQueryClient()
  const reduced = useReducedMotion() ?? false
  const player = usePlayer(targetId)
  const row = heist.target(targetId)
  const [step, setStep] = useState<Step>({ kind: 'confirm', error: null })
  const [flight, setFlight] = useState<DOMRect | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const skipped = useRef(false)
  const wake = useRef<(() => void) | null>(null)
  const closeSteal = useHeistUi((s) => s.closeSteal)
  const fromPanel = useHeistUi((s) => s.fromPanel)
  const openPanel = useHeistUi((s) => s.openPanel)
  const extra = useBuyExtraAttempt()

  const name = player?.displayName ?? row?.standing.displayName ?? 'That player'
  const check = row?.check
  const reason = check && !check.ok ? check.reason : null
  const fine = stealFine(BigInt(heist.balance), heist.cfg.steal_fine_pct)

  function skip() {
    skipped.current = true
    wake.current?.()
  }

  // Escape or a click on the backdrop while cracking skips to the ending.
  useEffect(() => {
    const stop = useHeistUi.subscribe((now, before) => {
      if (now.skips === before.skips) return
      skipped.current = true
      wake.current?.()
    })
    return () => {
      stop()
      useHeistUi.getState().setCracking(false)
    }
  }, [])

  async function rob() {
    if (step.kind !== 'confirm' || !check?.ok) return
    const before = heist.myStanding?.netWorth ?? heist.balance + heist.vault
    skipped.current = false
    setStep({ kind: 'cracking' })
    useHeistUi.getState().setCracking(true)
    playSound('deal')
    // News about both of you waits until the vault shows how it went.
    const release = holdReveal({ players: [heist.meId, targetId] })
    const started = Date.now()
    let answer: StealResponse
    try {
      answer = await api.post<StealResponse>(
        '/api/heist/steal',
        { targetId },
        { key: requestKey() },
      )
    } catch (error) {
      release(0)
      useHeistUi.getState().setCracking(false)
      playSound('thud')
      setStep({ kind: 'confirm', error: errorMessage(error) })
      void queryClient.invalidateQueries({ queryKey: heistKeys.state })
      return
    }
    // The feed's copy of this steal is folded in below, at the reveal.
    appliedSteals.add(answer.steal.id)

    const suspense = reduced ? REDUCED_SUSPENSE_MS : SUSPENSE_MS
    const left = suspense - (Date.now() - started)
    if (left > 0 && !skipped.current) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, left)
        function done() {
          clearTimeout(timer)
          wake.current = null
          resolve()
        }
        wake.current = done
      })
    }

    const { outcome, amount } = answer.steal
    const endingMs = reduced ? REDUCED_ENDING_MS : ENDING_MS[outcome]
    release(endingMs)
    useHeistUi.getState().setCracking(false)
    const bigHaul = outcome === 'success' && amount * 10 >= Math.max(1, before)
    setStep({ kind: 'result', answer, bigHaul })

    if (outcome === 'success') {
      // The dialog is the celebration: the door swings, the chips burst and
      // fly to your wallet, and the haul counts up. No banner on top of it.
      playSound('steal')
      setTimeout(() => playSound(bigHaul ? 'bigwin' : 'win'), reduced ? 0 : 600)
      if (!reduced && stage.current) {
        const rect = stage.current.getBoundingClientRect()
        setTimeout(() => setFlight(rect), 600)
      }
    } else if (outcome === 'blocked') {
      setTimeout(() => playSound('block'), reduced ? 0 : 120)
    } else {
      playSound('loss')
      if (!reduced) setTimeout(() => playSound('thud'), 160)
    }

    // The news plays out once the ending has run.
    afterReveal(heist.meId, () => {
      applyWallet(queryClient, answer.wallet)
      addToLog(queryClient, answer.steal)
      patchHeist(queryClient, (s) => {
        const steal = { ...answer.steal, immuneUntil: answer.immuneUntil }
        const next = applySteal(s, steal, heist.meId, answer.attemptsUsed)
        if (next === 'refetch') {
          void queryClient.invalidateQueries({ queryKey: heistKeys.state })
          return s
        }
        return next
      })
    })
  }

  function again() {
    closeSteal()
    openPanel('rob')
  }

  // Enter robs, skips the suspense and closes the result.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return
      if (event.key !== 'Enter' && event.key !== ' ') return
      if (pressesFocused(event)) return
      event.preventDefault()
      if (step.kind === 'confirm') void rob()
      else if (step.kind === 'cracking') skip()
      else closeSteal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const mood: VaultMood =
    step.kind === 'cracking'
      ? 'cracking'
      : step.kind === 'result'
        ? step.answer.steal.outcome === 'success'
          ? 'open'
          : step.answer.steal.outcome === 'failed'
            ? 'alarm'
            : 'blocked'
        : 'idle'

  return (
    <div className="scroll-quiet flex flex-col overflow-y-auto px-5 pt-5 pb-5">
      <FaceOff me={heist.myStanding} target={row?.standing} targetName={name} />

      <div
        ref={stage}
        className={`relative mx-auto my-4 w-40 sm:w-48 ${step.kind === 'cracking' ? 'cursor-pointer' : ''}`}
        onClick={step.kind === 'cracking' ? skip : undefined}
      >
        <VaultScene mood={mood} big={step.kind === 'result' && step.bigHaul} />
      </div>

      <SmoothHeight>
        <AnimatePresence mode="wait" initial={false}>
          {step.kind === 'confirm' && (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              {step.error && (
                <p
                  role="alert"
                  className="mb-3 rounded-md border border-loss/50 bg-loss/10 px-3 py-2 text-sm"
                >
                  {step.error}
                </p>
              )}
              {check?.ok ? (
                <dl className="space-y-2 text-sm">
                  <Odds label="Chance" tone="text">
                    <span className="font-semibold">
                      {formatShare(heist.cfg.steal_success_pct)}
                    </span>
                    <span className="text-faint"> unless a shield blocks you</span>
                  </Odds>
                  <Odds label="If it works" tone="gold">
                    <span className="font-semibold">+{formatChips(Number(check.amount))}</span>
                    <span className="text-faint">
                      {' '}
                      · {formatShare(check.rate)} of {name}’s wallet
                    </span>
                  </Odds>
                  <Odds label="If you’re caught" tone="loss">
                    <span className="font-semibold">−{formatChips(Number(fine))}</span>
                    <span className="text-faint">
                      {' '}
                      · {formatShare(heist.cfg.steal_fine_pct)} of yours, paid to {name}
                    </span>
                  </Odds>
                </dl>
              ) : (
                <p className="rounded-md bg-surface-2 px-3 py-2.5 text-sm text-muted">
                  {reason
                    ? blockMessage(reason, {
                        name,
                        freezeHours: heist.cfg.final_freeze_hours,
                        floor: heist.cfg.steal_floor,
                        immuneFor: row ? shortDuration(row.immuneLeft) : undefined,
                        canBuyExtra: heist.canBuyExtra,
                      })
                    : heist.ready
                      ? 'That player is not in this season.'
                      : 'Checking the vault…'}
                </p>
              )}

              <div className="mt-4 flex flex-col gap-2">
                {reason === 'no_attempts' && heist.canBuyExtra ? (
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={() => void extra.run()}
                    disabled={extra.busy}
                  >
                    Buy one more attempt
                  </Button>
                ) : (
                  <Button variant="gold" size="lg" onClick={() => void rob()} disabled={!check?.ok}>
                    <MaskIcon className="size-5" />
                    Rob {name}
                    <Kbd>Enter</Kbd>
                  </Button>
                )}
                <AttemptsLine heist={heist} />
              </div>
            </motion.div>
          )}

          {step.kind === 'cracking' && (
            <motion.p
              key="cracking"
              className="text-center text-sm text-muted"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              aria-live="polite"
            >
              Cracking {name}’s vault…
              <span className="mt-1 block text-xs text-faint">
                Tap to skip<Kbd>Enter</Kbd>
              </span>
            </motion.p>
          )}

          {step.kind === 'result' && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{
                type: 'spring',
                stiffness: 420,
                damping: 30,
                delay: reduced ? 0 : 0.25,
              }}
            >
              <Ending
                answer={step.answer}
                name={name}
                immunityHours={heist.cfg.immunity_hours}
                big={step.bigHaul}
              />
              <div className="mt-5 flex gap-2">
                <Button variant="primary" size="lg" className="flex-1" onClick={closeSteal}>
                  Done<Kbd>Enter</Kbd>
                </Button>
                {heist.attemptsLeft > 0 && (
                  <Button size="lg" onClick={again}>
                    {fromPanel ? 'Rob someone else' : 'Pick another'}
                  </Button>
                )}
              </div>
              <div className="mt-2">
                <AttemptsLine heist={heist} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </SmoothHeight>

      {flight && <ChipFlight from={flight} onDone={() => setFlight(null)} />}
    </div>
  )
}

function FaceOff({
  me,
  target,
  targetName,
}: {
  me: StandingView | undefined
  target: StandingView | undefined
  targetName: string
}) {
  const mePlayer = usePlayer(me?.userId)
  const them = usePlayer(target?.userId)
  return (
    <div className="flex items-center justify-between gap-3 pr-8">
      <Side name={<span className="font-semibold">You</span>} rank={me?.rank} worth={me?.netWorth}>
        <Avatar player={mePlayer} size="md" />
      </Side>
      <span className="shrink-0 text-xs font-bold tracking-[0.2em] text-faint uppercase">vs</span>
      <Side
        name={them ? <PlayerName player={them} badge={false} /> : targetName}
        rank={target?.rank}
        worth={target?.netWorth}
        right
      >
        <Avatar player={them} size="md" />
      </Side>
    </div>
  )
}

function Side({
  name,
  rank,
  worth,
  right = false,
  children,
}: {
  name: ReactNode
  rank: number | undefined
  worth: number | undefined
  right?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={`flex min-w-0 flex-1 items-center gap-2.5 ${right ? 'flex-row-reverse text-right' : ''}`}
    >
      {children}
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm">{name}</p>
        <p className="text-xs whitespace-nowrap text-muted tabular-nums">
          {rank ? `#${rank}` : '–'}
          {worth !== undefined && <span className="text-faint"> · {formatChipsShort(worth)}</span>}
        </p>
      </div>
    </div>
  )
}

function Odds({
  label,
  tone,
  children,
}: {
  label: string
  tone: 'text' | 'gold' | 'loss'
  children: ReactNode
}) {
  const color = tone === 'gold' ? 'text-gold' : tone === 'loss' ? 'text-loss' : 'text-text'
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-md bg-surface-2 px-3 py-2">
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      <dd className={`min-w-0 text-right tabular-nums ${color}`}>{children}</dd>
    </div>
  )
}

function AttemptsLine({ heist }: { heist: ReturnType<typeof useHeist> }) {
  const state = heist.state
  if (!state) return null
  const allowed = state.me.attemptsAllowed
  return (
    <p className="flex items-center justify-center gap-2 text-xs text-muted">
      <Pips
        filled={heist.attemptsLeft}
        total={allowed}
        label={`${heist.attemptsLeft} of ${allowed} steal attempts left today`}
      />
      {heist.attemptsLeft === 1
        ? '1 attempt left today'
        : `${heist.attemptsLeft} attempts left today`}
    </p>
  )
}

function Ending({
  answer,
  name,
  immunityHours,
  big,
}: {
  answer: StealResponse
  name: string
  immunityHours: number
  big: boolean
}) {
  const { outcome, amount, fine } = answer.steal
  const immunity = hoursInWords(immunityHours)
  if (outcome === 'success') {
    return (
      <div className="text-center" role="status">
        <p className="text-xs font-bold tracking-[0.2em] text-gold uppercase">
          {big ? 'Big score' : 'Clean getaway'}
        </p>
        <p className={`mt-1 text-4xl font-black text-gold tabular-nums ${big ? 'heist-haul' : ''}`}>
          <span className="sr-only">+{formatChips(amount)}</span>
          <CountUp to={amount} prefix="+" />
        </p>
        <p className="mt-2 text-sm text-muted">
          You robbed {name}. They are immune for {immunity}.
        </p>
      </div>
    )
  }
  if (outcome === 'blocked') {
    return (
      <div className="text-center" role="status">
        <p
          className="text-xs font-bold tracking-[0.2em] uppercase"
          style={{ color: 'var(--heist-shield)' }}
        >
          Blocked
        </p>
        <p className="mt-1 text-2xl font-black">{name}’s shield stopped you</p>
        <p className="mt-2 text-sm text-muted">
          No fine, but the attempt is used. {name} is immune for {immunity}.
        </p>
      </div>
    )
  }
  return (
    <div className="text-center" role="status">
      <p className="text-xs font-bold tracking-[0.2em] text-loss uppercase">Caught</p>
      <p className="mt-1 text-4xl font-black text-loss tabular-nums">
        {fine > 0 ? `−${formatChips(fine)}` : '0'}
      </p>
      <p className="mt-2 text-sm text-muted">
        {fine > 0
          ? `You paid ${name} a ${chipCount(fine)} fine.`
          : 'Your wallet was empty, so there was no fine.'}
      </p>
    </div>
  )
}

/**
 * Grows and shrinks with the step inside, so the dialog glides between the
 * odds, the cracking and the ending instead of jumping.
 */
function SmoothHeight({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion() ?? false
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | 'auto'>('auto')
  useLayoutEffect(() => {
    const element = inner.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    // The padding keeps focus rings inside the clipped box.
    <motion.div
      className="-mx-1.5 -mb-1.5 overflow-hidden"
      initial={false}
      animate={{ height }}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 360, damping: 34 }}
    >
      <div ref={inner} className="px-1.5 pb-1.5">
        {children}
      </div>
    </motion.div>
  )
}

/** The haul counting up in whole chips, landing on the exact amount. */
function CountUp({ to, prefix }: { to: number; prefix: string }) {
  const reduced = useReducedMotion() ?? false
  const value = useMotionValue(reduced ? to : 0)
  const text = useTransform(value, (v) => `${prefix}${formatChips(v >= to ? to : Math.floor(v))}`)
  useEffect(() => {
    if (reduced) {
      value.jump(to)
      return
    }
    const controls = animate(value, to, { duration: 0.9, delay: 0.35, ease: [0.16, 1, 0.3, 1] })
    return () => controls.stop()
  }, [to, reduced, value])
  return <motion.span aria-hidden="true">{text}</motion.span>
}

const FLYING = 9

/** Gold chips fly from the vault up to the wallet in the top bar. */
function ChipFlight({ from, onDone }: { from: DOMRect; onDone: () => void }) {
  const [to] = useState(() => {
    const wallet = document.querySelector('[aria-label="Your chips"]')
    const rect = wallet?.getBoundingClientRect()
    return rect ? { x: rect.left + 14, y: rect.top + rect.height / 2 } : null
  })
  useEffect(() => {
    const timer = setTimeout(onDone, 1_300)
    return () => clearTimeout(timer)
  }, [onDone])
  if (!to) return null
  const start = { x: from.left + from.width / 2, y: from.top + from.height * 0.55 }
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden="true">
      {Array.from({ length: FLYING }, (_, i) => {
        const wobble = ((i * 37) % 60) - 30
        return (
          <motion.span
            key={i}
            className="absolute block h-3 w-5 rounded-[50%] bg-gold"
            style={{
              left: 0,
              top: 0,
              boxShadow: 'inset 0 -2px 0 color-mix(in oklab, var(--on-gold) 45%, transparent)',
            }}
            initial={{ x: start.x + wobble, y: start.y, opacity: 0, scale: 0.7 }}
            animate={{
              x: [start.x + wobble, start.x + wobble * 2, to.x],
              y: [start.y, start.y - 60 - (i % 3) * 20, to.y],
              opacity: [0, 1, 1, 0.2],
              scale: [0.7, 1.1, 0.6],
            }}
            transition={{ duration: 0.7, delay: i * 0.035, ease: [0.45, 0, 0.2, 1] }}
            onAnimationComplete={i === FLYING - 1 ? () => playSound('chip') : undefined}
          />
        )
      })}
    </div>,
    document.body,
  )
}
