/**
 * Roulette's manifest: how the shell finds the game (spec: Manifests). A
 * round is shared by everyone at the table, so it has one card in the
 * stream (`sharedCard`) and a replay for its folded line; a player's own
 * part in a round replays from History. The cards load only when first
 * needed; the command, the colors and the Floor card's small wheel load
 * with the shell.
 */
import '../../theme/games/roulette.css'

import { RouletteIcon } from '../../kit/icons.tsx'
import { defineGame } from '../../shell/manifests.ts'
import { CardArt } from './CardArt.tsx'
import { ROULETTE_COMMANDS } from './commands.ts'

export default defineGame({
  id: 'roulette',
  name: 'Roulette',
  order: 20,
  icon: RouletteIcon,
  cardArt: CardArt,
  sharedCard: () => import('./SharedCard.tsx'),
  sharedReplay: () => import('./SharedReplay.tsx'),
  replay: () => import('./Replay.tsx'),
  commands: ROULETTE_COMMANDS,
  roundName: ['round', 'rounds'],
  howToPlay: [
    'One round at a time, for everyone. Type .roulette 50 red to bet: with no round open, your bet starts one and its card appears in the stream for everyone; while a round is open, your bet joins it.',
    'Betting closes 15 seconds after the latest bet, so each new bet starts the countdown again, and at the latest 60 seconds after the first. Then the server draws the number.',
    'Bet on a number from 0 to 36, red, black, odd, even, 1-18, 19-36, the dozens 1-12, 13-24 and 25-36, or the columns 1st, 2nd and 3rd. Bet as often as you like while the round is open, or put several in one line with commas: .roulette 50 red, 25 17. Chips leave your wallet as you bet, and a bet cannot be taken back.',
    'A number pays 35 to 1. A dozen or a column pays 2 to 1, and red, black, odd, even, 1-18 and 19-36 pay 1 to 1. The single green zero loses every outside bet: that is the 2.7% house edge.',
    'The result pops up on the card: the number large, on a ball of its color, and every player with what they won or lost, winners first.',
  ],
})
