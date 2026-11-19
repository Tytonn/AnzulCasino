/**
 * Blackjack's API: one function for the game's endpoints, so one warm
 * instance answers a whole hand. The routes live in server/games/blackjack/api.ts.
 */
import type { Config } from '@netlify/functions'

import { blackjackApi } from '../../server/games/blackjack/api.ts'

export default blackjackApi

export const config: Config = {
  path: ['/api/blackjack/*'],
}
