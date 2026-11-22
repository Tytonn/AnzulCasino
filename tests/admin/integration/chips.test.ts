/**
 * The admin moving chips and accounts, against a real database (spec: Admin
 * panel > Chips and Players; Economy > Giveaways): every chip goes through
 * the ledger in the same transaction as its audit row and its chat post, the
 * players hear about it, a request key acts once, and two racing requests
 * never spend the same chips twice.
 */
import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { userChannel } from '../../../shared/events.ts'
import { coreApi } from '../../../server/core/api.ts'
import { adminApi } from '../../../server/features/admin/api.ts'
import { adjustChips } from '../../../server/features/admin/chips.ts'
import { db } from '../../../server/lib/db.ts'
import { captureLive, type Outgoing } from '../../../server/lib/live.ts'
import { runningSeason } from '../../../server/lib/seasons.ts'
import { ledgerMismatches, readWallet } from '../../../server/lib/wallet.ts'
import { apiClient, type ApiClient } from '../../helpers/api.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { createPlayer, createSeason, fundWallet, loggedIn } from '../../helpers/fixtures.ts'

const testDb = await useTestDatabase()

let seasonId: number
let adminId: string
let aliceId: string
let bobId: string
let carolId: string
let admin: ApiClient
let capture: { events: Outgoing[]; stop(): void }

const key = () => ({ 'idempotency-key': randomUUID() })

async function player(username: string, displayName: string): Promise<string> {
  const id = await createPlayer(testDb, username)
  await testDb.query(`update users set display_name = $2 where id = $1`, [id, displayName])
  return id
}

async function balances(userId: string): Promise<{ balance: bigint; vault: bigint }> {
  const wallet = await readWallet(db(), seasonId, userId)
  if (!wallet) throw new Error('no wallet')
  return { balance: wallet.balance, vault: wallet.vault }
}

async function lastPost(): Promise<{ body: string; meta: Record<string, unknown> }> {
  const [row] = await testDb.query<{ body: string; meta: Record<string, unknown> }>(
    `select body, meta from chat_messages where kind = 'system' order by id desc limit 1`,
  )
  if (!row) throw new Error('no post')
  return row
}

async function lastAudit(action: string) {
  const [row] = await testDb.query<{
    actor_id: string
    target: string
    before: unknown
    after: unknown
    reason: string | null
    season_id: number | null
  }>(`select * from audit_log where action = $1 order by id desc limit 1`, [action])
  if (!row) throw new Error(`no ${action} row`)
  return row
}

function events(name: string): Outgoing[] {
  return capture.events.filter((e) => e.name === name)
}

beforeAll(async () => {
  seasonId = await createSeason(testDb)
  adminId = await player('ada', 'Ada')
  await testDb.query(`update users set role = 'admin' where id = $1`, [adminId])
  aliceId = await player('alice', 'Alice')
  bobId = await player('bob', 'Bob')
  carolId = await player('carol', 'Carol')
  for (const id of [adminId, aliceId, bobId]) await fundWallet(seasonId, id, 100n)
  admin = await loggedIn(adminApi, adminId)
})

beforeEach(async () => {
  capture = captureLive()
  await testDb.query(`delete from rate_limits`)
})

afterEach(async () => {
  await admin.settle()
  capture.stop()
  expect(await ledgerMismatches(db(), seasonId)).toEqual([])
})

describe('who can use it', () => {
  it('keeps the panel to admins, and the Audit page open to every player', async () => {
    const alice = await loggedIn(adminApi, aliceId)
    const tries: [string, string][] = [
      ['GET', '/api/admin/players'],
      ['GET', '/api/admin/config'],
      ['POST', '/api/admin/config'],
      ['POST', '/api/admin/chips'],
      ['POST', '/api/admin/giveaways'],
      ['POST', `/api/admin/players/${bobId}/disable`],
      ['POST', `/api/admin/players/${bobId}/enable`],
      ['POST', `/api/admin/seasons/${seasonId}/end`],
      ['PATCH', `/api/admin/seasons/${seasonId}`],
    ]
    for (const [method, path] of tries) {
      const res =
        method === 'GET'
          ? await alice.get(path)
          : method === 'PATCH'
            ? await alice.patch(path, { name: 'Mine now' }, key())
            : await alice.post(path, {}, key())
      expect(res.status, `${method} ${path}`).toBe(403)
    }
    expect((await alice.get('/api/admin/audit')).status).toBe(200)
    expect((await apiClient(adminApi).get('/api/admin/audit')).status).toBe(401)
  })

  it('wants a request key on everything that changes something', async () => {
    const res = await admin.post('/api/admin/chips', {
      userId: aliceId,
      amount: 100,
      reason: 'No key',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('missing_idempotency_key')
  })
})

describe('a manual adjustment', () => {
  it('adds chips through the ledger, posts in chat, logs it and tells the player', async () => {
    const res = await admin.post(
      '/api/admin/chips',
      { userId: aliceId, amount: 10, reason: 'Payout the coin flip bug ate' },
      key(),
    )
    expect(res.status).toBe(200)
    expect(res.body.player).toMatchObject({
      id: aliceId,
      displayName: 'Alice',
      wallet: { balance: 110, vault: 0 },
    })
    expect(await balances(aliceId)).toEqual({ balance: 110n, vault: 0n })

    const [row] = await testDb.query<{ delta: string; ref_type: string; meta: unknown }>(
      `select delta, ref_type, meta from ledger where user_id = $1 and reason = 'admin_adjust'`,
      [aliceId],
    )
    expect(row).toEqual({
      delta: '10',
      ref_type: 'admin',
      meta: { by: adminId, note: 'Payout the coin flip bug ate' },
    })

    const post = await lastPost()
    expect(post.body).toBe("🧾 Ada added 10 chips to Alice's wallet: Payout the coin flip bug ate")
    expect(post.meta).toMatchObject({
      tone: 'info',
      userId: aliceId,
      admin: { kind: 'adjust', by: adminId, userId: aliceId, account: 'wallet', amount: 10 },
    })

    expect(await lastAudit('chips.adjusted')).toMatchObject({
      actor_id: adminId,
      target: 'alice',
      before: { userId: aliceId, account: 'wallet', value: 100 },
      after: { userId: aliceId, account: 'wallet', value: 110, delta: 10 },
      reason: 'Payout the coin flip bug ate',
      season_id: seasonId,
    })

    await admin.settle()
    expect(events('wallet.updated')).toHaveLength(1)
    expect(events('chat.message')).toHaveLength(1)
    const [logged] = events('audit.logged')
    expect(logged?.envelope.data).toMatchObject({
      action: 'chips.adjusted',
      kind: 'chips',
      actor: { id: adminId, displayName: 'Ada' },
      people: { [aliceId]: { displayName: 'Alice' } },
      season: { id: seasonId, name: 'Test season' },
    })
    const [note] = events('notification')
    expect(note?.channel).toBe(userChannel(aliceId))
    expect(note?.envelope.data).toEqual({
      text: 'Ada added 10 chips to your wallet: Payout the coin flip bug ate',
      tone: 'good',
    })
  })

  it('moves the vault too, and takes no more than there is', async () => {
    const add = await admin.post(
      '/api/admin/chips',
      { userId: bobId, amount: 3, account: 'vault', reason: 'Vault refund' },
      key(),
    )
    expect(add.status).toBe(200)
    const take = await admin.post(
      '/api/admin/chips',
      { userId: bobId, amount: -5, account: 'vault', reason: 'Too much' },
      key(),
    )
    expect(take.status).toBe(400)
    expect(take.body.error).toMatchObject({
      code: 'insufficient_funds',
      message: 'Bob has only 3 chips in the vault, so that is the most you can take.',
    })
    const fair = await admin.post(
      '/api/admin/chips',
      { userId: bobId, amount: -3, account: 'vault', reason: 'Undo the refund' },
      key(),
    )
    expect(fair.status).toBe(200)
    expect((await lastPost()).body).toBe("🧾 Ada took 3 chips from Bob's vault: Undo the refund")
    expect(await balances(bobId)).toEqual({ balance: 100n, vault: 0n })
  })

  it('takes whole chips only', async () => {
    const res = await admin.post(
      '/api/admin/chips',
      { userId: bobId, amount: 2.5, reason: 'Half a chip' },
      key(),
    )
    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe(
      'Chips are whole numbers. Type an amount without a decimal point.',
    )
    expect(await balances(bobId)).toEqual({ balance: 100n, vault: 0n })
  })

  it('needs a reason everyone can read', async () => {
    const res = await admin.post(
      '/api/admin/chips',
      { userId: bobId, amount: 100, reason: ' ' },
      key(),
    )
    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe(
      'Say why in a few words. Everyone sees it in chat and on the Audit page.',
    )
  })

  it('gives a player with no wallet yet their starting chips first', async () => {
    const res = await admin.post(
      '/api/admin/chips',
      { userId: carolId, amount: 5, reason: 'Welcome gift' },
      key(),
    )
    expect(res.status).toBe(200)
    expect(res.body.player.wallet).toMatchObject({ balance: 105 })
    const rows = await testDb.query<{ reason: string; delta: string }>(
      `select reason, delta from ledger where user_id = $1 order by id`,
      [carolId],
    )
    expect(rows).toEqual([
      { reason: 'season_start', delta: '100' },
      { reason: 'admin_adjust', delta: '5' },
    ])
  })

  it('refuses a disabled player who has no chips this season', async () => {
    const daveId = await player('dave', 'Dave')
    await testDb.query(`update users set disabled_at = now() where id = $1`, [daveId])
    const res = await admin.post(
      '/api/admin/chips',
      { userId: daveId, amount: 100, reason: 'Try it' },
      key(),
    )
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('no_wallet')
  })

  it('acts once per request key', async () => {
    const headers = key()
    const body = { userId: bobId, amount: 200, reason: 'Sent twice' }
    const first = await admin.post('/api/admin/chips', body, headers)
    const again = await admin.post('/api/admin/chips', body, headers)
    expect(again.status).toBe(200)
    expect(again.body).toEqual(first.body)
    const [count] = await testDb.query<{ n: number }>(
      `select count(*)::int as n from ledger where user_id = $1 and meta->>'note' = 'Sent twice'`,
      [bobId],
    )
    expect(count?.n).toBe(1)
    await admin.post('/api/admin/chips', { ...body, amount: -200, reason: 'Undo it' }, key())
  })

  it('never takes the same chips twice when two adjustments race', async () => {
    const take = () =>
      admin.post('/api/admin/chips', { userId: bobId, amount: -80, reason: 'Race' }, key())
    const results = await Promise.all([take(), take()])
    expect(results.map((r) => r.status).sort()).toEqual([200, 400])
    expect(await balances(bobId)).toEqual({ balance: 20n, vault: 0n })
    await admin.post('/api/admin/chips', { userId: bobId, amount: 80, reason: 'Put back' }, key())
  })

  it('says so when admins adjust their own chips, and sends no note', async () => {
    const res = await admin.post(
      '/api/admin/chips',
      { userId: adminId, amount: -1, reason: 'Paying my own fine' },
      key(),
    )
    expect(res.status).toBe(200)
    expect((await lastPost()).body).toBe(
      '🧾 Ada took 1 chip from their own wallet: Paying my own fine',
    )
    await admin.settle()
    expect(events('notification')).toEqual([])
  })
})

describe('a giveaway', () => {
  it('gives each named player the same chips, one ledger row each', async () => {
    const res = await admin.post('/api/admin/giveaways', { to: [bobId, aliceId], amount: 5 }, key())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      share: 5,
      total: 10,
      recipients: [aliceId, bobId].sort().map((userId) => ({ userId, amount: 5 })),
    })
    const rows = await testDb.query<{ user_id: string; delta: string }>(
      `select user_id, delta from ledger where reason = 'giveaway' order by user_id`,
    )
    expect(rows).toEqual([aliceId, bobId].sort().map((user_id) => ({ user_id, delta: '5' })))
    expect((await lastPost()).body).toBe('🎁 Ada gave Alice and Bob 5 chips each.')
    expect(await lastAudit('giveaway.given')).toMatchObject({
      target: '2 players',
      after: { split: false, everyone: false, amount: 5, share: 5, total: 10 },
    })
    await admin.settle()
    expect(
      events('notification')
        .map((e) => e.channel)
        .sort(),
    ).toEqual([userChannel(aliceId), userChannel(bobId)].sort())
    expect(events('notification')[0]?.envelope.data).toEqual({
      text: '🎁 Ada gave you 5 chips.',
      tone: 'good',
    })
  })

  it('splits a pot, each share rounded down to a whole chip', async () => {
    const res = await admin.post(
      '/api/admin/giveaways',
      { to: [aliceId, bobId, carolId], amount: 10, split: true, note: 'Bug bounty' },
      key(),
    )
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ share: 3, total: 9 })
    expect((await lastPost()).body).toBe(
      '🎁 Ada split 10 chips between Alice, Bob and Carol, 3 each: Bug bounty',
    )
  })

  it('gives everyone, the admin too, and leaves disabled accounts out', async () => {
    const res = await admin.post('/api/admin/giveaways', { to: 'everyone', amount: 1 }, key())
    expect(res.status).toBe(200)
    const ids = res.body.recipients.map((r: { userId: string }) => r.userId)
    expect(ids.sort()).toEqual([adminId, aliceId, bobId, carolId].sort())
    expect((await lastPost()).body).toBe('🎁 Ada gave everyone 1 chip.')
    expect(await lastAudit('giveaway.given')).toMatchObject({ target: 'everyone' })
    await admin.settle()
    expect(events('notification').map((e) => e.channel)).not.toContain(userChannel(adminId))
  })

  it('refuses a disabled player, a stranger, and a share under a chip', async () => {
    const [dave] = await testDb.query<{ id: string }>(
      `select id from users where username = 'dave'`,
    )
    const disabled = await admin.post(
      '/api/admin/giveaways',
      { to: [aliceId, dave?.id], amount: 100 },
      key(),
    )
    expect(disabled.status).toBe(409)
    expect(disabled.body.error.message).toBe(
      'Dave is disabled. Enable them first, or leave them out.',
    )

    const stranger = await admin.post(
      '/api/admin/giveaways',
      { to: [randomUUID()], amount: 100 },
      key(),
    )
    expect(stranger.status).toBe(400)
    expect(stranger.body.error.code).toBe('unknown_player')

    const tiny = await admin.post(
      '/api/admin/giveaways',
      { to: [aliceId, bobId, carolId], amount: 2, split: true },
      key(),
    )
    expect(tiny.status).toBe(400)
    expect(tiny.body.error).toMatchObject({
      code: 'too_small',
      message:
        '2 chips is too little to split between 3 players. Each share needs at least 1 chip.',
    })
  })
})

describe('accounts', () => {
  it('lists every account with its chips this season, active ones first', async () => {
    const res = await admin.get('/api/admin/players')
    expect(res.status).toBe(200)
    expect(res.body.seasonId).toBe(seasonId)
    const names = res.body.players.map((p: { displayName: string }) => p.displayName)
    expect(names).toEqual(['Ada', 'Alice', 'Bob', 'Carol', 'Dave'])
    const ada = res.body.players[0]
    expect(ada).toMatchObject({ role: 'admin', disabledAt: null, wallet: { vault: 0 } })
    expect(ada.lastSeenAt).not.toBeNull()
    expect(res.body.players.at(-1)).toMatchObject({ displayName: 'Dave', wallet: null })
    expect(res.body.players.at(-1).disabledAt).not.toBeNull()
  })

  it('disables an account: it is signed out at once and its chips stay put', async () => {
    const eveId = await player('eve', 'Eve')
    await fundWallet(seasonId, eveId, 50n)
    const eve = await loggedIn(coreApi, eveId)
    expect((await eve.get('/api/me')).status).toBe(200)

    const res = await admin.post(
      `/api/admin/players/${eveId}/disable`,
      { reason: 'Left the group' },
      key(),
    )
    expect(res.status).toBe(200)
    expect(res.body.player.disabledAt).not.toBeNull()
    expect(res.body.player.wallet).toMatchObject({ balance: 50 })
    expect((await eve.get('/api/me')).status).toBe(401)
    expect(await lastAudit('player.disabled')).toMatchObject({
      target: 'eve',
      after: { userId: eveId },
      reason: 'Left the group',
    })
    await admin.settle()
    expect(events('notification')[0]?.channel).toBe(userChannel(eveId))

    const again = await admin.post(`/api/admin/players/${eveId}/disable`, {}, key())
    expect(again.status).toBe(409)
    const self = await admin.post(`/api/admin/players/${adminId}/disable`, {}, key())
    expect(self.status).toBe(409)
    expect(self.body.error.message).toBe('You cannot disable your own account.')

    const back = await admin.post(`/api/admin/players/${eveId}/enable`, {}, key())
    expect(back.status).toBe(200)
    expect(back.body.player).toMatchObject({ disabledAt: null, wallet: { balance: 50 } })
    expect(await lastAudit('player.enabled')).toMatchObject({ target: 'eve' })
    const twice = await admin.post(`/api/admin/players/${eveId}/enable`, {}, key())
    expect(twice.status).toBe(409)
  })

  it('refuses an address that is not a player', async () => {
    const res = await admin.post('/api/admin/players/not-a-uuid/disable', {}, key())
    expect(res.status).toBe(400)
    expect((await admin.post(`/api/admin/players/${randomUUID()}/disable`, {}, key())).status).toBe(
      404,
    )
  })
})

describe('outside a running season', () => {
  afterAll(async () => {
    await testDb.query(`update seasons set ends_at = now() + interval '29 days' where id = $1`, [
      seasonId,
    ])
  })

  it('moves no chips once the season has ended', async () => {
    const season = await runningSeason()
    if (!season) throw new Error('no season')
    await testDb.query(`update seasons set ends_at = now() - interval '1 second' where id = $1`, [
      seasonId,
    ])
    const res = await admin.post(
      '/api/admin/chips',
      { userId: aliceId, amount: 100, reason: 'Too late' },
      key(),
    )
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('no_season')
    const gift = await admin.post('/api/admin/giveaways', { to: 'everyone', amount: 100 }, key())
    expect(gift.status).toBe(409)

    // A request that found the season running just before the end is refused inside its transaction.
    const late = db().transaction((tx) =>
      adjustChips(
        tx,
        season,
        { id: adminId, displayName: 'Ada' },
        { userId: aliceId, amount: 100, account: 'wallet', reason: 'Too late' },
        () => {},
      ),
    )
    await expect(late).rejects.toMatchObject({ status: 409, code: 'season_over' })
  })
})
