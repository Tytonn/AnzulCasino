/**
 * Blackjack's manifest: how the shell finds the room (spec: Manifests). The
 * room loads only when a player walks in; the colors and the Floor card's
 * art load with the Floor.
 */
import '../../theme/games/blackjack.css'

import { BlackjackIcon } from '../../kit/icons.tsx'
import { defineGame } from '../../shell/manifests.ts'
import FloorArt from './FloorArt.tsx'

export default defineGame({
  id: 'blackjack',
  name: 'Blackjack',
  order: 10,
  icon: BlackjackIcon,
  room: () => import('./Room.tsx'),
  cardArt: FloorArt,
  replay: () => import('./Replay.tsx'),
  howToPlay: [
    'Get closer to 21 than the dealer without going over. Cards 2 to 10 count their number, jacks, queens and kings count 10, and an ace counts 1 or 11, whichever helps.',
    'Type a bet and deal. Then hit (H) for another card, stand (S) to keep your total, double (D) to double your bet and take exactly one more card, or split (P) two cards of the same value into two hands, with a second bet on the new one.',
    'A blackjack, an ace and a ten-value card as your first two cards, pays 3 to 2. A win pays 1 to 1, and a tie gives your bet back. The dealer draws to 16 and stands on all 17s, and checks for blackjack when showing an ace or a ten-value card.',
    'Every hand comes from six fresh decks, and the server draws each card at the moment it shows. You can split once, and split aces get one card each. A hand you leave stands for you after a while.',
    'On a big bet (all in, or over half your chips), a hit on a hard 12 or more comes face down and turns over slowly, every time, whatever the card. So does the dealer’s hidden card. Tap the table or press any key to turn it over at once.',
    'After a hand, press Enter or Space to deal again at the same bet, or M for the largest bet. Everyone in the room watches your cards land on your seat.',
  ],
})
