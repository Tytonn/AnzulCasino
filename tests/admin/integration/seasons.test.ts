/**
 * Ending a season early and editing one before it starts, against a real
 * database (spec: Admin panel > Seasons; Accounts and seasons > Seasons).
 * An early end only ever moves the end earlier, and the economy's lifecycle
 * then does what it does at any end: the final-day post, the frozen
 * standings and the podium.
 */
import { randomUUID } from 'node:crypto'

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { centralWhen } from '../../../shared/features/admin.ts'
import { adminApi } from '../../../server/features/admin/api.ts'
import { forgetMoments } from '../../../server/features/season/moments.ts'
import { db } from '../../../server/lib/db.ts'
import { captureLive, type Outgoing } from '../../../server/lib/live.ts'
import { requireBetsOpen } from '../../../server/lib/seasons.ts'
import type { ApiClient } from '../../helpers/api.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { createPlayer, fundWallet, loggedIn } from '../../helpers/fixtures.ts'

const testDb = await useTestDatabase()

let adminId: string
let admin: ApiClient
let capture: { events: Outgoing[]; stop(): void }

const key = () => ({ 'idempotency-key': randomUUID() })

async function season(name: string, starts: string, ends: string, status = 'active') {
  const [row] = await testDb.query<{ id: number }>(
    `insert into seasons (name, starts_at, ends_at, starting_balance, status)
     values ($1, now() + $2::interval, now() + $3::interval, 10000, $4) returning id`,
    [name, starts, ends, status],
  )
  if (!row) throw new Error('no season')
  return row.id
}

async function stored(id: number) {
  const [row] = await testDb.query<{
    name: string
    status: string
    ends_at: Date
    starts_at: Date
  }>(`select name, status, ends_at, starts_at from seasons where id = $1`, [id])
  if (!row) throw new Error('no season')
  return row
}

function posts(): string[] {
  return capture.events
    .filter((e) => e.name === 'chat.message')
    .map((e) => (e.envelope.data as { body: string }).body)
}

beforeAll(async () => {
  adminId = await createPlayer(testDb, 'ada')
  await testDb.query(`update users set role = 'admin', display_name = 'Ada' where id = $1`, [
    adminId,
  ])
  admin = await loggedIn(adminApi, adminId)
})

beforeEach(async () => {
  capture = captureLive()
  forgetMoments()
  await testDb.query(`delete from rate_limits`)
})

afterEach(() => capture.stop())

describe('ending a season early', () => {
  it('ends it at once: chat hears it, the standings freeze and the podium goes up', async () => {
    const id = await season('Autumn', '-2 days', '10 days')
    const alice = await createPlayer(testDb, 'alice')
    const bob = await createPlayer(testDb, 'bob')
    await testDb.query(`update users set display_name = initcap(username) where id = any($1)`, [
      [alice, bob],
    ])
    await fundWallet(id, alice, 15_000n)
    await fundWallet(id, bob, 12_000n)
    const before = await stored(id)

    const res = await admin.post(
      `/api/admin/seasons/${id}/end`,
      { reason: 'Moving to the new rules' },
      key(),
    )
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ immediate: true, season: { id, phase: 'over' } })
    await admin.settle()

    expect(posts()).toEqual([
      '🛑 Ada ended Autumn early: Moving to the new rules',
      '🏁 Autumn is over! 🥇 Alice 150 · 🥈 Bob 120. Every place is in the Hall of Fame.',
    ])
    expect((await stored(id)).status).toBe('ended')
    const results = await testDb.query<{ user_id: string; final_rank: number }>(
      `select user_id, final_rank from season_results where season_id = $1 order by final_rank`,
      [id],
    )
    expect(results).toEqual([
      { user_id: alice, final_rank: 1 },
      { user_id: bob, final_rank: 2 },
    ])
    await expect(db().transaction((tx) => requireBetsOpen(tx, id))).rejects.toMatchObject({
      code: 'season_over',
    })

    const [audit] = await testDb.query<{ target: string; before: unknown; after: unknown }>(
      `select target, before, after from audit_log where action = 'season.ended_early'`,
    )
    expect(audit).toEqual({
      target: `season:${id}`,
      before: { endsAt: before.ends_at.toISOString() },
      after: { endsAt: expect.any(String), immediate: true },
    })
    const names = capture.events.map((e) => e.name)
    expect(names).toContain('season.state')
    expect(names).toContain('audit.logged')

    const again = await admin.post(`/api/admin/seasons/${id}/end`, {}, key())
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('season_over')
  })

  it('moves the end earlier, straight into the final day when it is that close', async () => {
    const id = await season('Winter', '-1 hour', '20 days')
    const at = new Date(Date.now() + 5 * 3_600_000)
    const res = await admin.post(
      `/api/admin/seasons/${id}/end`,
      { at: at.toISOString(), reason: 'Short trial' },
      key(),
    )
    expect(res.status).toBe(200)
    expect(res.body.immediate).toBe(false)
    expect(res.body.season.endsAt).toBe(at.toISOString())
    await admin.settle()
    expect(posts()).toEqual([
      `⏱️ Ada moved the end of Winter to ${centralWhen(at)}: Short trial`,
      '⏳ The final day of Winter has begun: 5 hours to go. Steals, shields, vault moves and rank purchases are off now. The games stay open right to the end.',
    ])
    expect((await stored(id)).status).toBe('final_day')

    const later = await admin.post(
      `/api/admin/seasons/${id}/end`,
      { at: new Date(Date.now() + 6 * 3_600_000).toISOString() },
      key(),
    )
    expect(later.status).toBe(400)
    expect(later.body.error.code).toBe('not_earlier')

    // A time already past counts as now.
    const past = await admin.post(
      `/api/admin/seasons/${id}/end`,
      { at: new Date(Date.now() - 60_000).toISOString() },
      key(),
    )
    expect(past.status).toBe(200)
    expect(past.body.immediate).toBe(true)
  })

  it('refuses a season that has not started', async () => {
    const id = await season('Spring', '30 days', '60 days', 'scheduled')
    const res = await admin.post(`/api/admin/seasons/${id}/end`, {}, key())
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('season_not_started')
    expect((await admin.post('/api/admin/seasons/9999/end', {}, key())).status).toBe(404)
    expect((await admin.post('/api/admin/seasons/nope/end', {}, key())).status).toBe(400)
  })
})

describe('editing a season', () => {
  it('changes a season before it starts, logging only what changed', async () => {
    const [spring] = await testDb.query<{ id: number }>(
      `select id from seasons where name = 'Spring'`,
    )
    const id = spring?.id as number
    const startsAt = new Date(Date.now() + 31 * 86_400_000)
    const res = await admin.patch(
      `/api/admin/seasons/${id}`,
      { name: 'Spring 2027', startsAt: startsAt.toISOString(), startingBalance: 20_000 },
      key(),
    )
    expect(res.status).toBe(200)
    expect(res.body.season).toMatchObject({
      name: 'Spring 2027',
      startsAt: startsAt.toISOString(),
      startingBalance: 20_000,
      phase: 'upcoming',
    })
    const [audit] = await testDb.query<{ before: unknown; after: unknown }>(
      `select before, after from audit_log where action = 'season.updated' order by id desc limit 1`,
    )
    expect(audit).toEqual({
      before: { name: 'Spring', startsAt: expect.any(String), startingBalance: 10_000 },
      after: { name: 'Spring 2027', startsAt: startsAt.toISOString(), startingBalance: 20_000 },
    })

    const same = await admin.patch(`/api/admin/seasons/${id}`, { name: 'Spring 2027' }, key())
    expect(same.status).toBe(200)
    const [count] = await testDb.query<{ n: number }>(
      `select count(*)::int as n from audit_log where action = 'season.updated'`,
    )
    expect(count?.n).toBe(1)
  })

  it('refuses dates that overlap, run backwards or start in the past', async () => {
    const [spring] = await testDb.query<{ id: number }>(
      `select id from seasons where name = 'Spring 2027'`,
    )
    const id = spring?.id as number
    await season('Summer', '70 days', '100 days', 'scheduled')
    const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

    const overlap = await admin.patch(`/api/admin/seasons/${id}`, { endsAt: inDays(80) }, key())
    expect(overlap.status).toBe(409)
    expect(overlap.body.error.message).toBe('That overlaps Summer. Seasons cannot overlap.')

    const backwards = await admin.patch(`/api/admin/seasons/${id}`, { endsAt: inDays(20) }, key())
    expect(backwards.status).toBe(400)
    expect(backwards.body.error.code).toBe('ends_before_start')

    const past = await admin.patch(`/api/admin/seasons/${id}`, { startsAt: inDays(-1) }, key())
    expect(past.status).toBe(400)
    expect(past.body.error.code).toBe('starts_in_past')

    const nothing = await admin.patch(`/api/admin/seasons/${id}`, {}, key())
    expect(nothing.status).toBe(400)
    expect(nothing.body.error.message).toBe('Change something first.')
  })

  it('only renames a season that has started, even one that is over', async () => {
    const [autumn] = await testDb.query<{ id: number }>(
      `select id from seasons where name = 'Autumn'`,
    )
    const id = autumn?.id as number
    const dates = await admin.patch(
      `/api/admin/seasons/${id}`,
      { endsAt: new Date(Date.now() + 86_400_000).toISOString() },
      key(),
    )
    expect(dates.status).toBe(409)
    expect(dates.body.error.code).toBe('season_started')

    const renamed = await admin.patch(`/api/admin/seasons/${id}`, { name: 'Autumn (short)' }, key())
    expect(renamed.status).toBe(200)
    expect(renamed.body.season).toMatchObject({ name: 'Autumn (short)', phase: 'over' })
  })
})
