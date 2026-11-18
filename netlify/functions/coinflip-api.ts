/**
 * Coin flip's API: one function for the game's endpoints, so one warm
 * instance answers them all. The routes live in server/games/coinflip/api.ts.
 */
import type { Config } from '@netlify/functions'

import { coinflipApi } from '../../server/games/coinflip/api.ts'

export default coinflipApi

export const config: Config = {
  path: ['/api/coinflip/*'],
}
