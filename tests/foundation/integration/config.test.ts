/**
 * Config (spec rule 9): defaults from one file, admin changes from the table,
 * economy and steal changes waiting for the next daily reset.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { configDefaults } from '../../../shared/config.ts'
import { nextReset } from '../../../shared/game-day.ts'
import { coreApi } from '../../../server/core/api.ts'
import { changeConfig, loadConfig, pendingConfigChanges } from '../../../server/lib/config.ts'
import { db } from '../../../server/lib/db.ts'
import { apiClient } from '../../helpers/api.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { createPlayer, loggedIn } from '../../helpers/fixtures.ts'

const testDb = await useTestDatabase()

let admin: string

beforeAll(async () => {
  admin = await createPlayer(testDb, 'config_admin')
})

afterEach(async () => {
  await testDb.query('delete from config')
})

async function dbNow(): Promise<Date> {
  const [row] = await testDb.query<{ now: Date }>('select now() as now')
  if (!row) throw new Error('no time')
  return row.now
}

function change(key: string, value: unknown, now: Date, reason?: string) {
  return db().transaction((tx) => changeConfig(tx, { key, value, actorId: admin, reason, now }))
}

describe('loadConfig', () => {
  it('gives the defaults when nothing has changed', async () => {
    expect(await loadConfig(db())).toEqual(configDefaults())
  })

  it('ignores a stored value that is no longer valid', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await testDb.query(
      `insert into config (key, value) values ('steal_success_pct', '99999'), ('retired_key', '5')`,
    )
    const cfg = await loadConfig(db())
    expect(cfg.steal_success_pct).toBe(5_500)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/steal_success_pct/))
    warn.mockRestore()
  })
})

describe('changeConfig', () => {
  it('applies a game setting at once and writes it to the audit log', async () => {
    const now = await dbNow()
    const { effectiveAt } = await change('min_bet', 50, now, 'Testing bigger bets')
    expect(effectiveAt).toEqual(now)
    expect((await loadConfig(db())).min_bet).toBe(50n)

    const [audit] = await testDb.query<{
      action: string
      target: string
      before: unknown
      after: unknown
      reason: string
    }>(
      `select action, target, before, after, reason from audit_log
       where action = 'config.changed' order by id desc limit 1`,
    )
    expect(audit).toEqual({
      action: 'config.changed',
      target: 'min_bet',
      before: { value: 25 },
      after: { value: 50, effectiveAt: now.toISOString() },
      reason: 'Testing bigger bets',
    })
  })

  it('makes a steal change wait for the next daily reset', async () => {
    const now = await dbNow()
    const { effectiveAt } = await change('steal_success_pct', 6_000, now)
    expect(effectiveAt).toEqual(nextReset(now))
    expect((await loadConfig(db())).steal_success_pct).toBe(5_500)
    expect(await pendingConfigChanges(db())).toEqual([
      { key: 'steal_success_pct', value: 6_000, effectiveAt, updatedBy: admin, reason: null },
    ])

    // The reset arrives.
    await testDb.query(`update config set effective_at = now() - interval '1 second'`)
    expect((await loadConfig(db())).steal_success_pct).toBe(6_000)
    expect(await pendingConfigChanges(db())).toEqual([])
  })

  it('lets the latest change win', async () => {
    const now = await dbNow()
    await change('min_bet', 3, now)
    await change('min_bet', 4, now)
    expect((await loadConfig(db())).min_bet).toBe(4n)
  })

  it('stores lines as a list and applies them at once', async () => {
    const now = await dbNow()
    const lines = ['You sold hot dogs at the door.', 'You fixed the jukebox.']
    const { effectiveAt } = await change('work_lines', lines, now, 'New lines')
    expect(effectiveAt).toEqual(now)
    expect((await loadConfig(db())).work_lines).toEqual(lines)
    const [audit] = await testDb.query<{ before: { value: string[] }; after: { value: string[] } }>(
      `select before, after from audit_log where target = 'work_lines' order by id desc limit 1`,
    )
    expect(audit?.before.value).toEqual(configDefaults().work_lines)
    expect(audit?.after.value).toEqual(lines)
  })

  it('refuses a minimum above its maximum, from either side', async () => {
    const now = await dbNow()
    await expect(change('work_pay_min', 70, now)).rejects.toMatchObject({
      status: 400,
      message: 'work_pay_min cannot be more than work_pay_max, which is 60 chips.',
    })
    await expect(change('work_pay_max', 10, now)).rejects.toMatchObject({
      status: 400,
      message: 'work_pay_max cannot be less than work_pay_min, which is 20 chips.',
    })
    // Raising the maximum first makes room, even while it waits for the reset.
    await change('work_pay_max', 100, now)
    await change('work_pay_min', 70, now)
    expect(await pendingConfigChanges(db())).toHaveLength(2)
    // A minimum equal to the maximum is a fixed amount, which is fine.
    await change('crime_fine_min', 300, now)
  })

  it('refuses unknown keys and bad values, and stores nothing', async () => {
    const now = await dbNow()
    await expect(change('no_such_key', 1, now)).rejects.toMatchObject({ status: 400 })
    await expect(change('min_bet', -5, now)).rejects.toMatchObject({
      status: 400,
      code: 'invalid_config_value',
    })
    await expect(change('min_bet', '100', now)).rejects.toMatchObject({ status: 400 })
    expect(await testDb.query('select * from config')).toEqual([])
  })
})

describe('GET /api/config', () => {
  it('needs a session', async () => {
    expect((await apiClient(coreApi).get('/api/config')).status).toBe(401)
  })

  it('sends every value, chips as whole numbers', async () => {
    await change('min_bet', 50, await dbNow())
    const player = await loggedIn(coreApi, await createPlayer(testDb))
    const res = await player.get('/api/config')
    expect(res.status).toBe(200)
    expect(res.body.config.min_bet).toBe(50)
    expect(res.body.config.starting_balance).toBe(1_000)
    expect(res.body.config.steal_base_rate).toBe(150)
  })
})
