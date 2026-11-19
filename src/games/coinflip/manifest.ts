/**
 * Coin flip's manifest: how the shell finds the room (spec: Manifests). The
 * room itself loads only when a player walks in.
 */
import '../../theme/games/coinflip.css'

import { CoinflipIcon } from '../../kit/icons.tsx'
import { defineGame } from '../../shell/manifests.ts'

export default defineGame({
  id: 'coinflip',
  name: 'Coin flip',
  order: 90,
  icon: CoinflipIcon,
  room: () => import('./Room.tsx'),
  howToPlay: [
    'Call heads or tails, type a bet and flip. Call it right and you win almost double your bet. Call it wrong and you lose the bet.',
    'A win pays twice your bet less the house edge, shown under the room’s name. Heads and tails are equally likely, and the server flips the coin at the moment you bet.',
    'Type an amount like 50, 2.5k, half or all, and press Enter or Space to flip. After each flip the cursor is back in the box, so you can keep going from the keyboard. Press Escape to leave the box, then H or T to pick a side.',
    'Everyone in the room watches your coin land on your seat. Wins of 10 times the bet or more, and every all-in, are posted in chat.',
  ],
})
