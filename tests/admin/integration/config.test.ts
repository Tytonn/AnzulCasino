/**
 * The settings editor against a real database (spec: Admin panel > Config;
 * Admin and trust > The audit page): several changes saved in one
 * transaction, each with its audit row and its live news; economy and steal
 * changes waiting for the daily reset and listed ahead of time; a refusal
 * naming its setting; and changes that depend on each other's order.
 */
import { randomUUID } from 'node:crypto'

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { CONFIG_KEYS } from '../../../shared/config.ts'
import type { AdminConfigState, ConfigSaveResponse } from '../../../shared/features/admin.ts'
import { adminApi } from '../../../server/features/admin/api.ts'
import { loadConfig } from '../../../server/lib/config.ts'
import { db } from '../../../server/lib/db.ts'
import { captureLive, type Outgoing } from '../../../server/lib/live.ts'
import type { ApiClient } from '../../helpers/api.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { createPlayer, loggedIn } from '../../helpers/fixtures.ts'

const testDb = await useTestDatabase()

let adminId: string
let admin: ApiClient
let capture: { events: Outgoing[]; stop(): void }

const key = () => ({ 'idempotency-key': randomUUID() })

/** A refusal's body has `error` in place of the saved state. */
type SaveBody = ConfigSaveResponse & { error: { code: string; key?: string; message: string } }

function save(changes: { key: string; value: unknown }[], reason?: string) {
  return admin.post<SaveBody>('/api/admin/config', { changes, reason }, key())
}

async function auditRows() {
  return testDb.query<{ target: string; before: unknown; after: unknown; reason: string | null }>(
    `select target, before, after, reason from audit_log where action = 'config.changed' order by id`,
  )
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
  await testDb.query(`delete from rate_limits`)
})

afterEach(async () => {
  await admin.settle()
  capture.stop()
  await testDb.query(`delete from config`)
  await testDb.query(`delete from audit_log`)
})

describe('reading the settings', () => {
  it('sends every value in force, in its wire form, with when the next reset is', async () => {
    const res = await admin.get<AdminConfigState>('/api/admin/config')
    expect(res.status).toBe(200)
    expect(Object.keys(res.body.values).sort()).toEqual([...CONFIG_KEYS].sort())
    expect(res.body.values.starting_balance).toBe(1_000)
    expect(res.body.values.command_blackjack).toEqual(['bj', 'blackjack'])
    expect(res.body.values.stream_bal_lb).toBe('private')
    expect(res.body.pending).toEqual([])
    expect(res.body.changed).toEqual({})
    expect(new Date(res.body.nextReset).getTime()).toBeGreaterThan(Date.now())
  })
})

describe('saving', () => {
  it('applies a change at once, logs it, and tells every browser', async () => {
    const res = await save(
      [
        { key: 'hustle_name', value: 'Hustle' },
        { key: 'stream_round_runs', value: 'separate' },
      ],
      'Trying it out',
    )
    expect(res.status).toBe(200)
    expect(res.body.saved.map((s) => s.key)).toEqual(['hustle_name', 'stream_round_runs'])
    expect(res.body.state.values.hustle_name).toBe('Hustle')
    expect(res.body.state.changed.hustle_name).toMatchObject({
      by: { id: adminId, displayName: 'Ada' },
      reason: 'Trying it out',
    })
    const config = await loadConfig(db())
    expect(config.hustle_name).toBe('Hustle')
    expect(config.stream_round_runs).toBe('separate')

    expect(await auditRows()).toEqual([
      {
        target: 'hustle_name',
        before: { value: 'Slut' },
        after: { value: 'Hustle', effectiveAt: expect.any(String) },
        reason: 'Trying it out',
      },
      {
        target: 'stream_round_runs',
        before: { value: 'fold' },
        after: { value: 'separate', effectiveAt: expect.any(String) },
        reason: 'Trying it out',
      },
    ])

    await admin.settle()
    const names = capture.events.map((e) => e.name)
    expect(names.filter((n) => n === 'config.changed')).toHaveLength(2)
    const logged = capture.events.filter((e) => e.name === 'audit.logged')
    expect(logged.map((e) => (e.envelope.data as { target: string }).target)).toEqual([
      'hustle_name',
      'stream_round_runs',
    ])
    expect(logged[0]?.envelope.data).toMatchObject({ kind: 'config', actor: { id: adminId } })
  })

  it('holds an economy change until the next reset and lists it ahead of time', async () => {
    const res = await save([{ key: 'work_pay_max', value: 90 }])
    expect(res.status).toBe(200)
    const [saved] = res.body.saved
    expect(saved?.effectiveAt).toBe(res.body.state.nextReset)
    expect(res.body.state.values.work_pay_max).toBe(60)
    expect(res.body.state.pending).toEqual([
      {
        key: 'work_pay_max',
        value: 90,
        current: 60,
        effectiveAt: res.body.state.nextReset,
        by: expect.objectContaining({ id: adminId }),
        reason: null,
      },
    ])
    expect((await loadConfig(db())).work_pay_max).toBe(60n)

    const audit = await admin.get('/api/admin/audit')
    expect(audit.body.pending).toHaveLength(1)
  })

  it('takes a waiting change back when the value in force is saved again', async () => {
    await save([{ key: 'work_pay_max', value: 90 }])
    const res = await save([{ key: 'work_pay_max', value: 60 }])
    expect(res.status).toBe(200)
    expect(res.body.saved).toHaveLength(1)
    expect(res.body.state.pending).toEqual([])
  })

  it('skips a value that is already scheduled, writing nothing', async () => {
    const res = await save([
      { key: 'hustle_name', value: 'Slut' },
      { key: 'command_prefix', value: '.' },
    ])
    expect(res.status).toBe(200)
    expect(res.body.saved).toEqual([])
    expect(await testDb.query(`select * from config`)).toEqual([])
    expect(await auditRows()).toEqual([])
    await admin.settle()
    expect(capture.events).toEqual([])
  })

  it('names the setting it refuses, and saves none of the batch', async () => {
    const res = await save([
      { key: 'hustle_name', value: 'Grind' },
      { key: 'command_prefix', value: 'x' },
    ])
    expect(res.status).toBe(400)
    expect(res.body.error).toMatchObject({
      code: 'invalid_config_value',
      key: 'command_prefix',
      message: 'command_prefix must be 1 to 3 symbols, with no letters, digits, spaces or @.',
    })
    const unknown = await save([{ key: 'free_money', value: 1 }])
    expect(unknown.body.error).toMatchObject({ code: 'unknown_setting', key: 'free_money' })

    // A check against the database (a word another command has) is refused the same way.
    const clash = await save([
      { key: 'hustle_name', value: 'Grind' },
      { key: 'command_roulette', value: ['roulette', 'bj'] },
    ])
    expect(clash.status).toBe(400)
    expect(clash.body.error).toMatchObject({
      key: 'command_roulette',
      message: '"bj" already belongs to Blackjack.',
    })
    expect(await testDb.query(`select * from config`)).toEqual([])
  })

  it('raises a minimum and its maximum together, in whichever order works', async () => {
    const up = await save([
      { key: 'work_pay_min', value: 100 },
      { key: 'work_pay_max', value: 200 },
    ])
    expect(up.status).toBe(200)
    expect(up.body.saved.map((s) => s.key)).toEqual(['work_pay_max', 'work_pay_min'])
    const down = await save([
      { key: 'work_pay_max', value: 30 },
      { key: 'work_pay_min', value: 10 },
    ])
    expect(down.status).toBe(200)
    const wrong = await save([
      { key: 'work_pay_min', value: 500 },
      { key: 'work_pay_max', value: 400 },
    ])
    expect(wrong.status).toBe(400)
    expect(wrong.body.error.key).toBe('work_pay_min')
  })

  it('hands a word from one command to another in one save', async () => {
    const res = await save([
      { key: 'command_race', value: ['race', 'rl'] },
      { key: 'command_roulette', value: ['roulette'] },
    ])
    expect(res.status).toBe(200)
    const config = await loadConfig(db())
    expect(config.command_race).toEqual(['race', 'rl'])
    expect(config.command_roulette).toEqual(['roulette'])

    const trade = await save([
      { key: 'command_race', value: ['race', 'roulette'] },
      { key: 'command_roulette', value: ['rl'] },
    ])
    expect(trade.status).toBe(400)
    expect(trade.body.error).toMatchObject({
      key: 'command_race',
      message:
        '"roulette" already belongs to Roulette. Commands cannot trade words in one save, so take it off the other command and save that first.',
    })
  })

  it('acts once per request key', async () => {
    const headers = key()
    const body = { changes: [{ key: 'hustle_name', value: 'Grind' }] }
    const first = await admin.post('/api/admin/config', body, headers)
    const again = await admin.post('/api/admin/config', body, headers)
    expect(again.body).toEqual(first.body)
    expect(await auditRows()).toHaveLength(1)
  })
})
