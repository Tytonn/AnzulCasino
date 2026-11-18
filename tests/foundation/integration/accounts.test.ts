import { beforeAll, describe, expect, it } from 'vitest'

import { type ApiClient, apiClient } from '../../helpers/api.ts'
import { useTestDatabase } from '../../helpers/db.ts'

process.env.ADMIN_BOOTSTRAP_CODE = 'test-bootstrap-phrase'
const db = await useTestDatabase()
const { coreApi } = await import('../../../server/core/api.ts')

let admin: ApiClient

async function invite(): Promise<string> {
  const res = await admin.post('/api/invites', { kind: 'invite' })
  expect(res.status).toBe(200)
  return res.body.code.code
}

async function newPlayer(username: string, password = 'correct horse') {
  const client = apiClient(coreApi)
  const res = await client.post('/api/auth/signup', {
    username,
    password,
    inviteCode: await invite(),
  })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return client
}

beforeAll(async () => {
  admin = apiClient(coreApi)
  const res = await admin.post('/api/auth/signup', {
    username: 'Tyton',
    password: 'admin password',
    inviteCode: 'test-bootstrap-phrase',
  })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  expect(res.body.user.role).toBe('admin')
})

describe('admin bootstrap', () => {
  it('works only once', async () => {
    const res = await apiClient(coreApi).post('/api/auth/signup', {
      username: 'second_admin',
      password: 'whatever123',
      inviteCode: 'test-bootstrap-phrase',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_invite')
  })
})

describe('signup', () => {
  it('needs a valid unused invite code, used once', async () => {
    const code = await invite()
    const first = apiClient(coreApi)
    const ok = await first.post('/api/auth/signup', {
      username: 'Ace',
      password: 'password one',
      // Codes are forgiving about case, spaces and dashes.
      inviteCode: ` ${code.toLowerCase().replaceAll('-', ' ')} `,
    })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.user).toMatchObject({ username: 'Ace', displayName: 'Ace', role: 'player' })

    const again = await apiClient(coreApi).post('/api/auth/signup', {
      username: 'Ace2',
      password: 'password two',
      inviteCode: code,
    })
    expect(again.status).toBe(400)
    expect(again.body.error.message).toMatch(/not valid/)

    const [row] = await db.query<{ used_by: string }>(
      `select used_by from invite_codes where code = $1`,
      [code],
    )
    expect(row?.used_by).toBe(ok.body.user.id)
  })

  it('keeps usernames unique without regard to case', async () => {
    await newPlayer('Queen')
    const res = await apiClient(coreApi).post('/api/auth/signup', {
      username: 'QUEEN',
      password: 'password two',
      inviteCode: await invite(),
    })
    expect(res.status).toBe(409)
    expect(res.body.error.message).toMatch(/taken/)
  })

  it('explains bad input in plain words', async () => {
    const res = await apiClient(coreApi).post('/api/auth/signup', {
      username: 'no',
      password: 'short',
      inviteCode: 'ABCD-EFGH-JKMN',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe('Usernames are 3 to 16 letters, digits or underscores.')
  })

  it('stores only a hash of the password and of the session token', async () => {
    const client = await newPlayer('Hashed', 'my secret pass')
    const [user] = await db.query<{ password_hash: string }>(
      `select password_hash from users where username = 'Hashed'`,
    )
    expect(user?.password_hash).toMatch(/^scrypt\$/)
    expect(user?.password_hash).not.toContain('my secret pass')
    const token = client.cookies.get('anzul_session')!
    const found = await db.query(`select 1 from sessions where token_hash = $1`, [token])
    expect(found).toHaveLength(0)
  })
})

describe('login and sessions', () => {
  it('logs in, reads /api/me, and logs out', async () => {
    await newPlayer('Lucky', 'lucky password')
    const client = apiClient(coreApi)
    expect((await client.get('/api/me')).status).toBe(401)

    const res = await client.post('/api/auth/login', {
      username: 'lucky',
      password: 'lucky password',
    })
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/Secure/)
    expect(cookie).toMatch(/SameSite=Lax/)
    expect(cookie).toMatch(/Max-Age=2592000/)

    const me = await client.get('/api/me')
    expect(me.status).toBe(200)
    expect(me.body.user.username).toBe('Lucky')

    expect((await client.post('/api/auth/logout')).status).toBe(200)
    expect(client.cookies.has('anzul_session')).toBe(false)
    expect((await client.get('/api/me')).status).toBe(401)
  })

  it('throttles after 5 wrong passwords for a username', async () => {
    await newPlayer('Target', 'right password')
    const attacker = apiClient(coreApi, { ip: '198.51.100.1' })
    for (let i = 0; i < 5; i++) {
      const res = await attacker.post('/api/auth/login', {
        username: 'Target',
        password: `wrong ${i}`,
      })
      expect(res.status).toBe(400)
      expect(res.body.error.message).toBe('Wrong username or password.')
    }
    const blocked = await attacker.post('/api/auth/login', {
      username: 'target',
      password: 'right password',
    })
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.message).toMatch(/Too many wrong passwords/)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('gives the same answer for an unknown username', async () => {
    const res = await apiClient(coreApi).post('/api/auth/login', {
      username: 'nobody_here',
      password: 'whatever123',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe('Wrong username or password.')
  })

  it('extends a session that is used, at most once an hour', async () => {
    const client = await newPlayer('Slider')
    const quiet = await client.get('/api/me')
    expect(quiet.headers.get('set-cookie')).toBeNull()

    await db.query(
      `update sessions set last_seen_at = now() - interval '2 hours', expires_at = now() + interval '1 day'
       where user_id = (select id from users where username = 'Slider')`,
    )
    const res = await client.get('/api/me')
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=2592000/)
    const [row] = await db.query<{ days: number }>(
      `select extract(day from expires_at - now())::int as days from sessions
       where user_id = (select id from users where username = 'Slider')`,
    )
    expect(row?.days).toBeGreaterThanOrEqual(29)
  })

  it('ends expired sessions and clears the cookie', async () => {
    const client = await newPlayer('Expired')
    await db.query(
      `update sessions set expires_at = now() - interval '1 second'
       where user_id = (select id from users where username = 'Expired')`,
    )
    const res = await client.get('/api/me')
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/)
  })

  it('locks out a disabled account', async () => {
    const client = await newPlayer('Banned', 'banned password')
    await db.query(`update users set disabled_at = now() where username = 'Banned'`)
    expect((await client.get('/api/me')).status).toBe(401)
    const res = await apiClient(coreApi).post('/api/auth/login', {
      username: 'Banned',
      password: 'banned password',
    })
    expect(res.status).toBe(403)
  })
})

describe('profile', () => {
  it('saves the display name, avatar and sound settings', async () => {
    const client = await newPlayer('Painter')
    const res = await client.patch('/api/me', {
      displayName: '  The   Painter ',
      avatar: 'crown',
      avatarColor: 'amber',
      soundVolume: 35,
      soundMuted: true,
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.user).toMatchObject({
      displayName: 'The Painter',
      avatar: 'crown',
      avatarColor: 'amber',
      soundVolume: 35,
      soundMuted: true,
    })
    const bad = await client.patch('/api/me', { avatar: '<img src=x>' })
    expect(bad.status).toBe(400)
  })
})

describe('reset codes', () => {
  it('lets a player set a new password once, logs out other devices, and is audited', async () => {
    const phone = await newPlayer('Forgetful', 'old password')
    const res = await admin.post('/api/invites', { kind: 'reset', username: 'forgetful' })
    expect(res.status).toBe(200)
    const code = res.body.code.code

    const laptop = apiClient(coreApi)
    const wrongUser = await laptop.post('/api/auth/reset', {
      username: 'Lucky',
      code,
      password: 'new password',
    })
    expect(wrongUser.status).toBe(400)

    const redeemed = await laptop.post('/api/auth/reset', {
      username: 'Forgetful',
      code,
      password: 'new password',
    })
    expect(redeemed.status, JSON.stringify(redeemed.body)).toBe(200)
    expect((await laptop.get('/api/me')).status).toBe(200)
    expect((await phone.get('/api/me')).status).toBe(401)

    const reused = await apiClient(coreApi).post('/api/auth/reset', {
      username: 'Forgetful',
      code,
      password: 'another password',
    })
    expect(reused.status).toBe(400)

    const login = await apiClient(coreApi).post('/api/auth/login', {
      username: 'Forgetful',
      password: 'new password',
    })
    expect(login.status).toBe(200)

    const audit = await db.query<{ action: string; target: string }>(
      `select action, target from audit_log where action = 'reset_code.created'`,
    )
    expect(audit).toContainEqual({ action: 'reset_code.created', target: 'Forgetful' })
  })
})

describe('access and limits', () => {
  it('keeps invite codes admin-only', async () => {
    const player = await newPlayer('Sneaky')
    expect((await player.post('/api/invites', { kind: 'invite' })).status).toBe(403)
    expect((await player.get('/api/invites')).status).toBe(403)
    const list = await admin.get('/api/invites')
    expect(list.status).toBe(200)
    expect(list.body.codes.length).toBeGreaterThan(0)
  })

  it('rate-limits each player per endpoint', async () => {
    const client = await newPlayer('Spammer')
    let last = 0
    for (let i = 0; i < 121; i++) last = (await client.get('/api/time')).status
    expect(last).toBe(429)
    // Another endpoint has its own budget.
    expect((await client.get('/api/me')).status).toBe(200)
  })

  it('returns the database clock', async () => {
    const client = await newPlayer('Clock')
    const res = await client.get('/api/time')
    expect(Math.abs(res.body.now - Date.now())).toBeLessThan(5000)
  })

  it('only accepts JSON bodies', async () => {
    const res = await apiClient(coreApi).raw('POST', '/api/auth/login', 'username=a&password=b')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('bad_content_type')
  })

  it('answers unknown paths and wrong methods', async () => {
    const client = apiClient(coreApi)
    expect((await client.get('/api/nothing')).status).toBe(404)
    expect((await client.del('/api/me')).status).toBe(405)
  })
})
