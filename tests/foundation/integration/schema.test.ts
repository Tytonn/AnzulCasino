import { describe, expect, it } from 'vitest'

import { useTestDatabase } from '../../helpers/db.ts'

const db = await useTestDatabase()

const DATA_MODEL = [
  'users',
  'sessions',
  'invite_codes',
  'seasons',
  'wallets',
  'ledger',
  'game_rounds',
  'shared_rounds',
  'daily_state',
  'steals',
  'shields',
  'shield_purchases',
  'chat_messages',
  'config',
  'audit_log',
  'season_results',
  'net_worth_snapshots',
  'idempotency_keys',
  'rate_limits',
]

async function player(name: string): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO users (username, password_hash, display_name) VALUES ($1, 'x', $1) RETURNING id`,
    [name],
  )
  return row!.id
}

async function season(): Promise<number> {
  const [row] = await db.query<{ id: number }>(
    `INSERT INTO seasons (name, starts_at, ends_at, starting_balance)
     VALUES ('Test', now(), now() + interval '30 days', 10000) RETURNING id`,
  )
  return row!.id
}

async function wallet(seasonId: number, userId: string, balance = 10000) {
  await db.query(`INSERT INTO wallets (season_id, user_id, balance) VALUES ($1, $2, $3)`, [
    seasonId,
    userId,
    balance,
  ])
}

describe('core schema', () => {
  it('has every table in the data model', async () => {
    const rows = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    )
    const tables = rows.map((r) => r.table_name)
    for (const table of DATA_MODEL) expect(tables).toContain(table)
  })

  it('keeps usernames unique without regard to case', async () => {
    await player('Lucky_7')
    await expect(player('lucky_7')).rejects.toThrow(/users_username_lower_key/)
  })

  it('never lets a wallet go below zero', async () => {
    const s = await season()
    const u = await player('broke')
    await wallet(s, u, 500)
    await expect(
      db.query(`UPDATE wallets SET balance = balance - 501 WHERE season_id = $1 AND user_id = $2`, [
        s,
        u,
      ]),
    ).rejects.toThrow(/wallets_balance_check/)
  })

  it('allows one open round per player per game', async () => {
    const s = await season()
    const u = await player('roller')
    await wallet(s, u)
    const open = `INSERT INTO game_rounds (season_id, user_id, game, stake) VALUES ($1, $2, $3, 100) RETURNING id`
    const [first] = await db.query<{ id: number }>(open, [s, u, 'coinflip'])
    await expect(db.query(open, [s, u, 'coinflip'])).rejects.toThrow(/game_rounds_one_open_key/)
    // Another game is fine, and so is a new round once the first is settled.
    await db.query(open, [s, u, 'blackjack'])
    await db.query(
      `UPDATE game_rounds SET status = 'settled', payout = 0, settled_at = now() WHERE id = $1`,
      [first!.id],
    )
    await db.query(open, [s, u, 'coinflip'])
  })

  it('refuses to keep a secret on a settled round', async () => {
    const s = await season()
    const u = await player('dealer')
    await wallet(s, u)
    const [round] = await db.query<{ id: number }>(
      `INSERT INTO game_rounds (season_id, user_id, game, stake, secret)
       VALUES ($1, $2, 'blackjack', 100, '{"hole": "AS"}') RETURNING id`,
      [s, u],
    )
    await expect(
      db.query(
        `UPDATE game_rounds SET status = 'settled', payout = 0, settled_at = now() WHERE id = $1`,
        [round!.id],
      ),
    ).rejects.toThrow(/game_rounds_secret_check/)
  })

  it('refuses ledger rows for a player without a wallet in that season', async () => {
    const s = await season()
    const u = await player('ghost')
    await expect(
      db.query(
        `INSERT INTO ledger (season_id, user_id, account, delta, balance_after, reason)
         VALUES ($1, $2, 'wallet', 100, 100, 'season_start')`,
        [s, u],
      ),
    ).rejects.toThrow(/ledger_wallet_fk/)
  })

  it('refuses a zero ledger row', async () => {
    const s = await season()
    const u = await player('zero')
    await wallet(s, u)
    await expect(
      db.query(
        `INSERT INTO ledger (season_id, user_id, account, delta, balance_after, reason)
         VALUES ($1, $2, 'wallet', 0, 100, 'bet')`,
        [s, u],
      ),
    ).rejects.toThrow(/ledger_delta_check/)
  })

  it('allows one result per round number of a shared game', async () => {
    const s = await season()
    const insert = `INSERT INTO shared_rounds (season_id, game, round_no, state, opens_at, closes_at)
                    VALUES ($1, 'roulette', 42, 'betting', now(), now() + interval '20 seconds')`
    await db.query(insert, [s])
    await expect(db.query(insert, [s])).rejects.toThrow(/shared_rounds_round_key/)
  })

  it('stores a GIF message with its Klipy id and URLs, from a player only', async () => {
    const u = await player('gif_fan')
    const meta = {
      gif: {
        provider: 'klipy',
        id: 'abc123',
        url: 'https://example.invalid/a.gif',
        width: 200,
        height: 150,
      },
    }
    await db.query(
      `INSERT INTO chat_messages (user_id, kind, body, meta) VALUES ($1, 'gif', 'Dancing cat', $2)`,
      [u, meta],
    )
    await expect(
      db.query(`INSERT INTO chat_messages (kind, body, meta) VALUES ('gif', 'x', $1)`, [meta]),
    ).rejects.toThrow(/chat_messages_gif_check/)
    await expect(
      db.query(`INSERT INTO chat_messages (user_id, kind, body) VALUES ($1, 'gif', 'x')`, [u]),
    ).rejects.toThrow(/chat_messages_gif_check/)
    await expect(
      db.query(`INSERT INTO chat_messages (user_id, kind, body) VALUES ($1, 'sticker', 'x')`, [u]),
    ).rejects.toThrow(/chat_messages_kind_check/)
  })
})
