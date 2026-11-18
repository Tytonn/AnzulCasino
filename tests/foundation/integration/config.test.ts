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
    const { effectiveAt } = await change('min_bet', 250, now, 'Testing bigger bets')
    expect(effectiveAt).toEqual(now)
    expect((await loadConfig(db())).min_bet).toBe(250n)

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
      before: { value: 100 },
      after: { value: 250, effectiveAt: now.toISOString() },
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
    await change('min_bet', 300, now)
    await change('min_bet', 400, now)
    expect((await loadConfig(db())).min_bet).toBe(400n)
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

  it('sends every value, chips as hundredths', async () => {
    await change('min_bet', 250, await dbNow())
    const player = await loggedIn(coreApi, await createPlayer(testDb))
    const res = await player.get('/api/config')
    expect(res.status).toBe(200)
    expect(res.body.config.min_bet).toBe(250)
    expect(res.body.config.starting_balance).toBe(10_000)
    expect(res.body.config.steal_base_rate).toBe(150)
  })
})
