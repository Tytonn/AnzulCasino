/**
 * The heist lane's API: steals, shields, the extra attempt and the vault, in
 * one function so one warm instance answers them all. The routes live in
 * server/features/heist/api.ts.
 */
import type { Config } from '@netlify/functions'

import { heistApi } from '../../server/features/heist/api.ts'

export default heistApi

export const config: Config = {
  path: ['/api/heist/*'],
}
