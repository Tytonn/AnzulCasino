/**
 * Coin flip's command in the message box (spec: Commands): .flip 50 heads
 * flips a coin at the bet, as the bet box reads it (50, 2.5k, half, all),
 * calling the side named, before or after the bet (.flip t 50). With no
 * side it calls the one you called last, heads at first. The flip's card
 * opens in the stream with the keys. The words come from the
 * command_coinflip setting.
 */
import { SIDES, type Side } from '../../../shared/games/coinflip.ts'
import type { CommandSpec } from '../../shell/manifests.ts'
import { flipCoin, lastCalled } from './stream.ts'

function isSide(choice: string | null): choice is Side {
  return (SIDES as readonly (string | null)[]).includes(choice)
}

export const COINFLIP_COMMANDS: readonly CommandSpec[] = [
  {
    key: 'command_coinflip',
    args: 'bet side',
    example: '50 heads',
    needs: 'amount',
    choices: [
      ['heads', 'h'],
      ['tails', 't'],
    ],
    description: 'Flip a coin at your bet, calling heads or tails.',
    run: async ({ queryClient, me, args, choice }) => {
      await flipCoin(queryClient, me.id, args, isSide(choice) ? choice : lastCalled())
    },
  },
]
