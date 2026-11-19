/**
 * The wallet, the ledger and idempotency keys (spec rules 3, 4 and 5).
 *
 * These run against a real Postgres with enough connections that 50 requests
 * truly overlap, so they prove the row locks, not just the happy path.
 */
import { randomUUID } from 'node:crypto'

import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { checkBetAmount, parseBetAmount } from '../../../shared/bet-amount.ts'
import { CHIP } from '../../../shared/chips.ts'
import { db } from '../../../server/lib/db.ts'
import { badRequest } from '../../../server/lib/errors.ts'
import { createApi, route } from '../../../server/lib/http.ts'
import { chipTransaction } from '../../../server/lib/idempotency.ts'
import {
  credit,
  debit,
  InsufficientFunds,
  ledgerMismatches,
  lockWallet,
  moveBetweenAccounts,
  readWallet,
  transfer,
} from '../../../server/lib/wallet.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { createPlayer, createSeason, fundWallet, loggedIn } from '../../helpers/fixtures.ts'

// The app's pool opens connections lazily, so this applies on first use.
process.env.DATABASE_POOL_MAX = '55'
const testDb = await useTestDatabase()

let seasonId: number

beforeAll(async () => {
  seasonId = await createSeason(testDb)
})

/** A new player with `whole` chips in their wallet. */
async function player(whole: bigint): Promise<string> {
  const id = await createPlayer(testDb)
  await fundWallet(seasonId, id, whole * CHIP)
  return id
}

async function balances(userId: string) {
  const wallet = await readWallet(db(), seasonId, userId)
  if (!wallet) throw new Error('no wallet')
  return { balance: wallet.balance, vault: wallet.vault }
}

interface LedgerRow {
  account: string
  delta: string
  balance_after: string
  reason: string
  ref_type: string | null
  ref_id: string | null
  meta: unknown
}

function ledgerRows(userId: string): Promise<LedgerRow[]> {
  return testDb.query<LedgerRow>(
    `select account, delta, balance_after, reason, ref_type, ref_id, meta
     from ledger where season_id = $1 and user_id = $2 order by id`,
    [seasonId, userId],
  )
}

const key = () => ({ 'idempotency-key': randomUUID() })

// A stand-in for a game's bet endpoint, built the way a lane builds one.
const afterCommitRuns: string[] = []
const testApi = createApi([
  route({
    method: 'POST',
    path: '/api/test/bet',
    auth: 'user',
    idempotent: true,
    input: z.object({ amount: z.string().max(20) }),
    run: (ctx) =>
      chipTransaction(ctx, async (tx, afterCommit) => {
        const wallet = await lockWallet(tx, seasonId, ctx.user.id)
        const parsed = parseBetAmount(ctx.input.amount, wallet.balance)
        if (!parsed.ok) throw badRequest(parsed.error, 'invalid_bet')
        const problem = checkBetAmount(parsed.amount, wallet.balance, {
          minBet: CHIP,
          maxBetPct: 10_000,
        })
        if (problem) throw badRequest(problem, 'invalid_bet')
        const after = await debit(tx, {
          seasonId,
          userId: ctx.user.id,
          amount: parsed.amount,
          reason: 'bet',
          refType: 'test_bet',
          refId: ctx.idempotencyKey ?? undefined,
        })
        afterCommit(async () => void afterCommitRuns.push(ctx.idempotencyKey ?? ''))
        return { bet: parsed.amount, balance: after.balance }
      }),
  }),
  route({
    method: 'POST',
    path: '/api/test/other',
    auth: 'user',
    idempotent: true,
    run: (ctx) => chipTransaction(ctx, async () => ({ other: true })),
  }),
])

describe('debit and credit', () => {
  it('write one ledger row each, with the balance after it', async () => {
    const id = await player(100n)
    const out = await db().transaction((tx) =>
      debit(tx, {
        seasonId,
        userId: id,
        amount: 2_550n,
        reason: 'bet',
        refType: 'game_round',
        refId: 42,
        meta: { game: 'coinflip' },
      }),
    )
    expect(out).toMatchObject({ balance: 7_450n, vault: 0n })
    const back = await db().transaction((tx) =>
      credit(tx, { seasonId, userId: id, amount: 5_100n, reason: 'payout' }),
    )
    expect(back.balance).toBe(12_550n)

    expect(await ledgerRows(id)).toEqual([
      expect.objectContaining({ delta: '10000', balance_after: '10000', reason: 'season_start' }),
      {
        account: 'wallet',
        delta: '-2550',
        balance_after: '7450',
        reason: 'bet',
        ref_type: 'game_round',
        ref_id: '42',
        meta: { game: 'coinflip' },
      },
      expect.objectContaining({ delta: '5100', balance_after: '12550', reason: 'payout' }),
    ])
  })

  it('refuse to go below zero, and change nothing when they do', async () => {
    const id = await player(10n)
    const attempt = db().transaction(async (tx) => {
      await credit(tx, { seasonId, userId: id, amount: 500n, reason: 'payout' })
      await debit(tx, { seasonId, userId: id, amount: 1_501n, reason: 'bet' })
    })
    await expect(attempt).rejects.toBeInstanceOf(InsufficientFunds)
    await expect(attempt).rejects.toMatchObject({
      status: 400,
      code: 'insufficient_funds',
      message: 'You only have 15 chips.',
    })
    // The credit before it rolled back with it.
    expect(await balances(id)).toEqual({ balance: 1_000n, vault: 0n })
    expect(await ledgerRows(id)).toHaveLength(1)
  })

  it('refuse amounts that are not bigint hundredths above zero', async () => {
    const id = await player(1n)
    for (const amount of [0n, -100n, 100 as unknown as bigint]) {
      await expect(
        db().transaction((tx) => credit(tx, { seasonId, userId: id, amount, reason: 'payout' })),
      ).rejects.toThrow(/bigint hundredths/)
    }
    expect(await ledgerRows(id)).toHaveLength(1)
  })

  it('need a wallet in the season', async () => {
    const outsider = await createPlayer(testDb)
    await expect(
      db().transaction((tx) =>
        debit(tx, { seasonId, userId: outsider, amount: 100n, reason: 'bet' }),
      ),
    ).rejects.toMatchObject({ status: 409, code: 'no_wallet' })
  })

  it('keep an hourly net worth point as chips move', async () => {
    const id = await player(100n)
    await db().transaction((tx) => debit(tx, { seasonId, userId: id, amount: 500n, reason: 'bet' }))
    await db().transaction((tx) => debit(tx, { seasonId, userId: id, amount: 250n, reason: 'bet' }))
    const points = await testDb.query<{ net_worth: string; on_the_hour: boolean }>(
      `select net_worth, at = date_trunc('hour', at) as on_the_hour
       from net_worth_snapshots where season_id = $1 and user_id = $2`,
      [seasonId, id],
    )
    // Both moves happened in the same hour, so one point holds the latest worth.
    expect(points).toEqual([{ net_worth: '9250', on_the_hour: true }])
  })
})

describe('locking', () => {
  it('50 parallel bets cannot overdraw the wallet', async () => {
    const id = await player(100n)
    const client = await loggedIn(testApi, id)
    const results = await Promise.all(
      Array.from({ length: 50 }, () => client.post('/api/test/bet', { amount: '3' }, key())),
    )
    const accepted = results.filter((r) => r.status === 200)
    const refused = results.filter((r) => r.status !== 200)

    // 100 chips cover 33 bets of 3, with 1 chip left over.
    expect(accepted).toHaveLength(33)
    expect(refused).toHaveLength(17)
    for (const r of refused) {
      expect(r.status).toBe(400)
      expect(r.body.error.message).toBe('You only have 1 chip.')
    }
    // Each accepted bet saw the balance the one before it left.
    expect(accepted.map((r) => r.body.balance).sort((a, b) => b - a)).toEqual(
      Array.from({ length: 33 }, (_, i) => 10_000 - 300 * (i + 1)),
    )
    expect(await balances(id)).toEqual({ balance: 100n, vault: 0n })
    expect((await ledgerRows(id)).filter((r) => r.reason === 'bet')).toHaveLength(33)
  })

  it('parallel "all" bets take the wallet once', async () => {
    const id = await player(100n)
    const client = await loggedIn(testApi, id)
    const results = await Promise.all(
      Array.from({ length: 20 }, () => client.post('/api/test/bet', { amount: 'all' }, key())),
    )
    const accepted = results.filter((r) => r.status === 200)
    expect(accepted.map((r) => r.body)).toEqual([{ bet: 10_000, balance: 0 }])
    for (const r of results.filter((r) => r.status !== 200)) {
      expect(r.body.error.message).toBe('Your wallet is empty.')
    }
    expect(await balances(id)).toEqual({ balance: 0n, vault: 0n })
  })

  it('debit itself refuses an overdraw under contention', async () => {
    const id = await player(10n)
    const outcomes = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        db().transaction((tx) => debit(tx, { seasonId, userId: id, amount: 100n, reason: 'bet' })),
      ),
    )
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(10)
    const rejected = outcomes.filter((o) => o.status === 'rejected')
    expect(rejected).toHaveLength(40)
    for (const r of rejected) expect(r.reason).toBeInstanceOf(InsufficientFunds)
    expect(await balances(id)).toEqual({ balance: 0n, vault: 0n })
  })
})

describe('idempotency keys', () => {
  it('a repeated key returns the first result and changes nothing', async () => {
    const id = await player(100n)
    const client = await loggedIn(testApi, id)
    const k = key()
    const first = await client.post('/api/test/bet', { amount: '10' }, k)
    expect(first.status).toBe(200)
    expect(first.body).toEqual({ bet: 1_000, balance: 9_000 })

    const again = await client.post('/api/test/bet', { amount: '10' }, k)
    expect(again.status).toBe(200)
    expect(again.body).toEqual(first.body)
    // The key decides, even if the body changed.
    const changed = await client.post('/api/test/bet', { amount: '50' }, k)
    expect(changed.body).toEqual(first.body)

    await client.settle()
    expect(await balances(id)).toEqual({ balance: 9_000n, vault: 0n })
    expect((await ledgerRows(id)).filter((r) => r.reason === 'bet')).toHaveLength(1)
    // Live publishes and other after-commit work ran once.
    expect(afterCommitRuns.filter((run) => run === k['idempotency-key'])).toHaveLength(1)
  })

  it('ten copies of one request at the same moment run it once', async () => {
    const id = await player(100n)
    const client = await loggedIn(testApi, id)
    const k = key()
    const results = await Promise.all(
      Array.from({ length: 10 }, () => client.post('/api/test/bet', { amount: '10' }, k)),
    )
    for (const r of results) {
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ bet: 1_000, balance: 9_000 })
    }
    await client.settle()
    expect(await balances(id)).toEqual({ balance: 9_000n, vault: 0n })
    expect((await ledgerRows(id)).filter((r) => r.reason === 'bet')).toHaveLength(1)
    expect(afterCommitRuns.filter((run) => run === k['idempotency-key'])).toHaveLength(1)
  })

  it('a request that failed leaves its key free to try again', async () => {
    const id = await player(5n)
    const client = await loggedIn(testApi, id)
    const k = key()
    const refused = await client.post('/api/test/bet', { amount: '10' }, k)
    expect(refused.status).toBe(400)
    await db().transaction((tx) =>
      credit(tx, { seasonId, userId: id, amount: 1_000n, reason: 'daily_bonus' }),
    )
    const retried = await client.post('/api/test/bet', { amount: '10' }, k)
    expect(retried.status).toBe(200)
    expect(retried.body).toEqual({ bet: 1_000, balance: 500 })
  })

  it('refuses a key that was used for another action', async () => {
    const id = await player(100n)
    const client = await loggedIn(testApi, id)
    const k = key()
    expect((await client.post('/api/test/other', {}, k)).status).toBe(200)
    const reused = await client.post('/api/test/bet', { amount: '10' }, k)
    expect(reused.status).toBe(409)
    expect(reused.body.error.code).toBe('idempotency_key_reused')
    expect(await balances(id)).toEqual({ balance: 10_000n, vault: 0n })
  })

  it('keeps each player’s keys separate', async () => {
    const k = key()
    for (const id of [await player(100n), await player(100n)]) {
      const client = await loggedIn(testApi, id)
      const res = await client.post('/api/test/bet', { amount: '10' }, k)
      expect(res.body).toEqual({ bet: 1_000, balance: 9_000 })
    }
  })

  it('every chip-moving route needs a key', async () => {
    const id = await player(100n)
    const client = await loggedIn(testApi, id)
    const attempts: Record<string, string>[] = [
      {},
      { 'idempotency-key': 'short' },
      { 'idempotency-key': 'bad key!!' },
    ]
    for (const headers of attempts) {
      const res = await client.post('/api/test/bet', { amount: '10' }, headers)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('missing_idempotency_key')
    }
    expect(await balances(id)).toEqual({ balance: 10_000n, vault: 0n })
  })
})

describe('transfers', () => {
  it('move chips between two wallets with one row each', async () => {
    const thief = await player(100n)
    const target = await player(100n)
    const out = await db().transaction((tx) =>
      transfer(tx, {
        seasonId,
        fromUserId: target,
        toUserId: thief,
        amount: 2_575n,
        outReason: 'steal_out',
        inReason: 'steal_in',
        refType: 'steal',
        refId: 7,
      }),
    )
    expect(out.from.balance).toBe(7_425n)
    expect(out.to.balance).toBe(12_575n)
    expect((await ledgerRows(target)).at(-1)).toMatchObject({
      delta: '-2575',
      reason: 'steal_out',
      ref_type: 'steal',
      ref_id: '7',
    })
    expect((await ledgerRows(thief)).at(-1)).toMatchObject({ delta: '2575', reason: 'steal_in' })
  })

  it('refuse to overdraw the sender, and change nothing', async () => {
    const from = await player(10n)
    const to = await player(10n)
    await expect(
      db().transaction((tx) =>
        transfer(tx, {
          seasonId,
          fromUserId: from,
          toUserId: to,
          amount: 1_001n,
          outReason: 'fine_out',
          inReason: 'fine_in',
        }),
      ),
    ).rejects.toBeInstanceOf(InsufficientFunds)
    expect(await balances(from)).toEqual({ balance: 1_000n, vault: 0n })
    expect(await balances(to)).toEqual({ balance: 1_000n, vault: 0n })
    await expect(
      db().transaction((tx) =>
        transfer(tx, {
          seasonId,
          fromUserId: from,
          toUserId: from,
          amount: 100n,
          outReason: 'fine_out',
          inReason: 'fine_in',
        }),
      ),
    ).rejects.toThrow(/two different players/)
  })

  it('run in every direction at once without deadlocks', async () => {
    const [a, b, c] = [await player(100n), await player(100n), await player(100n)]
    const pairs: [string, string][] = [
      [a, b],
      [b, a],
      [b, c],
      [c, b],
      [c, a],
      [a, c],
    ]
    // A deadlock would make Postgres abort one of these (error 40P01).
    await Promise.all(
      Array.from({ length: 48 }, (_, i) => {
        const [fromUserId, toUserId] = pairs[i % pairs.length] as [string, string]
        return db().transaction((tx) =>
          transfer(tx, {
            seasonId,
            fromUserId,
            toUserId,
            amount: 100n,
            outReason: 'steal_out',
            inReason: 'steal_in',
          }),
        )
      }),
    )
    // Each direction ran 8 times, so everyone is back where they started.
    for (const id of [a, b, c]) expect(await balances(id)).toEqual({ balance: 10_000n, vault: 0n })
  })
})

describe('the vault', () => {
  it('moves chips between wallet and vault without changing net worth', async () => {
    const id = await player(100n)
    const worthAt = () =>
      testDb.query<{ at: Date }>(
        `select net_worth_at as at from wallets where season_id = $1 and user_id = $2`,
        [seasonId, id],
      )
    const before = await worthAt()

    await db().transaction((tx) =>
      moveBetweenAccounts(tx, {
        seasonId,
        userId: id,
        amount: 4_000n,
        from: 'wallet',
        reason: 'vault_deposit',
      }),
    )
    expect(await balances(id)).toEqual({ balance: 6_000n, vault: 4_000n })
    expect((await ledgerRows(id)).slice(-2)).toEqual([
      expect.objectContaining({ account: 'wallet', delta: '-4000', balance_after: '6000' }),
      expect.objectContaining({ account: 'vault', delta: '4000', balance_after: '4000' }),
    ])
    // Net worth did not move, so its timestamp (the leaderboard tiebreak) did not either.
    expect(await worthAt()).toEqual(before)

    const out = await db().transaction((tx) =>
      moveBetweenAccounts(tx, {
        seasonId,
        userId: id,
        amount: 1_500n,
        from: 'vault',
        reason: 'vault_withdraw',
      }),
    )
    expect(out).toEqual({ balance: 7_500n, vault: 2_500n })
  })

  it('refuses to take more than the vault holds', async () => {
    const id = await player(100n)
    await expect(
      db().transaction((tx) =>
        moveBetweenAccounts(tx, {
          seasonId,
          userId: id,
          amount: 100n,
          from: 'vault',
          reason: 'vault_withdraw',
        }),
      ),
    ).rejects.toMatchObject({ code: 'insufficient_funds', message: 'Your vault only has 0 chips.' })
  })
})

describe('the ledger', () => {
  it('notices a balance changed outside the ledger', async () => {
    const id = await player(10n)
    const nudge = (by: number) =>
      testDb.query(
        `update wallets set balance = balance + $3 where season_id = $1 and user_id = $2`,
        [seasonId, id, by],
      )
    await nudge(1)
    try {
      expect(await ledgerMismatches(db(), seasonId)).toEqual([
        { userId: id, account: 'wallet', stored: 1_001n, ledgerSum: 1_000n },
      ])
    } finally {
      await nudge(-1)
    }
  })

  // Runs last: everything above moved chips in this season.
  it('matches every balance and vault in the season after all of the above', async () => {
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])
    const lastRows = await testDb.query<{ mismatched: string }>(
      `select count(*) as mismatched
       from wallets w
       cross join lateral (values ('wallet', w.balance), ('vault', w.vault)) as a(account, stored)
       join lateral (
         select balance_after from ledger
         where season_id = w.season_id and user_id = w.user_id and account = a.account
         order by id desc limit 1
       ) l on true
       where w.season_id = $1 and l.balance_after <> a.stored`,
      [seasonId],
    )
    expect(lastRows).toEqual([{ mismatched: '0' }])
  })
})
