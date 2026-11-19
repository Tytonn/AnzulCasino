/**
 * Roulette's API: one function for the game's endpoints, so one warm
 * instance answers them all. The routes live in server/games/roulette/api.ts.
 */
import type { Config } from '@netlify/functions'

import { rouletteApi } from '../../server/games/roulette/api.ts'

export default rouletteApi

export const config: Config = {
  path: ['/api/roulette/*'],
}
