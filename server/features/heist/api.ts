/**
 * The heist lane's endpoints, served by netlify/functions/heist-api.ts
 * (spec: Steal, shields and vault):
 *
 *   GET  /api/heist/state          your attempts, shields, immunity, vault move, and
 *                                  every other player's public defenses
 *   GET  /api/heist/steals         the season's latest steal attempts
 *   POST /api/heist/steal          { targetId } -> the attempt and your wallet
 *   POST /api/heist/shield         buy one shield charge
 *   POST /api/heist/extra-attempt  buy today's one extra steal attempt
 *   POST /api/heist/vault          { direction, amount } -> one vault move a game day
 *
 * Every POST moves chips, so it needs an Idempotency-Key and runs in one
 * locked transaction. Nobody's shield charges leave the server except to
 * their owner.
 */
import {
  BuyInput,
  StealInput,
  StealListInput,
  VaultMoveInput,
} from '../../../shared/features/heist.ts'
import { loadConfig } from '../../lib/config.ts'
import { db } from '../../lib/db.ts'
import { conflict } from '../../lib/errors.ts'
import { createApi, route } from '../../lib/http.ts'
import { currentSeason, runningSeason, type Season } from '../../lib/seasons.ts'
import { buyExtraAttempt, buyShield, moveVault } from './shop.ts'
import { heistState, recentSteals } from './state.ts'
import { attemptSteal } from './steal.ts'

/** Steals and purchases are rare; this is far above any real use. */
const ACTION_LIMIT = { limit: 30, windowSeconds: 60 }

async function requireSeason(): Promise<Season> {
  const season = await runningSeason()
  if (!season) throw conflict('There is no season running right now.', 'no_season')
  return season
}

export const heistRoutes = [
  route({
    method: 'GET',
    path: '/api/heist/state',
    auth: 'user',
    async run(ctx) {
      const season = await runningSeason()
      const cfg = await loadConfig(db())
      return heistState(db(), season, ctx.user.id, cfg, ctx.now)
    },
  }),
  route({
    method: 'GET',
    path: '/api/heist/steals',
    auth: 'user',
    input: StealListInput,
    async run(ctx) {
      const season = await currentSeason()
      if (!season) return { seasonId: null, steals: [] }
      return {
        seasonId: season.id,
        steals: await recentSteals(db(), season.id, ctx.input.limit ?? 30),
      }
    },
  }),
  route({
    method: 'POST',
    path: '/api/heist/steal',
    auth: 'user',
    idempotent: true,
    input: StealInput,
    limit: ACTION_LIMIT,
    async run(ctx) {
      return attemptSteal(ctx, await requireSeason())
    },
  }),
  route({
    method: 'POST',
    path: '/api/heist/shield',
    auth: 'user',
    idempotent: true,
    input: BuyInput,
    limit: ACTION_LIMIT,
    async run(ctx) {
      return buyShield(ctx, await requireSeason())
    },
  }),
  route({
    method: 'POST',
    path: '/api/heist/extra-attempt',
    auth: 'user',
    idempotent: true,
    input: BuyInput,
    limit: ACTION_LIMIT,
    async run(ctx) {
      return buyExtraAttempt(ctx, await requireSeason())
    },
  }),
  route({
    method: 'POST',
    path: '/api/heist/vault',
    auth: 'user',
    idempotent: true,
    input: VaultMoveInput,
    limit: ACTION_LIMIT,
    async run(ctx) {
      return moveVault(ctx, await requireSeason())
    },
  }),
]

export const heistApi = createApi(heistRoutes)
