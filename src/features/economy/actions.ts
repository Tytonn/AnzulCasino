/**
 * What the player can do with the economy: press work, slut or crime,
 * collect, buy a rank, claim a challenge, grab a chat drop. Each sends one
 * request with its own idempotency key, then moves the top bar and the
 * economy to the server's answer at once (spec: Live events: "No waiting on
 * your own echo"). The buttons and the keyboard shortcuts share these, so a
 * click and a key press at the same moment send one request.
 */
import type { QueryClient } from '@tanstack/react-query'
import { create } from 'zustand'

import { chipCount, formatChips } from '../../../shared/chips.ts'
import {
  type ChallengeClaimResponse,
  type CollectResponse,
  type DropClaimResponse,
  type EconomyState,
  type IncomeCommand,
  type IncomeResponse,
  type TierResponse,
  type WalletAfter,
} from '../../../shared/features/economy.ts'
import type { SeasonState } from '../../../shared/seasons.ts'
import { type Tier, TIER_LABELS } from '../../../shared/tiers.ts'
import { api, ApiError, errorMessage, requestKey } from '../../kit/api.ts'
import { celebrate } from '../../kit/celebrate.tsx'
import { applyWallet, queryKeys } from '../../kit/queries.ts'
import { playSound } from '../../kit/sfx.ts'
import { toast } from '../../kit/toast.tsx'
import { coolDown, economyKey, putEconomy } from './data.ts'
import { CrimeIcon, HustleIcon, IncomeIcon, WorkIcon } from './icons.tsx'
import { showResult } from './ResultCard.tsx'

// ---------------------------------------------------------------- one at a time

const useBusyStore = create<{ busy: Readonly<Record<string, true>> }>(() => ({ busy: {} }))

/** Whether the action named `name` is waiting for the server. */
export function useBusy(name: string): boolean {
  return useBusyStore((s) => s.busy[name] === true)
}

/** Runs `work` unless the same action is already on its way. */
async function once<T>(name: string, work: () => Promise<T>): Promise<T | undefined> {
  if (useBusyStore.getState().busy[name]) return undefined
  useBusyStore.setState((s) => ({ busy: { ...s.busy, [name]: true } }))
  try {
    return await work()
  } finally {
    useBusyStore.setState((s) => {
      const { [name]: _done, ...rest } = s.busy
      return { busy: rest }
    })
  }
}

/** Codes after which the cached economy is out of date: fetch it again. */
const STALE = new Set([
  'nothing_to_collect',
  'top_tier',
  'not_next',
  'tier_locked',
  'tier_bought_today',
  'no_challenge',
  'challenge_claimed',
  'challenge_not_done',
  'no_drop',
  'drop_closed',
  'drop_claimed',
  'drop_empty',
])

/** Codes that mean the season moved on: the season and the economy are both stale. */
const SEASON = new Set(['no_season', 'season_over', 'season_not_started', 'final_day'])

function refused(queryClient: QueryClient, error: unknown, command?: IncomeCommand): void {
  if (error instanceof ApiError) {
    const readyAt = error.extra.readyAt
    if (error.code === 'cooldown' && command && typeof readyAt === 'string') {
      coolDown(queryClient, command, readyAt)
    }
    if (STALE.has(error.code)) void queryClient.invalidateQueries({ queryKey: economyKey })
    if (SEASON.has(error.code)) {
      void queryClient.invalidateQueries({ queryKey: economyKey })
      void queryClient.invalidateQueries({ queryKey: queryKeys.season })
    }
  }
  toast.error(errorMessage(error))
}

/** Moves the top bar and the economy to the server's answer. */
function landed(queryClient: QueryClient, answer: { wallet: WalletAfter; state: EconomyState }) {
  applyWallet(queryClient, answer.wallet)
  putEconomy(queryClient, answer.state)
}

// ---------------------------------------------------------------- work, slut and crime

export const COMMAND_ICONS = { work: WorkIcon, hustle: HustleIcon, crime: CrimeIcon } as const
export const COMMAND_TONES = {
  work: 'var(--economy-work)',
  hustle: 'var(--economy-hustle)',
  crime: 'var(--economy-crime)',
} as const

/** Presses work, slut or crime and shows what happened under the button. */
export function press(
  queryClient: QueryClient,
  command: IncomeCommand,
  name: string,
  anchor: Element | null,
): Promise<IncomeResponse | undefined> {
  return once(command, async () => {
    try {
      const answer = await api.post<IncomeResponse>(
        `/api/economy/${command}`,
        {},
        { key: requestKey() },
      )
      landed(queryClient, answer)
      const { result } = answer
      const paid = result.outcome === 'paid'
      const notes: string[] = []
      if (!paid && result.amount < result.drawn) {
        notes.push(
          result.amount === 0
            ? `The fine was ${chipCount(result.drawn)}, but your wallet was empty.`
            : `The fine was ${chipCount(result.drawn)}, but your wallet only had ${chipCount(result.amount)}.`,
        )
      }
      if (result.posted) notes.push('A score that big made the chat.')
      if (result.posted) celebrate({ net: result.amount, big: true, note: 'Big score' })
      else playSound(!paid ? 'loss' : command === 'work' ? 'chip' : 'win')
      showResult(
        {
          title: name,
          icon: COMMAND_ICONS[command],
          tone: COMMAND_TONES[command],
          amount: paid ? result.amount : -result.amount,
          line: result.line,
          notes,
          readyAt: result.readyAt,
          readyLabel: name,
        },
        anchor,
      )
      return answer
    } catch (error) {
      refused(queryClient, error, command)
      return undefined
    }
  })
}

// ---------------------------------------------------------------- collect

/** Collects rank income and today's streak bonus. */
export function collect(
  queryClient: QueryClient,
  anchor: Element | null,
): Promise<CollectResponse | undefined> {
  return once('collect', async () => {
    try {
      const answer = await api.post<CollectResponse>(
        '/api/economy/collect',
        {},
        { key: requestKey() },
      )
      landed(queryClient, answer)
      const { income, bonus, streak } = answer.collected
      const tier = answer.state.income.tier
      const notes: string[] = []
      if (income > 0) notes.push(`${TIER_LABELS[tier]} rank income: ${chipCount(income)}.`)
      if (bonus > 0) {
        const maxed = answer.state.streak.bonus >= answer.state.streak.maxBonus
        notes.push(
          `Day ${streak} streak bonus: ${chipCount(bonus)}${maxed ? ', the most it pays' : ''}.`,
        )
      }
      playSound(bonus > 0 ? 'win' : 'chip')
      showResult(
        {
          title: 'Collected',
          icon: IncomeIcon,
          tone: 'var(--gold)',
          amount: income + bonus,
          line: null,
          notes,
          readyAt: null,
          readyLabel: null,
        },
        anchor,
      )
      return answer
    } catch (error) {
      refused(queryClient, error)
      return undefined
    }
  })
}

// ---------------------------------------------------------------- ranks

/** Buys the next rank up. The buttons ask twice first. */
export function buyRank(queryClient: QueryClient, tier: Tier): Promise<TierResponse | undefined> {
  return once('tier', async () => {
    try {
      const answer = await api.post<TierResponse>(
        '/api/economy/tier',
        { tier },
        { key: requestKey() },
      )
      landed(queryClient, answer)
      // The badge and name color change everywhere at once; the live news confirms it.
      queryClient.setQueryData<SeasonState>(queryKeys.season, (old) =>
        old?.wallet ? { ...old, wallet: { ...old.wallet, tier } } : old,
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.players })
      playSound('sparkle')
      toast.good(
        `You are ${TIER_LABELS[tier]} now: ${formatChips(answer.bought.income)} a day in income.`,
      )
      return answer
    } catch (error) {
      refused(queryClient, error)
      return undefined
    }
  })
}

// ---------------------------------------------------------------- challenges

/** Claims a finished challenge's reward. */
export function claimChallenge(
  queryClient: QueryClient,
  index: number,
  text: string,
): Promise<ChallengeClaimResponse | undefined> {
  return once(`challenge:${index}`, async () => {
    try {
      const answer = await api.post<ChallengeClaimResponse>(
        '/api/economy/challenges/claim',
        { index },
        { key: requestKey() },
      )
      landed(queryClient, answer)
      playSound('win')
      toast.good(`+${chipCount(answer.claimed.reward)} for “${text}”.`)
      return answer
    } catch (error) {
      refused(queryClient, error)
      return undefined
    }
  })
}

// ---------------------------------------------------------------- chat drops

/** Grabs a share of a chat drop. */
export function grabDrop(
  queryClient: QueryClient,
  dropId: number,
): Promise<DropClaimResponse | undefined> {
  return once(`drop:${dropId}`, async () => {
    try {
      const answer = await api.post<DropClaimResponse>(
        '/api/economy/drops/claim',
        { dropId },
        { key: requestKey() },
      )
      landed(queryClient, answer)
      playSound('win')
      toast.good(`You grabbed ${chipCount(answer.claimed.amount)} from the chat drop.`)
      return answer
    } catch (error) {
      refused(queryClient, error)
      return undefined
    }
  })
}
