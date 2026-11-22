/**
 * The economy's commands in the message box (spec: Commands): .work, .slut
 * and .crime post their result for everyone (Tyton, Nov 22, 2026), so the
 * command shows nothing of its own; .collect answers the player alone. A
 * cooldown or an empty wallet comes back as the server's sentence, which
 * the message box shows above itself.
 */
import type { QueryClient } from '@tanstack/react-query'

import { chipCount } from '../../../shared/chips.ts'
import type {
  CollectResponse,
  IncomeCommand,
  IncomeResponse,
} from '../../../shared/features/economy.ts'
import { TIER_LABELS } from '../../../shared/tiers.ts'
import { api, ApiError, requestKey } from '../../kit/api.ts'
import { celebrate } from '../../kit/celebrate.tsx'
import { applyWallet, queryKeys } from '../../kit/queries.ts'
import { playSound } from '../../kit/sfx.ts'
import type { CommandContext, CommandSpec } from '../../shell/manifests.ts'
import { coolDown, economyKey, putEconomy } from './data.ts'

/** Refusals after which the cached economy, or the season, is out of date. */
const STALE = new Set(['nothing_to_collect', 'no_season', 'season_over', 'final_day'])

function refused(queryClient: QueryClient, error: unknown, command?: IncomeCommand): never {
  if (error instanceof ApiError) {
    const readyAt = error.extra.readyAt
    if (error.code === 'cooldown' && command && typeof readyAt === 'string') {
      coolDown(queryClient, command, readyAt)
    }
    if (STALE.has(error.code)) {
      void queryClient.invalidateQueries({ queryKey: economyKey })
      void queryClient.invalidateQueries({ queryKey: queryKeys.season })
    }
  }
  throw error
}

async function income({ queryClient }: CommandContext, command: IncomeCommand): Promise<void> {
  let answer: IncomeResponse
  try {
    answer = await api.post<IncomeResponse>(`/api/economy/${command}`, {}, { key: requestKey() })
  } catch (error) {
    refused(queryClient, error, command)
  }
  applyWallet(queryClient, answer.wallet)
  putEconomy(queryClient, answer.state)
  const { result } = answer
  if (result.posted) celebrate({ net: result.amount, big: true, note: 'Big score' })
  else playSound(result.outcome === 'fined' ? 'loss' : command === 'work' ? 'chip' : 'win')
}

async function collect({ queryClient, reply }: CommandContext): Promise<void> {
  let answer: CollectResponse
  try {
    answer = await api.post<CollectResponse>('/api/economy/collect', {}, { key: requestKey() })
  } catch (error) {
    refused(queryClient, error)
  }
  applyWallet(queryClient, answer.wallet)
  putEconomy(queryClient, answer.state)
  const { income: earned, bonus, streak } = answer.collected
  const parts: string[] = []
  if (earned > 0)
    parts.push(`${TIER_LABELS[answer.state.income.tier]} rank income ${chipCount(earned)}`)
  if (bonus > 0) parts.push(`day ${streak} streak bonus ${chipCount(bonus)}`)
  playSound(bonus > 0 ? 'win' : 'chip')
  reply({
    label: 'Collected',
    content: `You collected ${chipCount(earned + bonus)}${parts.length ? `: ${parts.join(' and ')}` : ''}.`,
  })
}

export const ECONOMY_COMMANDS: readonly CommandSpec[] = [
  {
    key: 'command_work',
    description: 'Earn a few chips. It never fails, and cools down for a few minutes.',
    run: (context) => income(context, 'work'),
  },
  {
    key: 'command_hustle',
    description: 'Riskier than work: more chips, or a fine.',
    run: (context) => income(context, 'hustle'),
  },
  {
    key: 'command_crime',
    description: 'A big payout or a big fine, with a long cooldown.',
    run: (context) => income(context, 'crime'),
  },
  {
    key: 'command_collect',
    description: 'Collect your rank income and daily streak bonus.',
    run: collect,
  },
]
