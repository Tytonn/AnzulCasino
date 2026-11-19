/**
 * The economy's API: rank income, the work, slut and crime buttons, daily
 * challenges, chat drops, and the season's end and Hall of Fame. One function
 * for all of it, so one warm instance answers them all. The routes live in
 * server/features/economy/api.ts.
 */
import type { Config } from '@netlify/functions'

import { economyApi } from '../../server/features/economy/api.ts'

export default economyApi

export const config: Config = {
  path: ['/api/economy/*'],
}
