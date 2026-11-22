/**
 * Coin flip's manifest: how the shell finds the game (spec: Manifests). Its
 * card in the stream, its replay and the classic room load only when first
 * needed; the command and the colors load with the shell.
 */
import '../../theme/games/coinflip.css'

import { CoinflipIcon } from '../../kit/icons.tsx'
import { defineGame } from '../../shell/manifests.ts'
import { COINFLIP_COMMANDS } from './commands.ts'

export default defineGame({
  id: 'coinflip',
  name: 'Coin flip',
  order: 90,
  icon: CoinflipIcon,
  room: () => import('./Room.tsx'),
  card: () => import('./StreamCard.tsx'),
  replay: () => import('./Replay.tsx'),
  commands: COINFLIP_COMMANDS,
  roundName: ['flip', 'flips'],
  howToPlay: [
    'Call heads or tails and flip at your bet: type .flip 50 heads, or .flip t 50. Call it right and you win almost double your bet. Call it wrong and you lose the bet.',
    'A win pays twice your bet less the house edge. Heads and tails are equally likely, and the server flips the coin at the moment you bet.',
    'Type an amount like 50, 2.5k, half or all. With no side, you call the one you called last. After a flip, press Space or Enter to flip again at the same bet, H or T to change your call first, or type a new bet in the box.',
    'Everyone in the stream watches your coin land on its card. Wins of 10 times the bet or more, and every all-in, stay open in the stream.',
  ],
})
