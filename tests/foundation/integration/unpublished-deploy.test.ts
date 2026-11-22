/**
 * A production deploy opened by its own link before it is published
 * (server/lib/deploy.ts). It uses the live database, which Netlify migrates
 * only when a deploy is published, so before the first publish it has no
 * tables at all. There the API says so in plain words instead of "Something
 * went wrong on our side". Everywhere else a missing table is a bug and the
 * answer stays the usual server error.
 */
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

import { coreApi } from '../../../server/core/api.ts'
import { closeDb } from '../../../server/lib/db.ts'
import type { DeployInfo } from '../../../server/lib/deploy.ts'
import { TEST_PASSWORD } from '../../../shared/test-accounts.ts'
import { apiClient } from '../../helpers/api.ts'
import { useTestDatabase } from '../../helpers/db.ts'

// No migrations applied: the live database before Netlify first publishes.
const testDb = await useTestDatabase({ empty: true })

const UNPUBLISHED: DeployInfo = { context: 'production', id: 'newest-main', published: false }
const LIVE: DeployInfo = { context: 'production', id: 'live', published: true }
const PREVIEW: DeployInfo = { context: 'deploy-preview', id: 'preview-1', published: false }

const NOT_PUBLISHED = {
  code: 'deploy_not_published',
  message:
    'This deploy is not published, and its database is set up only when it is. To try the site, open a deploy preview.',
}
const SERVER_ERROR = {
  code: 'server_error',
  message: 'Something went wrong on our side. Try again in a moment.',
}

let logged: MockInstance<typeof console.error>
beforeEach(() => {
  // The real error still goes to the function log, where it is wanted.
  logged = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  logged.mockRestore()
})

function signIn(deploy: DeployInfo) {
  return apiClient(coreApi, { deploy }).post('/api/auth/login', {
    username: 'test',
    password: TEST_PASSWORD,
  })
}

describe('before the first publish', () => {
  it('the database really has no tables', async () => {
    const tables = await testDb.query(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    )
    expect(tables).toEqual([])
  })

  it('a deploy opened by its own link says it is not published', async () => {
    const res = await signIn(UNPUBLISHED)
    expect(res.status).toBe(503)
    expect(res.body.error).toEqual(NOT_PUBLISHED)
    expect(String(logged.mock.calls[0]?.[0])).toBe('[api] POST /api/auth/login failed')

    // Every request there, signed in or not, says the same.
    const client = apiClient(coreApi, { deploy: UNPUBLISHED })
    const signup = await client.post('/api/auth/signup', {
      username: 'newplayer',
      password: 'a long enough password',
      inviteCode: 'ABCD-EFGH',
    })
    expect(signup.status).toBe(503)
    expect(signup.body.error).toEqual(NOT_PUBLISHED)
    const me = await client.get('/api/me', { cookie: 'anzul_session=an-old-session' })
    expect(me.status).toBe(503)
    expect(me.body.error).toEqual(NOT_PUBLISHED)
  })

  it('anywhere else a missing table stays a server error', async () => {
    for (const deploy of [LIVE, PREVIEW]) {
      const res = await signIn(deploy)
      expect(res.status, deploy.context).toBe(500)
      expect(res.body.error).toEqual(SERVER_ERROR)
    }
  })
})

describe('with no database configured at all', () => {
  const url = process.env.DATABASE_URL
  beforeEach(async () => {
    await closeDb()
    delete process.env.DATABASE_URL
  })
  afterEach(async () => {
    await closeDb()
    process.env.DATABASE_URL = url
  })

  it('a deploy opened by its own link says it is not published', async () => {
    const res = await signIn(UNPUBLISHED)
    expect(res.status).toBe(503)
    expect(res.body.error).toEqual(NOT_PUBLISHED)
  })

  it('anywhere else it stays a server error', async () => {
    const res = await signIn(LIVE)
    expect(res.status).toBe(500)
    expect(res.body.error).toEqual(SERVER_ERROR)
  })
})
