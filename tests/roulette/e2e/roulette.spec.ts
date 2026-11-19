/**
 * The roulette room in real browsers, at 1440 and 375: two players sit at
 * the one table, put chips down by clicking and by typing, see each other's
 * bets, and watch the same wheel land on the same number, each wallet paid
 * by it. Screenshots land in tests/roulette/screenshots.
 *
 * The wheel runs on the server's clock (20 seconds of betting, 7 of spin, 3
 * of result by default), so the tests wait for a spin with time left to bet.
 */
import { expect, type Page, test } from '@playwright/test'

import { CHIP } from '../../../shared/chips.ts'
import {
  COLOR_NAMES,
  phaseAt,
  pocketColor,
  type RouletteTable,
  spinAt,
  type SpinWindow,
} from '../../../shared/games/roulette.ts'
import type { SeasonState } from '../../../shared/seasons.ts'
import { onPhone, openAs, snap } from '../../e2e-helpers/players.ts'

test.setTimeout(150_000)

async function readTable(page: Page): Promise<{ table: RouletteTable; now: number }> {
  return page.evaluate(async () => {
    const [table, time] = await Promise.all([
      fetch('/api/roulette/table').then((r) => r.json()),
      fetch('/api/time').then((r) => r.json()),
    ])
    return { table, now: time.now as number }
  })
}

/** Waits for a spin that takes bets for at least `leftMs` more, and returns it. */
async function bettingSpin(page: Page, leftMs: number): Promise<SpinWindow> {
  for (;;) {
    const { table, now } = await readTable(page)
    expect(table.clock, 'a season is running').not.toBeNull()
    const clock = table.clock as NonNullable<RouletteTable['clock']>
    const window = spinAt(clock, now)
    if (phaseAt(window, now) === 'betting' && window.closesAt - now >= leftMs) return window
    // Wait for the next spin to open.
    await page.waitForTimeout(Math.min(Math.max(250, window.endsAt - now + 300), 5_000))
  }
}

async function balance(page: Page): Promise<number> {
  const season = await page.evaluate(async () => (await fetch('/api/season')).json())
  return (season as SeasonState).wallet?.balance ?? 0
}

function words(n: number): string {
  return n === 0 ? '0 Green' : `${n} ${COLOR_NAMES[pocketColor(n)]}`
}

test('two players bet on one wheel and see the same number', async ({ browser }, testInfo) => {
  const phone = onPhone(testInfo)
  const alice = await openAs(browser, 'alice')
  const bob = await openAs(browser, 'bob')

  await test.step('both sit at the table and see each other', async () => {
    await alice.page.goto('/room/roulette')
    await bob.page.goto('/room/roulette')
    await expect(alice.page).toHaveTitle('Roulette · Anzul Casino')
    await expect(alice.page.getByRole('heading', { level: 1, name: 'Roulette' })).toBeVisible()
    await expect(alice.page.getByText(/35 to 1 on a number · 2\.7% house edge/)).toBeVisible()
    await expect(alice.page.getByRole('article', { name: "Bob's seat" })).toBeVisible()
    await expect(bob.page.getByRole('article', { name: "Alice's seat" })).toBeVisible()
    await expect(alice.page.getByRole('group', { name: 'The betting table' })).toBeVisible()
  })

  const spin = await bettingSpin(alice.page, 9_000)
  const before = { alice: await balance(alice.page), bob: await balance(bob.page) }

  await test.step('alice clicks the felt, bob types a quick bet', async () => {
    await alice.page.getByRole('radio', { name: 'Chip size 1', exact: true }).click()
    const placed = alice.page.waitForResponse((r) => r.url().endsWith('/api/roulette/bet'))
    const seventeen = alice.page.getByRole('button', { name: '17, pays 35 to 1' })
    if (phone) await seventeen.tap()
    else await seventeen.click()
    expect((await placed).status()).toBe(200)

    const box = bob.page.getByRole('textbox', { name: /Quick bet/ })
    await box.fill('1 red')
    await expect(bob.page.getByText('= 1 on Red, pays 1 to 1')).toBeVisible()
    const typed = bob.page.waitForResponse((r) => r.url().endsWith('/api/roulette/bet'))
    if (phone) await bob.page.getByRole('button', { name: /^Bet/ }).click()
    else await box.press('Enter')
    expect((await typed).status()).toBe(200)
  })

  await test.step('each sees the other’s chips on their seat', async () => {
    await expect(alice.page.getByRole('article', { name: "Bob's seat" })).toContainText('Red 1')
    await expect(bob.page.getByRole('article', { name: "Alice's seat" })).toContainText('17 1')
    await expect(alice.page.getByRole('article', { name: 'Your seat' })).toContainText('In play 1')
    await snap(alice.page, 'roulette', 'bets', testInfo)
  })

  await test.step('the wheel lands on the same number for both', async () => {
    const landed = /\d+ (Red|Black|Green)/
    const status = (page: Page) => page.locator('[data-bet-box]')
    // The close, the spin and the landing: well within the spin's own time.
    const wait = Math.max(5_000, spin.landsAt - Date.now() + 15_000)
    await expect(status(alice.page)).toContainText(landed, { timeout: wait })
    await expect(status(bob.page)).toContainText(landed, { timeout: 10_000 })

    const { table } = await readTable(alice.page)
    const result = table.recent.find((r) => r.spin === spin.spin)
    expect(result, `spin ${spin.spin} has a number`).toBeDefined()
    const n = (result as { number: number }).number
    await expect(status(alice.page)).toContainText(words(n))
    await expect(status(bob.page)).toContainText(words(n))
    await snap(alice.page, 'roulette', 'landed', testInfo)
    await snap(bob.page, 'roulette', 'landed-bob', testInfo)

    // Each wallet is paid by that number: 36 for 17, 2 for red.
    const one = Number(CHIP)
    const aliceBack = n === 17 ? 36 * one : 0
    const bobBack = pocketColor(n) === 'red' ? 2 * one : 0
    await expect.poll(() => balance(alice.page)).toBe(before.alice - one + aliceBack)
    await expect.poll(() => balance(bob.page)).toBe(before.bob - one + bobBack)
  })

  await alice.close()
  await bob.close()
})

test('bets can be undone and cleared until the close', async ({ browser }, testInfo) => {
  const phone = onPhone(testInfo)
  const carol = await openAs(browser, 'carol')
  const { page } = carol
  await page.goto('/room/roulette')
  await expect(page.getByRole('group', { name: 'The betting table' })).toBeVisible()
  await bettingSpin(page, 8_000)
  const before = await balance(page)

  await page.getByRole('radio', { name: 'Chip size 1', exact: true }).click()
  const press = async (name: string) => {
    const target = page.getByRole('button', { name })
    if (phone) await target.tap()
    else await target.click()
  }
  await press('Red, pays 1 to 1')
  await press('Black, pays 1 to 1')
  await press('Split 17/20, pays 17 to 1')
  await expect.poll(() => balance(page)).toBe(before - 3 * Number(CHIP))
  const seat = page.getByRole('article', { name: 'Your seat' })
  await expect(seat).toContainText('In play 3')

  // Undo takes the split back off; Clear takes everything. On a keyboard, U and C.
  if (phone) await page.getByRole('button', { name: 'Undo' }).tap()
  else await page.keyboard.press('u')
  await expect.poll(() => balance(page)).toBe(before - 2 * Number(CHIP))
  await expect(seat).toContainText('In play 2')
  if (phone) await page.getByRole('button', { name: 'Clear your bets' }).tap()
  else await page.keyboard.press('c')
  await expect.poll(() => balance(page)).toBe(before)
  await snap(page, 'roulette', 'cleared', testInfo)
  await carol.close()
})
