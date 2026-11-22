/**
 * Every command in the message box, in the order the list shows them: each
 * game's from its manifest, each feature's, the shell's own (.bal, .lb,
 * .shop, .help and .admin), then a stand-in for each game whose card has
 * not landed yet.
 *
 * .bal and .lb answer the player alone, from the leaderboard the page
 * already has, or post for everyone through POST /api/stream/lookup, as the
 * stream_bal_lb setting says (Tyton, Nov 22, 2026).
 */
import type { QueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { LookupSnapshot } from '../../../shared/chat.ts'
import type { ConfigValues } from '../../../shared/config.ts'
import type { PlayerSummary } from '../../../shared/players.ts'
import type { LeaderboardView } from '../../../shared/seasons.ts'
import type { Wire } from '../../../shared/wire.ts'
import { api, ApiError } from '../../kit/api.ts'
import { CommandRefusal } from '../../kit/cards.ts'
import { queryKeys, useConfig, useMe } from '../../kit/queries.ts'
import type { CommandContext, CommandSpec } from '../manifests.ts'
import { features, gameCommandKey, games } from '../registry.ts'
import { type Command, findPlayer, resolveCommands } from './commands.ts'
import { BalanceView, BoardView } from './lookups.tsx'

const BOARD_TOP = 5

function config(queryClient: QueryClient): Wire<ConfigValues> | undefined {
  return queryClient.getQueryData<Wire<ConfigValues>>(queryKeys.config)
}

function board(queryClient: QueryClient): Promise<LeaderboardView> {
  return queryClient.ensureQueryData({
    queryKey: queryKeys.leaderboard,
    queryFn: () => api.get<LeaderboardView>('/api/leaderboard'),
  })
}

/** Posts the lookup for everyone. False when the setting turned private meanwhile. */
async function postLookup(context: CommandContext, body: object): Promise<boolean> {
  if (config(context.queryClient)?.stream_bal_lb !== 'public') return false
  try {
    await api.post('/api/stream/lookup', body)
    return true
  } catch (error) {
    if (error instanceof ApiError && error.code === 'lookup_private') {
      void context.queryClient.invalidateQueries({ queryKey: queryKeys.config })
      return false
    }
    throw error
  }
}

async function balance(context: CommandContext): Promise<void> {
  const { queryClient, me, args } = context
  let userId = me.id
  if (args) {
    const players = queryClient.getQueryData<PlayerSummary[]>(queryKeys.players)
    const found = findPlayer(players, args)
    if (!found) throw new CommandRefusal(`Nobody called ${args} is playing.`)
    userId = found.id
  }
  if (
    await postLookup(
      context,
      args ? { what: 'balance', player: args.replace(/^@/, '') } : { what: 'balance' },
    )
  ) {
    return
  }
  const { standings } = await board(queryClient)
  const row = standings.find((s) => s.userId === userId)
  if (!row) {
    throw new CommandRefusal(
      userId === me.id ? 'You have no chips this season.' : `${args} has no chips this season.`,
    )
  }
  const lookup: LookupSnapshot = {
    kind: 'balance',
    userId,
    balance: row.balance,
    vault: row.vault,
    tier: row.tier,
    rank: row.rank,
  }
  context.reply({
    label: userId === me.id ? 'Your balance' : 'Their balance',
    content: <BalanceView lookup={lookup} players={standings.length} />,
  })
}

async function leaderboard(context: CommandContext): Promise<void> {
  if (await postLookup(context, { what: 'leaderboard' })) return
  const { standings } = await board(context.queryClient)
  const lookup: LookupSnapshot = {
    kind: 'leaderboard',
    rows: standings
      .slice(0, BOARD_TOP)
      .map((s) => ({ userId: s.userId, rank: s.rank, netWorth: s.netWorth })),
    players: standings.length,
  }
  context.reply({ label: 'Leaderboard', content: <BoardView lookup={lookup} /> })
}

function HelpList({ commands, prefix }: { commands: readonly Command[]; prefix: string }) {
  return (
    <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
      {commands.map((command) => (
        <li key={command.key} className="contents">
          <span className="font-mono text-[0.8rem] font-semibold whitespace-nowrap text-text">
            {prefix}
            {command.words[0]}
            {command.spec.args && (
              <span className="font-normal text-faint">
                {' '}
                {command.spec.example ?? command.spec.args}
              </span>
            )}
          </span>
          <span className="pb-1 text-muted sm:pb-0">
            {command.spec.description}
            {command.words.length > 1 && (
              <span className="text-faint">
                {' '}
                Also{' '}
                {command.words
                  .slice(1)
                  .map((w) => `${prefix}${w}`)
                  .join(', ')}
                .
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

function help(context: CommandContext): void {
  const values = config(context.queryClient)
  const prefix = values?.command_prefix ?? '.'
  const commands = visibleCommands(resolveCommands(allCommandSpecs, values), context.me.role)
  context.reply({ label: 'Commands', content: <HelpList commands={commands} prefix={prefix} /> })
}

/** A stand-in for a game with no card yet: its room for now, or a word that it is coming. */
function standIn(game: (typeof games)[number]): CommandSpec | null {
  const key = gameCommandKey(game.id)
  if (!key) return null
  if (!game.manifest) {
    return {
      key,
      soon: true,
      description: `${game.pitch} Coming soon.`,
      run: () => {
        throw new CommandRefusal(`${game.name} is coming soon.`)
      },
    }
  }
  return {
    key,
    description: `${game.pitch} Opens its room for now.`,
    run: (context) => context.navigate(`/room/${game.id}`),
  }
}

const SHELL_COMMANDS: readonly CommandSpec[] = [
  {
    key: 'command_balance',
    args: 'player',
    example: 'alice',
    description: 'Your chips, vault, rank and place, or another player’s.',
    run: balance,
  },
  {
    key: 'command_leaderboard',
    description: 'The top of the leaderboard.',
    run: leaderboard,
  },
  {
    key: 'command_shop',
    description: 'Opens the shop: shields, ranks and extra steals.',
    run: (context) => context.navigate('/shop'),
  },
  {
    key: 'command_help',
    description: 'Every command, with what it does.',
    run: help,
  },
  {
    key: 'command_admin',
    adminOnly: true,
    description: 'Opens the admin panel.',
    run: (context) => context.navigate('/admin'),
  },
]

/**
 * Every command, in the order the list shows them: games with a card, the
 * features', the shell's, then games that open their room or are still to
 * come.
 */
export const allCommandSpecs: readonly CommandSpec[] = [
  ...games.flatMap((game) => game.manifest?.commands ?? []),
  ...features.flatMap((feature) => feature.commands ?? []),
  ...SHELL_COMMANDS,
  ...games
    .filter((game) => !game.manifest?.commands?.length)
    .flatMap((game) => [standIn(game)].filter((c) => c !== null)),
]

export function visibleCommands(commands: readonly Command[], role: string): Command[] {
  return commands.filter((c) => !c.spec.adminOnly || role === 'admin')
}

/** The commands this player can use, with their words from the settings. */
export function useCommands(): { commands: Command[]; prefix: string } {
  const { data: values } = useConfig()
  const me = useMe()
  return useMemo(
    () => ({
      commands: visibleCommands(resolveCommands(allCommandSpecs, values), me.role),
      prefix: values?.command_prefix ?? '.',
    }),
    [values, me.role],
  )
}
