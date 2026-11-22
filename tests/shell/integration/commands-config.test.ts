/**
 * Changing the command and stream settings (spec: Commands): the server
 * refuses a word another command has, and every change goes out as live
 * news so open browsers fetch the new words at once.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { coreApi } from '../../../server/core/api.ts'
import { changeConfig, loadConfig } from '../../../server/lib/config.ts'
import { db } from '../../../server/lib/db.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { createPlayer, loggedIn } from '../../helpers/fixtures.ts'

const testDb = await useTestDatabase()

let admin: string

beforeAll(async () => {
  admin = await createPlayer(testDb, 'commands_admin')
})

afterEach(async () => {
  await testDb.query('delete from config')
})

function change(key: string, value: unknown) {
  return db().transaction((tx) => changeConfig(tx, { key, value, actorId: admin, now: new Date() }))
}

describe('changing a command', () => {
  it('refuses a word another command has, and stores nothing', async () => {
    await expect(change('command_roulette', ['roulette', 'bj'])).rejects.toMatchObject({
      status: 400,
      code: 'invalid_config_value',
      message: '"bj" already belongs to Blackjack.',
    })
    await expect(change('command_blackjack', ['b j'])).rejects.toMatchObject({
      status: 400,
      code: 'invalid_config_value',
    })
    expect(await testDb.query('select * from config')).toEqual([])
  })

  it('frees a word once its command lets go of it, and compares the newest words', async () => {
    await change('command_blackjack', ['blackjack', 'twentyone'])
    await change('command_roulette', ['roulette', 'rl', 'bj'])
    await expect(change('command_coinflip', ['flip', 'twentyone'])).rejects.toMatchObject({
      message: '"twentyone" already belongs to Blackjack.',
    })
    const cfg = await loadConfig(db())
    expect(cfg.command_blackjack).toEqual(['blackjack', 'twentyone'])
    expect(cfg.command_roulette).toEqual(['roulette', 'rl', 'bj'])
  })

  it('takes a new prefix at once, and refuses letters', async () => {
    const { effectiveAt } = await change('command_prefix', '!')
    expect(effectiveAt.getTime()).toBeLessThanOrEqual(Date.now())
    expect((await loadConfig(db())).command_prefix).toBe('!')
    await expect(change('command_prefix', 'x')).rejects.toMatchObject({ status: 400 })
  })
})

describe('changing a stream switch', () => {
  it('applies at once and sends the news to every browser', async () => {
    const { news } = await change('stream_round_runs', 'separate')
    const [row] = await testDb.query<{ id: string }>(
      `select id from config where key = 'stream_round_runs'`,
    )
    expect(news).toHaveLength(1)
    expect(news[0]).toMatchObject({
      channel: 'feed',
      name: 'config.changed',
      envelope: { version: Number(row?.id), data: { key: 'stream_round_runs' } },
    })
    expect((await loadConfig(db())).stream_round_runs).toBe('separate')
    await expect(change('stream_bal_lb', 'everyone')).rejects.toMatchObject({
      message: 'stream_bal_lb must be private or public.',
    })
  })

  it('reaches the browser through GET /api/config', async () => {
    await change('stream_bal_lb', 'public')
    const player = await loggedIn(coreApi, await createPlayer(testDb))
    const res = await player.get('/api/config')
    expect(res.status).toBe(200)
    expect(res.body.config.stream_bal_lb).toBe('public')
    expect(res.body.config.stream_round_runs).toBe('fold')
    expect(res.body.config.command_prefix).toBe('.')
    expect(res.body.config.command_blackjack).toEqual(['bj', 'blackjack'])
  })
})
