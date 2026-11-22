/**
 * Roulette's command in the message box (spec: Commands, Games > Roulette):
 * .roulette 50 red bets 50 on red. With no round open it opens one, and its
 * card appears in the stream for everyone; while one is open, the bet joins
 * it. Several bets go in one line with commas (.roulette 50 red, 25 17), and
 * a place without an amount takes the one before it (typed.ts). The amount
 * reads as the bet box reads it (50, 2.5k, half, all). The words come from
 * the command_roulette setting.
 */
import { CommandRefusal } from '../../kit/cards.ts'
import type { CommandSpec } from '../../shell/manifests.ts'
import { placeBets } from './stream.ts'
import { readBets } from './typed.ts'

export const ROULETTE_COMMANDS: readonly CommandSpec[] = [
  {
    key: 'command_roulette',
    args: 'bet space',
    example: '50 red',
    picks: ['red', 'black', 'odd', 'even'],
    description: 'Bet on the roulette wheel: joins the open round, or starts one.',
    check: (args, called) => {
      const read = readBets(args, called)
      return read.ok ? null : read.error
    },
    run: async ({ queryClient, me, args, called }) => {
      const read = readBets(args, called)
      if (!read.ok) throw new CommandRefusal(read.error)
      await placeBets(queryClient, me.id, read.bets)
    },
  },
]
