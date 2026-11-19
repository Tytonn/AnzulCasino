/**
 * The economy's endpoints, served by netlify/functions/economy-api.ts:
 *
 *   GET  /api/economy/state              the player's economy (EconomyState)
 *   POST /api/economy/work               the three income buttons
 *   POST /api/economy/hustle
 *   POST /api/economy/crime
 *   POST /api/economy/collect            rank income and the streak bonus
 *   POST /api/economy/tier               { tier } buys the next rank
 *   POST /api/economy/challenges/claim   { index } pays a finished challenge
 *   POST /api/economy/drops/claim        { dropId } grabs a share of a chat drop
 *   GET  /api/economy/hall-of-fame       every finished season's standings
 *
 * The season's own moments ride on the two GETs, which every browser makes
 * on load and on return: the final day, the end and its frozen standings,
 * rank unlock posts and chat drops. Nothing runs on a timer, so the database
 * sleeps when nobody is around.
 */
import {
  type EconomyStateResponse,
  ChallengeClaimInput,
  DropClaimInput,
  NoInput,
  TierBuyInput,
} from '../../../shared/features/economy.ts'
import { HallOfFameInput } from '../../../shared/features/season.ts'
import { loadConfig } from '../../lib/config.ts'
import { db } from '../../lib/db.ts'
import { createApi, route } from '../../lib/http.ts'
import { publish } from '../../lib/live.ts'
import { runningSeason, type Season } from '../../lib/seasons.ts'
import { hallOfFame } from '../season/hall-of-fame.ts'
import { advanceSeasons } from '../season/lifecycle.ts'
import { buyTier, claimChallenge, collect, grabDrop, pressButton } from './actions.ts'
import { landDrop } from './drops.ts'
import { economyState } from './state.ts'
import { announceUnlocks } from './unlocks.ts'

/**
 * Moves the season on if one of its moments has come, and returns the
 * running season. A failure here is logged and never fails the request.
 */
async function advance(ctx: {
  now: Date
  waitUntil(promise: Promise<unknown>): void
}): Promise<Season | null> {
  const running = await runningSeason()
  try {
    const config = await loadConfig(db())
    const events = await advanceSeasons(running, config, ctx.now)
    if (running) {
      events.push(...(await announceUnlocks(running, config, ctx.now)))
      events.push(...(await landDrop(running, config, ctx.now)))
    }
    if (events.length > 0) ctx.waitUntil(publish(events))
  } catch (error) {
    console.error('[economy] could not move the season on', error)
  }
  return running
}

/** The three income buttons share a shape and a stricter limit than the default. */
const BUTTON_LIMIT = { limit: 30, windowSeconds: 60 }

export const economyRoutes = [
  route({
    method: 'GET',
    path: '/api/economy/state',
    auth: 'user',
    input: NoInput,
    run: async (ctx): Promise<EconomyStateResponse> => {
      const running = await advance(ctx)
      if (!running) return { state: null }
      const config = await loadConfig(db())
      const state = await db().transaction((tx) => economyState(tx, running, ctx.user.id, config))
      return { state }
    },
  }),
  route({
    method: 'POST',
    path: '/api/economy/work',
    auth: 'user',
    idempotent: true,
    input: NoInput,
    limit: BUTTON_LIMIT,
    run: (ctx) => pressButton(ctx, 'work'),
  }),
  route({
    method: 'POST',
    path: '/api/economy/hustle',
    auth: 'user',
    idempotent: true,
    input: NoInput,
    limit: BUTTON_LIMIT,
    run: (ctx) => pressButton(ctx, 'hustle'),
  }),
  route({
    method: 'POST',
    path: '/api/economy/crime',
    auth: 'user',
    idempotent: true,
    input: NoInput,
    limit: BUTTON_LIMIT,
    run: (ctx) => pressButton(ctx, 'crime'),
  }),
  route({
    method: 'POST',
    path: '/api/economy/collect',
    auth: 'user',
    idempotent: true,
    input: NoInput,
    limit: BUTTON_LIMIT,
    run: (ctx) => collect(ctx),
  }),
  route({
    method: 'POST',
    path: '/api/economy/tier',
    auth: 'user',
    idempotent: true,
    input: TierBuyInput,
    limit: BUTTON_LIMIT,
    run: (ctx) => buyTier(ctx, ctx.input.tier),
  }),
  route({
    method: 'POST',
    path: '/api/economy/challenges/claim',
    auth: 'user',
    idempotent: true,
    input: ChallengeClaimInput,
    limit: BUTTON_LIMIT,
    run: (ctx) => claimChallenge(ctx, ctx.input.index),
  }),
  route({
    method: 'POST',
    path: '/api/economy/drops/claim',
    auth: 'user',
    idempotent: true,
    input: DropClaimInput,
    limit: BUTTON_LIMIT,
    run: (ctx) => grabDrop(ctx, ctx.input.dropId),
  }),
  route({
    method: 'GET',
    path: '/api/economy/hall-of-fame',
    auth: 'user',
    input: HallOfFameInput,
    run: async (ctx) => {
      await advance(ctx)
      return hallOfFame(db())
    },
  }),
]

export const economyApi = createApi(economyRoutes)
