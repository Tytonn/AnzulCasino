/**
 * The foundation's API: one function for every core endpoint, so one warm
 * instance answers them all. The routes live in server/core/api.ts. When you
 * add a route there, add its path here too (Netlify reads this list as is).
 */
import type { Config } from '@netlify/functions'

import { coreApi } from '../../server/core/api.ts'

export default coreApi

export const config: Config = {
  path: ['/api/auth/*', '/api/me', '/api/time', '/api/config', '/api/invites'],
}
