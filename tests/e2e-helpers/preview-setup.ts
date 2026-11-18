/**
 * Playwright's global setup when the browser tests run against a deploy
 * preview (E2E_BASE_URL). It gives the preview the sample players and a
 * running season through the site's own API, the way a person would at
 * /signup and /setup, so every lane's tests find what they find locally.
 *
 * A new preview's database is a copy of production's, which holds no players
 * until launch. So the first run signs up `admin` with E2E_ADMIN_CODE (the
 * Deploy Previews value of ADMIN_BOOTSTRAP_CODE; ask Tyton) and invites the
 * others. Everyone gets E2E_PASSWORD, because anyone can open a preview.
 * Later runs sign in as admin, find everything there and change nothing.
 */
import { randomUUID } from 'node:crypto'

import { type APIRequestContext, type APIResponse, request } from '@playwright/test'

import { SEED_PASSWORD, SEED_PLAYERS } from '../../scripts/db/sample-players.ts'
import { addGameDays, gameDay, gameDayStart } from '../../shared/game-day.ts'

type Sample = (typeof SEED_PLAYERS)[number]

export default async function previewSetup() {
  const baseURL = process.env.E2E_BASE_URL
  if (!baseURL) return
  const password = process.env.E2E_PASSWORD ?? ''
  if (password.length < 8 || password === SEED_PASSWORD) {
    throw new Error(
      'Set E2E_PASSWORD to a password of 8 characters or more for the sample players on the ' +
        'preview. Anyone can open a preview, so it cannot be the local sample password. Use ' +
        'the same one every time you test that preview.',
    )
  }
  const admin = SEED_PLAYERS.find((p) => p.role === 'admin')
  if (!admin) throw new Error('scripts/db/sample-players.ts has no admin.')

  const done: string[] = []
  const api = await request.newContext({ baseURL })
  try {
    if (!(await logIn(api, admin, password))) {
      const code = process.env.E2E_ADMIN_CODE
      if (!code) {
        throw new Error(
          `${baseURL} has no ${admin.username} account yet. For the first run on a preview, ` +
            'set E2E_ADMIN_CODE to the preview admin code (the Deploy Previews value of ' +
            'ADMIN_BOOTSTRAP_CODE; ask Tyton).',
        )
      }
      await signUp(api, admin, password, code)
      done.push(`signed up ${admin.username}`)
    }

    const live = await read<{ transport: string }>(
      api.get('/api/live/token'),
      'Asking for a live token',
    )
    if (live.transport === 'none') {
      throw new Error(
        'The preview has no ABLY_API_KEY, so nothing live works there. Add it in Netlify ' +
          '(Functions scope, Deploy Previews value), then deploy the preview again.',
      )
    }

    const { players } = await read<{ players: { username: string }[] }>(
      api.get('/api/players'),
      'Listing the players',
    )
    const there = new Set(players.map((p) => p.username.toLowerCase()))
    for (const player of SEED_PLAYERS) {
      if (there.has(player.username)) continue
      const { code } = await read<{ code: { code: string } }>(
        api.post('/api/invites', { data: { kind: 'invite' } }),
        'Making an invite code',
      )
      const newcomer = await request.newContext({ baseURL })
      try {
        await signUp(newcomer, player, password, code.code)
      } finally {
        await newcomer.dispose()
      }
      done.push(`signed up ${player.username}`)
    }

    const { current } = await read<{ current: { phase: string } | null }>(
      api.get('/api/season'),
      'Reading the season',
    )
    if (current?.phase !== 'open' && current?.phase !== 'final_day') {
      // Like the local seed: 30 days from this morning's 4 AM Central reset.
      const today = gameDay(new Date())
      await read(
        api.post('/api/seasons', {
          headers: { 'idempotency-key': randomUUID() },
          data: {
            name: 'Test season',
            startsAt: gameDayStart(today).toISOString(),
            endsAt: gameDayStart(addGameDays(today, 30)).toISOString(),
          },
        }),
        'Starting a season',
      )
      done.push('started a season')
    }
  } finally {
    await api.dispose()
  }
  console.log(
    done.length
      ? `Preview ready: ${done.join(', ')}.`
      : 'Preview ready: the sample players and a running season were already there.',
  )
}

/** Signs in. False when the preview has no such account with that password. */
async function logIn(api: APIRequestContext, player: Sample, password: string): Promise<boolean> {
  const res = await api.post('/api/auth/login', {
    data: { username: player.username, password },
  })
  if (res.ok()) return true
  if ((await errorCode(res)) === 'bad_credentials') return false
  throw new Error(`Signing in as ${player.username} failed: ${res.status()} ${await res.text()}`)
}

/** Signs a sample player up with a code, then gives them the sample name and avatar. */
async function signUp(api: APIRequestContext, player: Sample, password: string, code: string) {
  const res = await api.post('/api/auth/signup', {
    data: { username: player.username, password, inviteCode: code },
  })
  if (!res.ok()) {
    if (player.role === 'admin' && (await errorCode(res)) === 'invalid_invite') {
      throw new Error(
        'The preview refused E2E_ADMIN_CODE. Either it is not the Deploy Previews value of ' +
          'ADMIN_BOOTSTRAP_CODE, or the preview already has an admin: the code makes one per ' +
          "preview. If that admin is the one an earlier run made, use that run's E2E_PASSWORD.",
      )
    }
    throw new Error(`Signing up ${player.username} failed: ${res.status()} ${await res.text()}`)
  }
  await read(
    api.patch('/api/me', {
      data: {
        displayName: player.displayName,
        avatar: player.avatar,
        avatarColor: player.avatarColor,
      },
    }),
    `Naming ${player.username}`,
  )
}

async function read<T>(pending: Promise<APIResponse>, what: string): Promise<T> {
  const res = await pending
  if (!res.ok()) throw new Error(`${what} failed: ${res.status()} ${await res.text()}`)
  return (await res.json()) as T
}

async function errorCode(res: APIResponse): Promise<string | undefined> {
  try {
    return ((await res.json()) as { error?: { code?: string } }).error?.code
  } catch {
    return undefined
  }
}
