/**
 * The heist's commands in the message box (spec: Commands): .rob opens the
 * steal on a player, or the list of targets; .dep and .with move chips
 * between the wallet and the vault and answer the player alone.
 */
import type { PlayerSummary } from '../../../shared/players.ts'
import { chipCount } from '../../../shared/chips.ts'
import type { VaultDirection, VaultResponse } from '../../../shared/features/heist.ts'
import { api, requestKey } from '../../kit/api.ts'
import { CommandRefusal } from '../../kit/cards.ts'
import { applyWallet, queryKeys } from '../../kit/queries.ts'
import { playSound } from '../../kit/sfx.ts'
import type { CommandContext, CommandSpec } from '../../shell/manifests.ts'
import { heistKeys, patchHeist, useHeistUi } from './data.ts'

function playerCalled(context: CommandContext, typed: string): PlayerSummary {
  const players = context.queryClient.getQueryData<PlayerSummary[]>(queryKeys.players) ?? []
  const wanted = typed.replace(/^@/, '').toLowerCase()
  const exact = players.find(
    (p) => p.username.toLowerCase() === wanted || p.displayName.toLowerCase() === wanted,
  )
  const starts = players.filter(
    (p) =>
      p.username.toLowerCase().startsWith(wanted) || p.displayName.toLowerCase().startsWith(wanted),
  )
  const found = exact ?? (starts.length === 1 ? starts[0] : undefined)
  if (!found) throw new CommandRefusal(`Nobody called ${typed} is playing.`)
  return found
}

function rob(context: CommandContext): void {
  const ui = useHeistUi.getState()
  if (!context.args) {
    ui.openPanel('rob')
    return
  }
  const target = playerCalled(context, context.args)
  if (target.id === context.me.id) throw new CommandRefusal('You cannot rob yourself.')
  ui.rob(target.id)
}

async function vault(context: CommandContext, direction: VaultDirection): Promise<void> {
  const answer = await api
    .post<VaultResponse>(
      '/api/heist/vault',
      { direction, amount: context.args },
      { key: requestKey() },
    )
    .catch((error: unknown) => {
      void context.queryClient.invalidateQueries({ queryKey: heistKeys.state })
      throw error
    })
  applyWallet(context.queryClient, answer.wallet)
  patchHeist(context.queryClient, (s) => ({ ...s, me: { ...s.me, vaultMoved: true } }))
  playSound('chip')
  setTimeout(() => playSound('block'), 260)
  context.reply({
    label: direction === 'deposit' ? 'Vault' : 'Wallet',
    content:
      direction === 'deposit'
        ? `${chipCount(answer.amount)} locked in your vault, safe from steals.`
        : `${chipCount(answer.amount)} back in your wallet, ready to bet.`,
  })
}

export const HEIST_COMMANDS: readonly CommandSpec[] = [
  {
    key: 'command_rob',
    args: 'player',
    example: 'alice',
    description: "Try to steal from a player's wallet. Alone, it lists who you can rob.",
    run: rob,
  },
  {
    key: 'command_deposit',
    args: 'amount',
    example: '100',
    needs: 'amount',
    description: 'Lock chips in your vault, safe from steals.',
    run: (context) => vault(context, 'deposit'),
  },
  {
    key: 'command_withdraw',
    args: 'amount',
    example: '100',
    needs: 'amount',
    description: 'Take chips out of your vault to bet them.',
    run: (context) => vault(context, 'withdraw'),
  },
]
