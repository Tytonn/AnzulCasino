/**
 * The public Audit page against a real database (spec: Admin and trust >
 * The audit page): every player reads every admin action, newest first, a
 * page at a time, with the people it names by their current names and the
 * setting changes still waiting for the reset listed ahead of time.
 */
import { randomUUID } from 'node:crypto'

import { beforeAll, describe, expect, it } from 'vitest'

import type { AuditEntryView, AuditPage } from '../../../shared/features/admin.ts'
import { coreApi } from '../../../server/core/api.ts'
import { adminApi } from '../../../server/features/admin/api.ts'
import type { ApiClient } from '../../helpers/api.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { createPlayer, createSeason, fundWallet, loggedIn } from '../../helpers/fixtures.ts'

const testDb = await useTestDatabase()

let seasonId: number
let adminId: string
let aliceId: string
let admin: ApiClient
let core: ApiClient
let alice: ApiClient

const key = () => ({ 'idempotency-key': randomUUID() })

beforeAll(async () => {
  seasonId = await createSeason(testDb)
  adminId = await createPlayer(testDb, 'ada')
  aliceId = await createPlayer(testDb, 'alice')
  await testDb.query(`update users set role = 'admin', display_name = 'Ada' where id = $1`, [
    adminId,
  ])
  await testDb.query(`update users set display_name = 'Alice' where id = $1`, [aliceId])
  await fundWallet(seasonId, aliceId, 10_000n)
  admin = await loggedIn(adminApi, adminId)
  core = await loggedIn(coreApi, adminId)
  alice = await loggedIn(adminApi, aliceId)

  // A little of everything: chips, a reset code, a setting, a giveaway.
  await admin.post(
    '/api/admin/chips',
    { userId: aliceId, amount: 500, reason: 'Lost a hand to a bug' },
    key(),
  )
  await core.post('/api/invites', { kind: 'reset', username: 'alice' })
  await admin.post(
    '/api/admin/config',
    { changes: [{ key: 'steal_attempts_per_day', value: 5 }], reason: 'More chaos' },
    key(),
  )
  await admin.post('/api/admin/giveaways', { to: [aliceId], amount: 100, note: 'Thanks' }, key())
  await admin.settle()
})

describe('the Audit page', () => {
  it('shows every player each admin action, newest first, with the people it names', async () => {
    const res = await alice.get<AuditPage>('/api/admin/audit')
    expect(res.status).toBe(200)
    expect(res.body.entries.map((e) => e.action)).toEqual([
      'giveaway.given',
      'config.changed',
      'reset_code.created',
      'chips.adjusted',
    ])
    const adjusted = res.body.entries.at(-1) as AuditEntryView
    expect(adjusted).toMatchObject({
      kind: 'chips',
      actor: { id: adminId, displayName: 'Ada' },
      target: 'alice',
      reason: 'Lost a hand to a bug',
      season: { id: seasonId, name: 'Test season' },
      people: { [adminId]: { username: 'ada' }, [aliceId]: { username: 'alice' } },
    })
    const reset = res.body.entries[2] as AuditEntryView
    expect(reset).toMatchObject({
      kind: 'accounts',
      people: { [aliceId]: { displayName: 'Alice' } },
    })
    expect(res.body.more).toBe(false)
  })

  it('names people as they are called now', async () => {
    await testDb.query(`update users set display_name = 'Alice B' where id = $1`, [aliceId])
    const res = await alice.get<AuditPage>('/api/admin/audit')
    const giveaway = res.body.entries[0] as AuditEntryView
    expect(giveaway.people[aliceId]?.displayName).toBe('Alice B')
    await testDb.query(`update users set display_name = 'Alice' where id = $1`, [aliceId])
  })

  it('lists a setting change that waits for the reset ahead of time', async () => {
    const res = await alice.get<AuditPage>('/api/admin/audit')
    expect(res.body.pending).toEqual([
      {
        key: 'steal_attempts_per_day',
        value: 5,
        current: 2,
        effectiveAt: res.body.nextReset,
        by: expect.objectContaining({ id: adminId, displayName: 'Ada' }),
        reason: 'More chaos',
      },
    ])
  })

  it('filters by kind and pages back, with the waiting changes on the first page only', async () => {
    const chips = await alice.get<AuditPage>('/api/admin/audit?kind=chips')
    expect(chips.body.entries.map((e) => e.action)).toEqual(['giveaway.given', 'chips.adjusted'])

    const first = await alice.get<AuditPage>('/api/admin/audit?limit=2')
    expect(first.body.entries).toHaveLength(2)
    expect(first.body.more).toBe(true)
    const last = first.body.entries.at(-1) as AuditEntryView
    const next = await alice.get<AuditPage>(`/api/admin/audit?limit=2&before=${last.id}`)
    expect(next.body.entries.map((e) => e.action)).toEqual(['reset_code.created', 'chips.adjusted'])
    expect(next.body.more).toBe(false)
    expect(next.body.pending).toEqual([])

    const bad = await alice.get('/api/admin/audit?kind=secrets')
    expect(bad.status).toBe(400)
  })
})
