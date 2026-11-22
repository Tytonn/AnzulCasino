/**
 * Steals against a real database (spec: Steal rules, Quality bar): each
 * outcome moves the right chips and writes matching ledger rows, ranks set
 * the rate, the daily cap and the limits hold, refusals change nothing,
 * replayed and parallel requests cannot cheat, and nobody's shield charges
 * leave the server.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { basisPoints, CHIP } from '../../../shared/chips.ts'
import { configDefaults } from '../../../shared/config.ts'
import {
  capLeft,
  type HeistState,
  type StealResponse,
  stealAmount,
  stealRate,
} from '../../../shared/features/heist.ts'
import { db } from '../../../server/lib/db.ts'
import { captureLive, type Outgoing } from '../../../server/lib/live.ts'
import { credit, ledgerMismatches } from '../../../server/lib/wallet.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { heistFixtures, key, type TestPlayer } from './helpers.ts'

process.env.DATABASE_POOL_MAX = '40'
const testDb = await useTestDatabase()
const fx = heistFixtures(testDb)
const cfg = configDefaults()

let capture: { events: Outgoing[]; stop(): void }

beforeEach(async () => {
  capture = captureLive()
  await testDb.query(`delete from rate_limits`)
  await fx.clearConfig()
  await fx.freshSeason()
})

afterEach(() => {
  capture.stop()
})

const ALWAYS = 10_000
const NEVER = 0

/** A steal's answer: the attempt on a 200, the refusal otherwise. */
type Answer = StealResponse & { error: { code: string; message: string } }

async function steal(thief: TestPlayer, target: TestPlayer) {
  return thief.client.post<Answer>('/api/heist/steal', { targetId: target.id }, key())
}

async function state(player: TestPlayer) {
  const res = await player.client.get<HeistState>('/api/heist/state')
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body
}

async function stealRows() {
  return testDb.query<{ outcome: string; amount: string; fine: string }>(
    `select outcome, amount, fine from steals where season_id = $1 order by id`,
    [fx.seasonId],
  )
}

async function expectLedgerClean() {
  expect(await ledgerMismatches(db(), fx.seasonId)).toEqual([])
}

describe('POST /api/heist/steal: outcomes', () => {
  it('a success moves the take from the target’s wallet to the thief’s and makes the target immune', async () => {
    await fx.setConfig('steal_success_pct', ALWAYS)
    const leader = await fx.player(60_000)
    const thief = await fx.player(4_000)

    const res = await steal(thief, leader)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const { steal: attempt, wallet, immuneUntil } = res.body
    // Second place robbing first: a gap of 1 is 1.5% + 0.3% = 1.8% of 60,000.
    expect(attempt).toMatchObject({
      outcome: 'success',
      thiefId: thief.id,
      targetId: leader.id,
      thiefRank: 2,
      targetRank: 1,
      amount: Number(basisPoints(60_000n * CHIP, 180)),
      fine: 0,
    })
    expect(attempt.amount).toBe(1080)
    expect(wallet.balance).toBe(4_000 + 1080)
    expect(await fx.wallet(thief.id)).toEqual({ balance: 5080n, vault: 0n })
    expect(await fx.wallet(leader.id)).toEqual({ balance: 60_000n - 1080n, vault: 0n })
    // Immune for immunity_hours from now.
    expect(Date.parse(immuneUntil ?? '') - Date.now()).toBeGreaterThan(
      cfg.immunity_hours * 3_600_000 - 60_000,
    )
    await expectLedgerClean()

    const ledger = await testDb.query<{
      user_id: string
      reason: string
      delta: string
      ref_type: string
    }>(
      `select user_id, reason, delta, ref_type from ledger
        where season_id = $1 and reason in ('steal_in', 'steal_out') order by id`,
      [fx.seasonId],
    )
    expect(ledger).toEqual([
      { user_id: leader.id, reason: 'steal_out', delta: '-1080', ref_type: 'steal' },
      { user_id: thief.id, reason: 'steal_in', delta: '1080', ref_type: 'steal' },
    ])
  })

  it('matches the spec’s worked example: tenth robbing the leader takes the 4% maximum, or pays a 5% fine', async () => {
    await fx.setConfig('steal_success_pct', ALWAYS)
    const leader = await fx.player(60_000)
    for (const chips of [30_000, 25_000, 20_000, 15_000, 12_000, 10_000, 8_000, 6_000]) {
      await fx.player(chips)
    }
    const tenth = await fx.player(4_000)

    const won = await steal(tenth, leader)
    expect(won.status, JSON.stringify(won.body)).toBe(200)
    expect(won.body.steal).toMatchObject({ thiefRank: 10, targetRank: 1, amount: 2_400 })

    // The same thief, failing against another leader the next time.
    await fx.setConfig('steal_success_pct', NEVER)
    await fx.freshSeason()
    const leader2 = await fx.player(60_000)
    for (const chips of [30_000, 25_000, 20_000, 15_000, 12_000, 10_000, 8_000, 6_000]) {
      await fx.player(chips)
    }
    const tenth2 = await fx.player(4_000)
    const lost = await steal(tenth2, leader2)
    expect(lost.status).toBe(200)
    expect(lost.body.steal).toMatchObject({ outcome: 'failed', amount: 0, fine: 200 })
    expect(await fx.wallet(tenth2.id)).toEqual({ balance: 3_800n, vault: 0n })
    expect(await fx.wallet(leader2.id)).toEqual({ balance: 60_200n, vault: 0n })
    await expectLedgerClean()
  })

  it('a failure fines the thief, pays the target and leaves the target open to others', async () => {
    await fx.setConfig('steal_success_pct', NEVER)
    const target = await fx.player(10_000)
    const thief = await fx.player(5_000)
    const other = await fx.player(3_000)

    const res = await steal(thief, target)
    expect(res.status).toBe(200)
    expect(res.body.steal).toMatchObject({ outcome: 'failed', amount: 0, fine: 250 })
    expect(res.body.immuneUntil).toBeNull()
    expect(await fx.wallet(thief.id)).toEqual({ balance: 4_750n, vault: 0n })
    expect(await fx.wallet(target.id)).toEqual({ balance: 10_250n, vault: 0n })

    // No immunity after a failed steal: someone else can try at once.
    expect((await steal(other, target)).status).toBe(200)
    await expectLedgerClean()
  })

  it('a thief with an empty wallet who fails pays nothing', async () => {
    await fx.setConfig('steal_success_pct', NEVER)
    const target = await fx.player(10_000)
    const thief = await fx.player(0)
    const res = await steal(thief, target)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.steal).toMatchObject({ outcome: 'failed', fine: 0 })
    expect(await fx.wallet(target.id)).toEqual({ balance: 10_000n, vault: 0n })
    await expectLedgerClean()
  })

  it('a shield charge blocks the steal: the charge and the attempt are used, no fine, and the target is immune', async () => {
    await fx.setConfig('steal_success_pct', ALWAYS)
    const target = await fx.player(10_000)
    const thief = await fx.player(5_000)
    const bought = await target.client.post('/api/heist/shield', {}, key())
    expect(bought.status, JSON.stringify(bought.body)).toBe(200)
    const targetAfterShield = await fx.wallet(target.id)

    const res = await steal(thief, target)
    expect(res.status).toBe(200)
    expect(res.body.steal).toMatchObject({ outcome: 'blocked', amount: 0, fine: 0 })
    expect(res.body.immuneUntil).not.toBeNull()
    expect(res.body.attemptsUsed).toBe(1)
    expect(await fx.wallet(thief.id)).toEqual({ balance: 5_000n, vault: 0n })
    expect(await fx.wallet(target.id)).toEqual(targetAfterShield)

    expect((await state(target)).me).toMatchObject({ charges: 0 })
    expect((await state(thief)).me).toMatchObject({ attemptsUsed: 1 })
    const other = await fx.player(2_000)
    const refused = await steal(other, target)
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe('steal_immune')
    await expectLedgerClean()
  })

  it('robbing someone ranked below you takes the 0.5% down rate', async () => {
    await fx.setConfig('steal_success_pct', ALWAYS)
    const thief = await fx.player(50_000)
    const below = await fx.player(20_000)
    const res = await steal(thief, below)
    expect(res.status).toBe(200)
    expect(res.body.steal).toMatchObject({ thiefRank: 1, targetRank: 2, amount: 100 })
  })

  it('players level on the board rob each other at the base rate', async () => {
    await fx.setConfig('steal_success_pct', ALWAYS)
    const a = await fx.player(10_000)
    const b = await fx.player(10_000)
    // Both funded in their own transaction, so make them level on time too.
    await testDb.query(
      `update wallets set net_worth_at = now() - interval '1 hour' where season_id = $1`,
      [fx.seasonId],
    )
    const res = await steal(a, b)
    expect(res.status).toBe(200)
    expect(res.body.steal).toMatchObject({ thiefRank: 1, targetRank: 1, amount: 150 })
  })

  it('never touches the vault', async () => {
    await fx.setConfig('steal_success_pct', ALWAYS)
    const target = await fx.player(100_000)
    const moved = await target.client.post(
      '/api/heist/vault',
      { direction: 'deposit', amount: '20k' },
      key(),
    )
    expect(moved.status, JSON.stringify(moved.body)).toBe(200)
    const thief = await fx.player(1_000)
    const res = await steal(thief, target)
    expect(res.status).toBe(200)
    expect(res.body.steal.amount).toBe(Number(basisPoints(80_000n * CHIP, 150 + 30 * 1)))
    expect((await fx.wallet(target.id)).vault).toBe(20_000n)
  })
})

describe('POST /api/heist/steal: the daily loss cap', () => {
  it('limits what one target can lose in a game day, then refuses', async () => {
    await fx.setConfig('steal_success_pct', ALWAYS)
    await fx.setConfig('immunity_hours', 0)
    const target = await fx.player(100_000)
    const thieves = [
      await fx.player(10_000),
      await fx.player(9_000),
      await fx.player(8_000),
      await fx.player(7_000),
    ]
    const cap = basisPoints(100_000n * CHIP, cfg.daily_loss_cap_pct)
    expect(cap).toBe(4_000n)

    let stolen = 0n
    for (const thief of thieves.slice(0, 3)) {
      const before = await fx.wallet(target.id)
      const res = await steal(thief, target)
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      const { thiefRank, targetRank, amount } = res.body.steal
      const expected = stealAmount(
        before.balance,
        stealRate(thiefRank - targetRank, cfg),
        cap - stolen,
      )
      expect(BigInt(amount)).toBe(expected)
      stolen += BigInt(amount)
    }
    expect(stolen).toBe(cap)

    const refused = await steal(thieves[3] as TestPlayer, target)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toMatchObject({ code: 'steal_cap' })
    expect(refused.body.error.message).toMatch(/lost all they can to steals today/)
    await expectLedgerClean()
  })

  it('counts from net worth at the daily reset, not the wallet now', async () => {
    await fx.setConfig('steal_success_pct', ALWAYS)
    const target = await fx.player(10_000)
    await fx.backdate(target.id)
    // A big win after the reset does not raise today's cap.
    await db().transaction((tx) =>
      credit(tx, {
        seasonId: fx.seasonId,
        userId: target.id,
        amount: 90_000n * CHIP,
        reason: 'payout',
      }),
    )
    const thief = await fx.player(1_000)
    const res = await steal(thief, target)
    expect(res.status).toBe(200)
    // 1.8% of 100,000 is 1,800, but the cap is 4% of the 10,000 at the reset.
    expect(res.body.steal.amount).toBe(400)
    const info = (await state(thief)).targets.find((t) => t.userId === target.id)
    expect(info?.capLeft).toBe(0)
  })
})

describe('POST /api/heist/steal: who can be robbed', () => {
  it('allows two attempts a game day, three with the extra attempt, then refuses', async () => {
    await fx.setConfig('steal_success_pct', NEVER)
    const thief = await fx.player(5_000)
    const targets = [
      await fx.player(10_000),
      await fx.player(9_000),
      await fx.player(8_000),
      await fx.player(7_000),
    ]

    for (const target of targets.slice(0, 2)) expect((await steal(thief, target)).status).toBe(200)
    const third = await steal(thief, targets[2] as TestPlayer)
    expect(third.status).toBe(409)
    expect(third.body.error.code).toBe('steal_no_attempts')
    expect(third.body.error.message).toMatch(/Buy one more in the Shop/)

    const extra = await thief.client.post('/api/heist/extra-attempt', {}, key())
    expect(extra.status, JSON.stringify(extra.body)).toBe(200)
    expect(extra.body.attemptsAllowed).toBe(3)
    expect((await steal(thief, targets[2] as TestPlayer)).status).toBe(200)

    const fourth = await steal(thief, targets[3] as TestPlayer)
    expect(fourth.status).toBe(409)
    expect(fourth.body.error.message).toMatch(/More at 4:00 AM/)
    expect(await stealRows()).toHaveLength(3)
  })

  it('allows one try per target per game day', async () => {
    await fx.setConfig('steal_success_pct', NEVER)
    const thief = await fx.player(5_000)
    const target = await fx.player(10_000)
    expect((await steal(thief, target)).status).toBe(200)
    const again = await steal(thief, target)
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('steal_tried')
    expect((await state(thief)).targets.find((t) => t.userId === target.id)?.triedToday).toBe(true)
  })

  it('refuses yourself, unknown players, players under the floor and immune players, using no attempt', async () => {
    await fx.setConfig('steal_success_pct', ALWAYS)
    const thief = await fx.player(5_000)
    const poor = await fx.player(249)
    const rich = await fx.player(50_000)
    const other = await fx.player(6_000)

    const self = await steal(thief, thief)
    expect(self.status).toBe(409)
    expect(self.body.error.message).toBe('You cannot rob yourself.')

    const nobody = await thief.client.post(
      '/api/heist/steal',
      { targetId: '00000000-0000-4000-8000-000000000000' },
      key(),
    )
    expect(nobody.status).toBe(404)

    const floor = await steal(thief, poor)
    expect(floor.status).toBe(409)
    expect(floor.body.error.code).toBe('steal_floor')
    expect(floor.body.error.message).toMatch(/under 250 chips net worth/)

    expect((await steal(other, rich)).status).toBe(200)
    const immune = await steal(thief, rich)
    expect(immune.status).toBe(409)
    expect(immune.body.error.code).toBe('steal_immune')
    expect(immune.body.error.message).toMatch(/is immune for 3h after the last steal/)

    expect((await state(thief)).me.attemptsUsed).toBe(0)
  })

  it('refuses a steal that would take less than a whole chip, using no attempt', async () => {
    await fx.setConfig('steal_success_pct', ALWAYS)
    // Under a floor lowered to 100 and ranked below the thief, so the 0.5% down
    // rate: under a chip of 150.
    await fx.setConfig('steal_floor', 100)
    const thief = await fx.player(5_000)
    const small = await fx.player(150)
    const res = await steal(thief, small)
    expect(res.status).toBe(409)
    expect(res.body.error).toMatchObject({
      code: 'steal_too_little',
      message: `${small.name} has too little in their wallet for a steal to take a whole chip.`,
    })
    expect((await state(thief)).me.attemptsUsed).toBe(0)
    expect(await fx.wallet(small.id)).toEqual({ balance: 150n, vault: 0n })
    expect(await stealRows()).toHaveLength(0)
  })

  it('refuses every steal in the final day, and outside a season', async () => {
    await fx.freshSeason(12)
    const thief = await fx.player(5_000)
    const target = await fx.player(10_000)
    const res = await steal(thief, target)
    expect(res.status).toBe(409)
    expect(res.body.error).toMatchObject({
      code: 'steal_freeze',
      message: 'Steals are off for the final 24 hours of the season.',
    })
    expect((await state(thief)).phase).toBe('final_day')

    await testDb.query(`update seasons set ends_at = now() - interval '1 minute'`)
    const over = await steal(thief, target)
    expect(over.status).toBe(409)
    expect(over.body.error.code).toBe('no_season')
    expect(await stealRows()).toHaveLength(0)
  })
})

describe('POST /api/heist/steal: safety', () => {
  it('a replayed request key returns the first answer and changes nothing', async () => {
    await fx.setConfig('steal_success_pct', ALWAYS)
    const thief = await fx.player(5_000)
    const target = await fx.player(10_000)
    const headers = key()
    const first = await thief.client.post<Answer>(
      '/api/heist/steal',
      { targetId: target.id },
      headers,
    )
    const again = await thief.client.post<Answer>(
      '/api/heist/steal',
      { targetId: target.id },
      headers,
    )
    expect(first.status).toBe(200)
    expect(again.status).toBe(200)
    expect(again.body).toEqual(first.body)
    expect(await stealRows()).toHaveLength(1)
    expect(await fx.wallet(thief.id)).toEqual({
      balance: 5_000n + BigInt(first.body.steal.amount),
      vault: 0n,
    })
  })

  it('many parallel steals by one thief on one target make one attempt', async () => {
    await fx.setConfig('steal_success_pct', NEVER)
    const thief = await fx.player(5_000)
    const target = await fx.player(10_000)
    const results = await Promise.all(Array.from({ length: 10 }, () => steal(thief, target)))
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    expect(results.filter((r) => r.status === 409)).toHaveLength(9)
    expect(await stealRows()).toHaveLength(1)
    await expectLedgerClean()
  })

  it('two players robbing each other at once never deadlock', async () => {
    await fx.setConfig('steal_success_pct', ALWAYS)
    await fx.setConfig('immunity_hours', 0)
    for (let round = 0; round < 5; round++) {
      await fx.freshSeason()
      const a = await fx.player(10_000)
      const b = await fx.player(10_000)
      const [ab, ba] = await Promise.all([steal(a, b), steal(b, a)])
      expect(ab.status, JSON.stringify(ab.body)).toBe(200)
      expect(ba.status, JSON.stringify(ba.body)).toBe(200)
      await expectLedgerClean()
    }
  })

  it('a crowd robbing one target at once never passes the daily cap or the attempts', async () => {
    await fx.setConfig('steal_success_pct', ALWAYS)
    await fx.setConfig('immunity_hours', 0)
    const target = await fx.player(100_000)
    const thieves: TestPlayer[] = []
    for (let i = 0; i < 12; i++) thieves.push(await fx.player(2_000 + 100 * i))
    const results = await Promise.all(thieves.map((t) => steal(t, target)))
    const ok = results.filter((r) => r.status === 200)
    expect(ok.length).toBeGreaterThan(0)
    for (const r of results) expect([200, 409]).toContain(r.status)
    const [row] = await testDb.query<{ total: string }>(
      `select coalesce(sum(amount), 0) as total from steals where target_id = $1`,
      [target.id],
    )
    expect(BigInt(row?.total ?? 0)).toBeLessThanOrEqual(
      basisPoints(100_000n * CHIP, cfg.daily_loss_cap_pct),
    )
    const [daily] = await testDb.query<{ stolen_today: string }>(
      `select stolen_today from daily_state where user_id = $1 and season_id = $2`,
      [target.id, fx.seasonId],
    )
    expect(daily?.stolen_today).toBe(row?.total)
    await expectLedgerClean()
  })

  it('refuses without a session, without a request key, and with a bad target', async () => {
    const thief = await fx.player(5_000)
    const { apiClient } = await import('../../helpers/api.ts')
    const { heistApi } = await import('../../../server/features/heist/api.ts')
    const anon = apiClient(heistApi)
    expect((await anon.post('/api/heist/steal', { targetId: thief.id }, key())).status).toBe(401)
    expect((await anon.get('/api/heist/state')).status).toBe(401)

    const noKey = await thief.client.post('/api/heist/steal', { targetId: thief.id })
    expect(noKey.status).toBe(400)
    expect(noKey.body.error.code).toBe('missing_idempotency_key')

    const bad = await thief.client.post('/api/heist/steal', { targetId: 'bob' }, key())
    expect(bad.status).toBe(400)
    expect(bad.body.error.message).toBe('Pick a player to rob.')

    const extra = await thief.client.post(
      '/api/heist/steal',
      { targetId: thief.id, amount: 5 },
      key(),
    )
    expect(extra.status).toBe(400)
  })
})

describe('live news and hidden data', () => {
  it('tells everyone about the attempt, the target alone about their loss, and never shows shield charges', async () => {
    await fx.setConfig('steal_success_pct', ALWAYS)
    const target = await fx.player(10_000)
    const thief = await fx.player(5_000)
    // The target holds two charges; one blocks, one stays secret.
    expect((await target.client.post('/api/heist/shield', {}, key())).status).toBe(200)
    expect((await target.client.post('/api/heist/shield', {}, key())).status).toBe(200)
    capture.events.length = 0

    const res = await steal(thief, target)
    expect(res.status).toBe(200)
    await thief.client.settle()
    const names = capture.events.map((e) => `${e.channel} ${e.name}`)
    expect(names).toEqual(
      expect.arrayContaining([
        'chat chat.message',
        'feed steal.result',
        `user:${target.id} shield.blocked`,
      ]),
    )
    // The feed tells the thief's other tabs; a refresh would land mid-reveal.
    expect(names).not.toContain(`user:${thief.id} heist.changed`)
    const post = capture.events.find((e) => e.name === 'chat.message')
    expect((post?.envelope.data as { body: string }).body).toBe(
      `${target.name}'s shield blocked a steal by ${thief.name}.`,
    )

    // Only the target's own channel says how many charges are left.
    for (const event of capture.events) {
      const text = JSON.stringify(event.envelope.data)
      expect(text).not.toMatch(/secret/)
      if (event.channel !== `user:${target.id}`) expect(text).not.toMatch(/charges/)
    }
    const blocked = capture.events.find((e) => e.name === 'shield.blocked')
    expect(blocked?.envelope.data).toMatchObject({ charges: 1, thiefId: thief.id })

    // The thief's view of the target has no shield count, and neither does the response.
    const seen = await state(thief)
    expect(JSON.stringify(seen.targets)).not.toMatch(/charges/)
    expect(JSON.stringify(res.body)).not.toMatch(/charges/)
    expect((await state(target)).me.charges).toBe(1)
  })

  it('a success moves both wallets on the leaderboard and posts in chat', async () => {
    await fx.setConfig('steal_success_pct', ALWAYS)
    const target = await fx.player(10_000)
    const thief = await fx.player(5_000)
    const res = await steal(thief, target)
    await thief.client.settle()
    const standings = capture.events.filter((e) => e.name === 'standing.changed')
    expect(standings.map((e) => (e.envelope.data as { userId: string }).userId).sort()).toEqual(
      [thief.id, target.id].sort(),
    )
    const robbed = capture.events.find((e) => e.name === 'robbed')
    expect(robbed?.channel).toBe(`user:${target.id}`)
    expect(robbed?.envelope.data).toMatchObject({
      amount: res.body.steal.amount,
      thiefId: thief.id,
    })
    const post = capture.events.find((e) => e.name === 'chat.message')
    expect(post?.envelope.data).toMatchObject({
      kind: 'system',
      body: `${thief.name} robbed ${target.name} for 180 chips.`,
      meta: { tone: 'win', userId: thief.id },
    })
    const feed = capture.events.find((e) => e.name === 'steal.result')
    expect(feed?.envelope.version).toBe(res.body.steal.id)
  })
})

describe('GET /api/heist/state and /api/heist/steals', () => {
  it('shows the caller’s day and every other player’s public defenses', async () => {
    await fx.setConfig('steal_success_pct', ALWAYS)
    const me = await fx.player(10_000)
    const other = await fx.player(20_000)
    const thief = await fx.player(1_000)
    const robbery = await steal(thief, other)
    expect(robbery.status).toBe(200)
    // Third robbing first: 2.1% of 20,000 is 420 of the 800 chips (4%) the target can lose today.
    expect(robbery.body.steal.amount).toBe(420)

    const mine = await state(me)
    expect(mine.phase).toBe('open')
    expect(mine.me).toMatchObject({
      attemptsUsed: 0,
      attemptsAllowed: 2,
      charges: 0,
      immuneUntil: null,
      vaultMoved: false,
      lossCap: 400,
      stolenToday: 0,
    })
    const robbed = mine.targets.find((t) => t.userId === other.id)
    expect(robbed?.immuneUntil).not.toBeNull()
    expect(robbed?.capLeft).toBe(Number(capLeft(20_000n, 420n, cfg.daily_loss_cap_pct)))
    expect(robbed?.capLeft).toBe(380)
    expect(mine.targets.map((t) => t.userId)).not.toContain(me.id)

    const log = await me.client.get('/api/heist/steals')
    expect(log.status).toBe(200)
    expect(log.body.steals).toHaveLength(1)
    expect(log.body.steals[0]).toMatchObject({
      thiefId: thief.id,
      targetId: other.id,
      outcome: 'success',
    })
  })
})
