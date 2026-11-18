/**
 * Every foundation endpoint. Served by netlify/functions/core-api.ts; tests
 * call `coreApi` directly.
 */
import {
  CreateInviteInput,
  LoginInput,
  ProfileInput,
  ResetInput,
  SignupInput,
} from '../../shared/accounts.ts'
import {
  clearSessionCookie,
  destroySession,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
} from '../lib/auth.ts'
import { CreateSeasonInput, type SeasonView } from '../../shared/seasons.ts'
import { loadConfig } from '../lib/config.ts'
import { db } from '../lib/db.ts'
import { createApi, route } from '../lib/http.ts'
import { chipTransaction } from '../lib/idempotency.ts'
import { liveToken, publish } from '../lib/live.ts'
import {
  createSeason,
  currentSeason,
  listSeasons,
  type Season,
  seasonSnapshot,
  seasonStateEvent,
  standings,
  toSeasonView,
} from '../lib/seasons.ts'
import { login, redeemReset, signup, updateProfile } from './accounts.ts'
import { createCode, listCodes } from './invites.ts'

/** Seasons as the API sends them, with their phase at `now` (database time). */
async function seasonViews(now: Date) {
  const { final_freeze_hours } = await loadConfig(db())
  function view(season: Season): SeasonView
  function view(season: Season | null): SeasonView | null
  function view(season: Season | null): SeasonView | null {
    return season ? toSeasonView(season, now, final_freeze_hours) : null
  }
  return view
}

const FIFTEEN_MINUTES = 15 * 60

export const coreRoutes = [
  route({
    method: 'POST',
    path: '/api/auth/signup',
    auth: 'public',
    input: SignupInput,
    limit: { limit: 20, windowSeconds: FIFTEEN_MINUTES },
    async run({ input, setCookie }) {
      const { user, token } = await signup(input)
      setCookie(sessionCookie(token))
      return { user }
    },
  }),
  route({
    method: 'POST',
    path: '/api/auth/login',
    auth: 'public',
    input: LoginInput,
    limit: { limit: 30, windowSeconds: FIFTEEN_MINUTES },
    async run({ input, setCookie }) {
      const { user, token } = await login(input)
      setCookie(sessionCookie(token))
      return { user }
    },
  }),
  route({
    method: 'POST',
    path: '/api/auth/reset',
    auth: 'public',
    input: ResetInput,
    limit: { limit: 10, windowSeconds: FIFTEEN_MINUTES },
    async run({ input, setCookie }) {
      const { user, token } = await redeemReset(input)
      setCookie(sessionCookie(token))
      return { user }
    },
  }),
  route({
    method: 'POST',
    path: '/api/auth/logout',
    auth: 'user',
    async run({ req, setCookie }) {
      const token = readCookie(req, SESSION_COOKIE)
      if (token) await destroySession(db(), token)
      setCookie(clearSessionCookie())
      return { ok: true }
    },
  }),
  route({
    method: 'GET',
    path: '/api/me',
    auth: 'user',
    async run({ user }) {
      return { user }
    },
  }),
  route({
    method: 'PATCH',
    path: '/api/me',
    auth: 'user',
    input: ProfileInput,
    limit: { limit: 30, windowSeconds: 60 },
    async run({ user, input }) {
      return { user: await updateProfile(user.id, input) }
    },
  }),
  route({
    method: 'GET',
    path: '/api/time',
    auth: 'user',
    async run({ now }) {
      return { now: now.getTime() }
    },
  }),
  route({
    method: 'GET',
    path: '/api/config',
    auth: 'user',
    async run() {
      return { config: await loadConfig(db()) }
    },
  }),
  route({
    method: 'GET',
    path: '/api/season',
    auth: 'user',
    async run({ user, now }) {
      const snapshot = await seasonSnapshot(user.id)
      const view = await seasonViews(now)
      const wallet = snapshot.wallet
      return {
        current: view(snapshot.current),
        next: view(snapshot.next),
        wallet: wallet && {
          balance: wallet.balance,
          vault: wallet.vault,
          tier: wallet.tier,
          version: wallet.version,
        },
      }
    },
  }),
  route({
    method: 'GET',
    path: '/api/leaderboard',
    auth: 'user',
    async run() {
      const season = await currentSeason()
      if (!season) return { seasonId: null, standings: [] }
      return { seasonId: season.id, standings: await standings(db(), season.id) }
    },
  }),
  route({
    method: 'GET',
    path: '/api/seasons',
    auth: 'admin',
    async run({ now }) {
      const view = await seasonViews(now)
      return { seasons: (await listSeasons(db())).map(view) }
    },
  }),
  route({
    method: 'POST',
    path: '/api/seasons',
    auth: 'admin',
    // Starting a season gives out chips, so a repeated request must not.
    idempotent: true,
    input: CreateSeasonInput,
    limit: { limit: 10, windowSeconds: 60 },
    async run(ctx) {
      const { input, user } = ctx
      const view = await seasonViews(ctx.now)
      return chipTransaction(ctx, async (tx, afterCommit) => {
        const season = await createSeason(tx, {
          name: input.name,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          startingBalance:
            input.startingBalance === undefined ? undefined : BigInt(input.startingBalance),
          actorId: user.id,
        })
        const shown = view(season)
        afterCommit(() => publish([seasonStateEvent(shown.id, shown.phase)]))
        return { season: shown }
      })
    },
  }),
  route({
    method: 'GET',
    path: '/api/live/token',
    auth: 'user',
    // A browser asks on connect and again before its token runs out.
    limit: { limit: 30, windowSeconds: 60 },
    async run({ user }) {
      return liveToken(user.id)
    },
  }),
  route({
    method: 'GET',
    path: '/api/invites',
    auth: 'admin',
    async run() {
      return { codes: await listCodes() }
    },
  }),
  route({
    method: 'POST',
    path: '/api/invites',
    auth: 'admin',
    input: CreateInviteInput,
    limit: { limit: 30, windowSeconds: 60 },
    async run({ user, input }) {
      return { code: await createCode(user.id, input) }
    },
  }),
]

export const coreApi = createApi(coreRoutes)
