/**
 * Roulette's backup sweep (spec: Settlement): settles any spin whose betting
 * closed without a browser settling it, such as one where every bettor shut
 * the tab before the close. Browsers settle each spin as it closes and every
 * roulette request settles any left behind, so this usually finds nothing.
 *
 * It runs once a day, the most a scheduled function may wake the database
 * (docs/LANE_GUIDE.md, Keeping costs down), and only on published deploys.
 */
import type { Config, Context } from '@netlify/functions'

import { sweepUnsettledSpins } from '../../server/games/roulette/spins.ts'
import { setDeployContext } from '../../server/lib/live.ts'

export default async (_req: Request, context: Context): Promise<void> => {
  // Live channel names carry the deploy, as on every request.
  setDeployContext(context.deploy)
  const publishing: Promise<unknown>[] = []
  const settled = await sweepUnsettledSpins((promise) => publishing.push(promise))
  await Promise.allSettled(publishing)
  if (settled > 0) console.info(`[roulette] the sweep settled ${settled} spins`)
}

export const config: Config = {
  // 09:00 UTC: 4 AM in New York (5 AM in summer), when nobody is playing.
  schedule: '0 9 * * *',
}
