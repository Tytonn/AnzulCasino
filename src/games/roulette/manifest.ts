/**
 * Roulette's manifest: how the shell finds the room (spec: Manifests). The
 * room and the replay load only when needed; the colors and the Floor
 * card's small wheel come with the Floor.
 */
import '../../theme/games/roulette.css'

import { RouletteIcon } from '../../kit/icons.tsx'
import { defineGame } from '../../shell/manifests.ts'
import { CardArt } from './CardArt.tsx'

export default defineGame({
  id: 'roulette',
  name: 'Roulette',
  order: 20,
  icon: RouletteIcon,
  cardArt: CardArt,
  room: () => import('./Room.tsx'),
  replay: () => import('./Replay.tsx'),
  howToPlay: [
    'One wheel for everyone. Each spin opens for bets for a few seconds, then the wheel spins and the ball lands on a number from 0 to 36. Chips leave your wallet as you place them, and you can take them back until betting closes.',
    'Pick a chip size from the rack, then click a place on the table to put a chip there, or tap it on a phone. Right-click a place, or hold a finger on it, to take your chips off. The lines between numbers are splits, streets, corners and six lines.',
    'Or type in the quick-bet box: an amount and a place, like 200 odd, 600 2nd, 50 17 or all red, and press Enter. It knows a number, red, black, odd, even, 1-18, 19-36, the dozens 1-12, 13-24 and 25-36, and the columns 1st, 2nd and 3rd. Put several in one line with commas: 50 red, 10 17. A place alone bets your chip size there.',
    'A number pays 35 to 1, a split 17, a street 11, a corner 8 and a six line 5. A dozen or a column pays 2 to 1, and red, black, odd, even, 1-18 and 19-36 pay 1 to 1. The single green zero loses every outside bet: that is the 2.7% house edge.',
    'Keys: U undo, C clear, R repeat your last spin’s bets, D double them, Enter places what you typed. Everyone’s chips sit on the table in their own color, the strip by the wheel shows the last 12 numbers, and big wins go to chat.',
  ],
})
