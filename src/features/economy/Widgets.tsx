/**
 * The economy's top-bar buttons, in every room on desktop and phone (spec:
 * Work and crime: "reachable from every room without leaving the game, with
 * the cooldown shown on the button"; Ranks: "claimed with a Collect button
 * in the top bar"):
 *
 *   Collect · [Work | Slut | Crime] · Daily
 *
 * Each is an icon over one short value: the name when it can be pressed,
 * the countdown while it cools down, what Collect would pay. They share the
 * bar with the wallet, the season clock and the heist's widgets, so they
 * stay small: about 3.4rem each, 3.1rem below 1100px and on a phone. The
 * full name is in each button's label.
 */
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { type CSSProperties, type ReactNode, useRef } from 'react'

import { formatChips } from '../../../shared/chips.ts'
import { commandName, type IncomeCommand } from '../../../shared/features/economy.ts'
import { TIER_LABELS } from '../../../shared/tiers.ts'
import { useNow } from '../../kit/clock.ts'
import { FlameIcon, type Icon } from '../../kit/icons.tsx'
import { useConfig } from '../../kit/queries.ts'
import { toast } from '../../kit/toast.tsx'
import type { SlotProps } from '../../shell/manifests.ts'
import { COMMAND_ICONS, COMMAND_TONES, collect, press, useBusy } from './actions.ts'
import { useDailyPanel } from './DailyPanel.tsx'
import {
  incomeNow,
  longWait,
  msUntil,
  perDayText,
  shortWait,
  useEconomy,
  useHustleName,
} from './data.ts'
import { DailyIcon, IncomeIcon } from './icons.tsx'
import { shortcutHint } from './keys.ts'

type Props = SlotProps['top-bar']

// ---------------------------------------------------------------- the shared button

/** Where a button sits: on its own, or in the joined group of three. */
type Place = 'alone' | 'first' | 'middle' | 'last'

const ROUND: Record<Place, string> = {
  alone: 'rounded-md',
  first: 'rounded-l-md',
  middle: '-ml-px',
  last: '-ml-px rounded-r-md',
}

interface WidgetProps {
  compact: boolean
  /** A color variable for the icon and the lit look. */
  tone: string
  /** Lit up: ready to press, or something to collect or claim. */
  lit: boolean
  icon: Icon
  /** One short value under the icon. */
  value: ReactNode
  /** What a screen reader and the tooltip say: the full story. */
  name: string
  busy?: boolean
  /** 0 to 1, a thin bar along the bottom: how far a cooldown has run. */
  progress?: number | null
  /** A small mark on the icon, such as challenges to claim. */
  badge?: ReactNode
  onClick: (button: HTMLButtonElement) => void
  data: string
  place?: Place
}

function Widget({
  compact,
  tone,
  lit,
  icon: Glyph,
  value,
  name,
  busy = false,
  progress = null,
  badge,
  onClick,
  data,
  place = 'alone',
}: WidgetProps) {
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={ref}
      type="button"
      data-economy={data}
      aria-label={name}
      aria-busy={busy}
      title={name}
      onClick={() => ref.current && onClick(ref.current)}
      style={{ '--tone': tone } as CSSProperties}
      className={`group relative flex shrink-0 flex-col items-center justify-center gap-1 overflow-hidden border px-2 transition duration-150 select-none active:scale-[0.96] ${
        compact ? 'h-10 min-w-[3.1rem]' : 'h-11 min-w-[3.1rem] desk:min-w-[3.4rem]'
      } ${ROUND[place]} ${
        lit
          ? 'z-10 border-[color-mix(in_oklab,var(--tone)_55%,var(--border))] bg-[color-mix(in_oklab,var(--tone)_13%,var(--surface-2))] hover:bg-[color-mix(in_oklab,var(--tone)_22%,var(--surface-2))]'
          : 'border-border bg-surface-2/40 hover:z-10 hover:border-border-strong hover:bg-surface-2'
      }`}
    >
      <span className="relative">
        <motion.span
          key={lit ? 'lit' : 'dim'}
          className={`block ${busy ? 'animate-pulse' : ''} ${lit ? 'text-(--tone)' : 'text-faint group-hover:text-muted'}`}
          initial={{ scale: lit ? 0.5 : 1 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 600, damping: 18 }}
        >
          <Glyph className={compact ? 'size-4' : 'size-4 desk:size-[1.15rem]'} />
        </motion.span>
        {badge}
      </span>
      <span
        className={`leading-none font-semibold whitespace-nowrap tabular-nums ${
          compact ? 'text-[0.66rem]' : 'text-[0.66rem] desk:text-[0.72rem]'
        } ${lit ? 'text-text' : 'text-muted'}`}
      >
        {value}
      </span>
      {progress !== null && (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-0 h-0.5 bg-[color-mix(in_oklab,var(--tone)_70%,transparent)] transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      )}
    </button>
  )
}

function WidgetSkeleton({ compact, place = 'alone' }: { compact: boolean; place?: Place }) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton block shrink-0 ${compact ? 'h-10 w-[3.1rem]' : 'h-11 w-[3.1rem] desk:w-[3.4rem]'} ${ROUND[place]}`}
    />
  )
}

/** A small round mark on a widget's icon. */
function Badge({ children, tone = 'gold' }: { children: ReactNode; tone?: 'gold' | 'flame' }) {
  return (
    <motion.span
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 700, damping: 20 }}
      className={`absolute -top-1.5 -right-2.5 grid size-3.5 place-items-center rounded-full text-[0.55rem] leading-none font-black ring-2 ring-surface-1 ${
        tone === 'gold' ? 'bg-gold text-on-gold' : 'bg-(--economy-flame) text-on-gold'
      }`}
    >
      {children}
    </motion.span>
  )
}

// ---------------------------------------------------------------- work, slut and crime

const COOLDOWN_KEYS = {
  work: 'work_cooldown_minutes',
  hustle: 'hustle_cooldown_minutes',
  crime: 'crime_cooldown_minutes',
} as const

function CommandWidget({
  command,
  compact,
  place,
}: { command: IncomeCommand; place: Place } & Props) {
  const { data: state, isPending } = useEconomy()
  const queryClient = useQueryClient()
  const hustleName = useHustleName()
  const config = useConfig().data
  const busy = useBusy(command)
  const now = useNow().getTime()

  if (isPending) return <WidgetSkeleton compact={compact} place={place} />
  if (!state) return null

  const name = commandName(command, hustleName)
  const left = msUntil(state.cooldowns[command], now)
  const ready = left <= 0
  const minutes = config?.[COOLDOWN_KEYS[command]]
  const span = typeof minutes === 'number' && minutes > 0 ? minutes * 60_000 : null
  const progress = ready || span === null ? null : Math.min(1, Math.max(0, 1 - left / span))

  return (
    <Widget
      compact={compact}
      data={command}
      place={place}
      tone={COMMAND_TONES[command]}
      lit={ready}
      icon={COMMAND_ICONS[command]}
      value={ready ? name : compact ? shortWait(left) : longWait(left)}
      name={
        ready
          ? `${name}: ready${shortcutHint(command, hustleName)}`
          : `${name}: ready in ${longWait(left)}`
      }
      busy={busy}
      progress={progress}
      onClick={(button) => {
        if (!ready) {
          toast.info(`${name} is ready again in ${longWait(left)}.`)
          return
        }
        void press(queryClient, command, name, button)
      }}
    />
  )
}

/** Work, slut and crime, joined in one group of three. */
export function JobsWidget({ compact }: Props) {
  const { data: state, isPending } = useEconomy()
  const hustleName = useHustleName()
  if (!isPending && !state) return null
  return (
    <div role="group" aria-label={`Work, ${hustleName} and crime`} className="flex shrink-0">
      <CommandWidget command="work" compact={compact} place="first" />
      <CommandWidget command="hustle" compact={compact} place="middle" />
      <CommandWidget command="crime" compact={compact} place="last" />
    </div>
  )
}

// ---------------------------------------------------------------- collect

export function CollectWidget({ compact }: Props) {
  const { data: state, isPending } = useEconomy()
  const queryClient = useQueryClient()
  const busy = useBusy('collect')
  const now = useNow().getTime()

  if (isPending) return <WidgetSkeleton compact={compact} />
  if (!state) return null

  const waiting = incomeNow(state, now)
  const has = waiting.total > 0
  const bonus = waiting.bonus > 0
  const tier = TIER_LABELS[state.income.tier]
  const name = has
    ? `Collect ${formatChips(waiting.total)}: ${tier} rank income${bonus ? ` and today's streak bonus` : ''}${shortcutHint('collect')}`
    : `Collect: income builds at ${perDayText(state.income.perDay)}`

  return (
    <Widget
      compact={compact}
      data="collect"
      tone="var(--gold)"
      lit={has}
      icon={IncomeIcon}
      value={`+${formatChips(waiting.total)}`}
      name={name}
      busy={busy}
      badge={
        bonus ? (
          <Badge tone="flame">
            <FlameIcon className="size-2.5" aria-hidden="true" />
          </Badge>
        ) : null
      }
      onClick={(button) => {
        if (!has) {
          toast.info(`Nothing to collect yet. Income builds at ${perDayText(state.income.perDay)}.`)
          return
        }
        void collect(queryClient, button)
      }}
    />
  )
}

// ---------------------------------------------------------------- daily

export function DailyWidget({ compact }: Props) {
  const { data: state, isPending } = useEconomy()
  const panel = useDailyPanel()

  if (isPending) return <WidgetSkeleton compact={compact} />
  if (!state) return null

  const list = state.challenges.list
  const done = list.filter((c) => c.done).length
  const toClaim = list.filter((c) => c.done && !c.claimed).length
  const streak = state.streak.claimedToday ? state.streak.days : 0

  return (
    <Widget
      compact={compact}
      data="daily"
      tone="var(--gold)"
      lit={toClaim > 0}
      icon={DailyIcon}
      value={`${done}/${list.length}`}
      name={`Daily: ${done} of ${list.length} challenges done${toClaim > 0 ? `, ${toClaim} to claim` : ''}${streak > 0 ? `, day ${streak} of your streak` : ''}${shortcutHint('daily')}`}
      badge={toClaim > 0 ? <Badge>{toClaim}</Badge> : null}
      onClick={(button) => panel.toggle(button)}
    />
  )
}
