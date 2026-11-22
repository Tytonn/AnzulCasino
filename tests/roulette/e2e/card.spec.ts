/**
 * Roulette as one shared card in the stream, in real browsers at 1440 and
 * 375 (spec: Games > Roulette): the message box offers an amount and a place
 * and asks for what is missing; Alice's .roulette 25 red opens a round whose
 * card both players see, with her name on her bet; Bob's .roulette 25 17
 * joins it and starts the countdown again; at the close the wheel lands on
 * the same number on every screen (Carol's too, who opens the stream
 * mid-round), the card shows it large and lists both players winners first,
 * the wallets match, and the card folds to a line that opens to the result.
 * Screenshots land in tests/roulette/screenshots.
 *
 * A round closes 15 seconds after its latest bet and spins for 7 by
 * default, so a run takes about half a minute. On a deploy preview the
 * stream keeps what earlier runs posted, so every check looks for this
 * run's own round by its id, and a round an earlier run left open is let
 * close first.
 */
import { expect, type Page, test } from '@playwright/test'

import type { StreamPage } from '../../../shared/chat.ts'
import { formatChips } from '../../../shared/chips.ts'
import {
  COLOR_NAMES,
  pocketColor,
  type RouletteBetResult,
  spotById,
  spotReturn,
} from '../../../shared/games/roulette.ts'
import type { SeasonState } from '../../../shared/seasons.ts'
import { onPhone, openAs, snap } from '../../e2e-helpers/players.ts'

test.setTimeout(150_000)

const LANE = 'roulette'

const box = (page: Page) => page.getByRole('combobox', { name: 'Message or command' })
const stream = (page: Page) => page.getByRole('log', { name: /^The stream/ })
const pinned = (page: Page) => page.getByRole('region', { name: 'Your game' })
/** The round's card, pinned above the box or in the stream. */
const card = (page: Page, id: number) => page.locator(`article[data-shared="${id}"]`).first()

async function enter(page: Page, text: string) {
  await box(page).fill(text)
  await box(page).press('Enter')
}

async function placed(page: Page, send: () => Promise<void>): Promise<RouletteBetResult> {
  const response = page.waitForResponse((r) => r.url().endsWith('/api/roulette/bet'))
  await send()
  const res = await response
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as RouletteBetResult
}

async function balance(page: Page): Promise<number> {
  const season = (await (await page.request.get('/api/season')).json()) as SeasonState
  return season.wallet?.balance ?? 0
}

/** Lets a round an earlier run left open close, so this run's first bet opens its own. */
async function waitForTheWheel(page: Page) {
  const res = await page.request.get('/api/stream?filter=games')
  expect(res.ok(), await res.text()).toBe(true)
  const { items } = (await res.json()) as StreamPage
  const open = items
    .map((m) => m.sharedRound)
    .filter((t) => t?.game === 'roulette' && t.settledAt === null)
    .at(-1)
  if (!open) return
  const left = Date.parse(open.closesAt) - Date.now()
  if (left > -1_000) await page.waitForTimeout(Math.min(left + 1_500, 65_000))
}

const words = (n: number) => `${n} ${COLOR_NAMES[pocketColor(n)]}`
const signed = (net: number) =>
  net > 0 ? `+${formatChips(net)}` : net < 0 ? `−${formatChips(-net)}` : '±0'

test('two players bet on one round, watch it land, and see everyone’s result', async ({
  browser,
}, testInfo) => {
  const phone = onPhone(testInfo)
  const alice = await openAs(browser, 'alice')
  const bob = await openAs(browser, 'bob')
  // Carol signs in now and opens the stream only once the round is under way.
  const carol = await openAs(browser, 'carol')

  await test.step('both open the stream with the wheel free', async () => {
    await alice.page.goto('/')
    await bob.page.goto('/')
    await expect(box(alice.page)).toBeVisible()
    await expect(box(bob.page)).toBeVisible()
    await waitForTheWheel(alice.page)
  })

  await test.step('the box offers an amount and a place, and asks for what is missing', async () => {
    await box(alice.page).fill('.roulette ')
    await alice.page.getByRole('button', { name: 'red', exact: true }).click()
    await expect(box(alice.page)).toHaveValue('.roulette red')
    await alice.page.getByRole('button', { name: '50', exact: true }).click()
    await expect(box(alice.page)).toHaveValue('.roulette 50 red')
    await snap(alice.page, LANE, 'card-command', testInfo)

    const hint = alice.page.locator('[data-hint]')
    await enter(alice.page, '.roulette 25')
    await expect(hint).toContainText('Say where it goes, like .roulette 25 red.')
    await enter(alice.page, '.roulette red')
    await expect(hint).toContainText('Say how much goes on Red, like .roulette 50 red.')
    await enter(alice.page, '.roulette 25 17-20')
    await expect(hint).toContainText('takes one space, not a split')
    await box(alice.page).fill('')
  })

  const before = { alice: await balance(alice.page), bob: await balance(bob.page) }

  const opened =
    await test.step('Alice types .roulette 25 red: a round opens, with her name on her bet', async () => {
      const bet = await placed(alice.page, () => enter(alice.page, '.roulette 25 red'))
      expect(bet.table.rounds).toHaveLength(1)
      expect(bet.table.settledAt).toBeNull()
      expect(bet.card.meta).toMatchObject({ game: 'roulette', sharedRoundId: bet.table.id })
      await expect(box(alice.page)).toHaveValue('')

      const mine = pinned(alice.page).locator(`[data-shared="${bet.table.id}"]`)
      await expect(mine).toBeVisible()
      await expect(mine).toContainText(`Round ${bet.table.roundNo}`)
      await expect(mine.getByRole('timer')).toBeVisible()
      const bets = mine.getByRole('list', { name: 'Bets' })
      await expect(bets).toContainText('Alice')
      await expect(bets).toContainText('25 on Red')

      // Bob sees the same round in his stream, with no bet of his on it.
      const watching = stream(bob.page).locator(`[data-shared="${bet.table.id}"]`)
      await expect(watching).toBeVisible()
      await expect(watching.getByRole('list', { name: 'Bets' })).toContainText('Alice')
      await expect(watching).toContainText('Join with')
      await snap(alice.page, LANE, 'card-open', testInfo)
      return bet
    })
  const id = opened.table.id

  const joined =
    await test.step('Bob types .roulette 25 17: he joins, and the countdown starts again', async () => {
      // Let Alice's countdown run a few seconds first.
      await alice.page.waitForTimeout(3_000)
      const bet = await placed(bob.page, () => enter(bob.page, '.roulette 25 17'))
      expect(bet.table.id).toBe(id)
      expect(bet.card.id).toBe(opened.card.id)
      expect(bet.table.rounds.map((r) => r.userId)).toEqual([alice.id, bob.id])
      expect(Date.parse(bet.table.closesAt)).toBeGreaterThan(Date.parse(opened.table.closesAt))

      for (const page of [alice.page, bob.page]) {
        const bets = card(page, id).getByRole('list', { name: 'Bets' })
        await expect(bets).toContainText('Bob')
        await expect(bets).toContainText('25 on 17')
      }
      // Alice's countdown went back up to about 15 when Bob's bet landed.
      await expect
        .poll(async () => Number(await card(alice.page, id).getByRole('timer').textContent()), {
          timeout: 5_000,
        })
        .toBeGreaterThanOrEqual(13)
      await expect(pinned(bob.page).locator(`[data-shared="${id}"]`)).toBeVisible()
      await snap(bob.page, LANE, 'card-joined', testInfo)
      return bet
    })

  await test.step('Carol opens the stream mid-round and finds the same card', async () => {
    await carol.page.goto('/')
    const watching = stream(carol.page).locator(`[data-shared="${id}"]`)
    await expect(watching).toBeVisible()
    await expect(watching).toContainText('Alice')
    await expect(watching).toContainText('Bob')
  })

  const watchers = [alice.page, bob.page, carol.page]

  const number =
    await test.step('the wheel lands on the same number for everyone, shown large', async () => {
      const left = Date.parse(joined.table.closesAt) - Date.now()
      const landed = { timeout: Math.max(0, left) + 30_000 }
      const results: number[] = []
      for (const page of watchers) {
        const result = card(page, id).locator('[data-result]')
        await expect(result).toBeVisible(landed)
        results.push(Number(await result.getAttribute('data-result')))
      }
      expect(new Set(results).size).toBe(1)
      const n = results[0] ?? -1
      expect(n).toBeGreaterThanOrEqual(0)
      for (const page of watchers) {
        await expect(card(page, id).locator('[data-result]')).toContainText(words(n))
        await expect(card(page, id)).toHaveAttribute('data-status', 'settled')
      }
      await snap(alice.page, LANE, 'card-landed', testInfo)
      return n
    })

  await test.step('the result lists both players, winners first, and the wallets match', async () => {
    const net = (spot: string, stake: number) =>
      Number(spotReturn(spotById(spot), BigInt(stake), number)) - stake
    const players = [
      { name: 'Alice', net: net('red', 25), joined: 0 },
      { name: 'Bob', net: net('17', 25), joined: 1 },
    ].sort((a, b) => b.net - a.net || a.joined - b.joined)

    for (const page of watchers) {
      const rows = card(page, id).getByRole('list', { name: 'Results' }).getByRole('listitem')
      await expect(rows).toHaveCount(2)
      for (const [i, p] of players.entries()) {
        await expect(rows.nth(i)).toContainText(p.name)
        await expect(rows.nth(i).locator('[data-amount]')).toHaveText(signed(p.net))
      }
    }
    const aliceNet = players.find((p) => p.name === 'Alice')?.net ?? 0
    const bobNet = players.find((p) => p.name === 'Bob')?.net ?? 0
    await expect(card(alice.page, id)).toContainText(
      aliceNet > 0 ? `You won ${formatChips(aliceNet)}` : `You lost ${formatChips(-aliceNet)}`,
    )
    await expect.poll(() => balance(alice.page)).toBe(before.alice + aliceNet)
    await expect.poll(() => balance(bob.page)).toBe(before.bob + bobNet)
    await snap(bob.page, LANE, 'card-results', testInfo)
  })

  await test.step('the card folds to a line that opens to the result', async () => {
    for (const page of [alice.page, bob.page]) {
      await expect(pinned(page).locator(`[data-shared="${id}"]`)).toHaveCount(0, {
        timeout: 20_000,
      })
    }
    const line = stream(bob.page).locator(`[data-folded-shared="${id}"]`)
    await expect(line).toBeVisible({ timeout: 20_000 })
    await expect(line).toContainText(`Roulette · Round ${opened.table.roundNo}`)
    await expect(line).toContainText(words(number))
    await expect(line).toContainText('2 players')
    const open = line.getByRole('button').first()
    await open.click()
    await expect(open).toHaveAttribute('aria-expanded', 'true')
    const replay = line.getByRole('list', { name: 'Results' })
    await expect(replay.getByRole('listitem')).toHaveCount(2)
    await expect(replay).toContainText('Alice')
    await expect(replay).toContainText('Bob')
    if (!phone) await line.scrollIntoViewIfNeeded()
    await snap(bob.page, LANE, 'card-replay', testInfo)
  })

  await alice.close()
  await bob.close()
  await carol.close()
})
