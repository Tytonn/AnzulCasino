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
import { loadConfig } from '../lib/config.ts'
import { db } from '../lib/db.ts'
import { createApi, route } from '../lib/http.ts'
import { login, redeemReset, signup, updateProfile } from './accounts.ts'
import { createCode, listCodes } from './invites.ts'

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
