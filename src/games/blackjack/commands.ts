/**
 * Blackjack's command in the message box (spec: Commands): .bj 50 deals a
 * hand at the bet typed after it, as the bet box reads it (50, 2.5k, half,
 * all), and the hand's card opens in the stream with the keys. The words
 * come from the command_blackjack setting.
 */
import type { CommandSpec } from '../../shell/manifests.ts'
import { dealHand } from './stream.ts'

export const BLACKJACK_COMMANDS: readonly CommandSpec[] = [
  {
    key: 'command_blackjack',
    args: 'bet',
    example: '50',
    needs: 'amount',
    description: 'Deal a hand of blackjack at your bet.',
    run: ({ queryClient, me, args }) => dealHand(queryClient, me.id, args),
  },
]
