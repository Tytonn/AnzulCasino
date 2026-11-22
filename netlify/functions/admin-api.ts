/**
 * The admin lane's API: the admin panel (players, chips, giveaways, settings,
 * seasons) and the public Audit page. The routes live in
 * server/features/admin/api.ts.
 */
import type { Config } from '@netlify/functions'

import { adminApi } from '../../server/features/admin/api.ts'

export default adminApi

export const config: Config = {
  path: ['/api/admin/*'],
}
