/**
 * The coin flip room in real browsers, at 1440 and 375 (Stage 1 exit check):
 * two players sit at the same table, flip, and watch each other's coins
 * land, the leaderboard move and the ticker fill. Screenshots land in
 * tests/coinflip/screenshots.
 */
import { expect, type Page, test } from '@playwright/test'

import { formatChips } from '../../../shared/chips.ts'
import type { CoinflipDetail } from '../../../shared/games/coinflip.ts'
import type { PlayResult } from '../../../shared/rounds.ts'
import { onPhone, openAs, snap } from '../../e2e-helpers/players.ts'

const SIDE = { heads: 'Heads', tails: 'Tails' } as const

/** Places a 1-chip flip and returns the server's answer. */
async function flip(page: Page, side: 'heads' | 'tails', phone: boolean) {
  const box = page.getByRole('textbox', { name: 'Bet amount' })
  const pick = page
    .getByRole('group', { name: 'Your call' })
    .getByRole('button', { name: SIDE[side] })
  const answer = page.waitForResponse((r) => r.url().endsWith('/api/coinflip/play'))
  await box.fill('1')
  if (phone) {
    await pick.click()
    await expect(pick).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: /^Flip/ }).click()
  } else {
    // All from the keyboard: Escape leaves the box, T or H picks, Space flips.
    await box.press('Escape')
    await page.keyboard.press(side === 'heads' ? 'h' : 't')
    await expect(pick).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Space')
  }
  const res = await answer
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as PlayResult<CoinflipDetail>
}

/** How a result reads on a seat: "+0.96" or "−1". */
function seatAmount(result: PlayResult<CoinflipDetail>): string {
  const { stake, payout } = result.round
  return (payout ?? 0) > stake ? `+${formatChips((payout ?? 0) - stake)}` : `−${formatChips(stake)}`
}

test('two players flip and watch each other live', async ({ browser }, testInfo) => {
  const phone = onPhone(testInfo)
  const alice = await openAs(browser, 'alice')
  const bob = await openAs(browser, 'bob')

  await test.step('both sit at the table and see each other', async () => {
    await alice.page.goto('/room/coinflip')
    await bob.page.goto('/room/coinflip')
    await expect(alice.page).toHaveTitle('Coin flip · Anzul Casino')
    await expect(alice.page.getByRole('heading', { level: 1, name: 'Coin flip' })).toBeVisible()
    await expect(alice.page.getByText(/Win pays 1\.96x · 2% house edge/)).toBeVisible()
    await expect(alice.page.getByRole('article', { name: "Bob's seat" })).toBeVisible()
    await expect(bob.page.getByRole('article', { name: "Alice's seat" })).toBeVisible()
    await expect(alice.page.getByRole('article', { name: 'Your seat' })).toBeVisible()
    await snap(alice.page, 'coinflip', 'room', testInfo)
  })

  await test.step('a typo is caught before it goes out', async () => {
    const box = alice.page.getByRole('textbox', { name: 'Bet amount' })
    await box.fill('lots')
    await alice.page.getByRole('button', { name: /^Flip/ }).click()
    await expect(
      alice.page.getByText('"lots" is not an amount. Try 50, 2.5k, half or all.'),
    ).toBeVisible()
  })

  const result = await test.step('Alice flips, and her coin lands on the answer', async () => {
    const result = await flip(alice.page, 'tails', phone)
    const face = result.round.detail.face
    expect(result.round).toMatchObject({ status: 'settled', stake: 100, detail: { call: 'tails' } })
    expect(face === 'heads' || face === 'tails').toBe(true)
    const won = face === 'tails'
    expect(result.round.payout).toBe(won ? 196 : 0)
    const words = won
      ? `Tails! ${seatAmount(result)}`
      : `${SIDE[face ?? 'heads']}. ${seatAmount(result)}`
    await expect(alice.page.getByText(words)).toBeVisible()
    if (!phone) {
      // The cursor is back in the box for the next bet.
      await expect(alice.page.getByRole('textbox', { name: 'Bet amount' })).toBeFocused()
    }
    return result
  })

  await test.step('Bob watches it land on her seat, the board and the ticker', async () => {
    await expect(bob.page.getByRole('article', { name: "Alice's seat" })).toContainText(
      seatAmount(result),
    )
    const won = (result.round.payout ?? 0) > result.round.stake
    await expect(bob.page.getByLabel('Latest results').getByRole('link').first()).toContainText(
      won ? `won ${formatChips(96)}` : `lost ${formatChips(100)}`,
    )
    const netWorth = formatChips(result.wallet.balance + result.wallet.vault)
    if (phone) {
      // The phone's leaderboard sheet has every player.
      await bob.page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('button', { name: 'Leaderboard' })
        .click()
      const sheet = bob.page.getByRole('dialog', { name: 'Leaderboard' })
      await expect(sheet.getByRole('button', { name: /Alice/ }).first()).toContainText(netWorth)
      await sheet.getByRole('button', { name: 'Close' }).click()
      return
    }
    // The sidebar's board has five rows, and the last one is Bob's own when
    // he is below them. A preview can hold more players than that (the test
    // accounts, or after launch a copy of the real ones), so there Alice may
    // be off it: her row, if it is on the board, has caught up.
    const board = bob.page.getByRole('region', { name: 'Leaderboard' })
    const alicesRow = board.getByRole('button', { name: /Alice/ })
    await expect(board.getByRole('button', { name: /Bob/ })).toBeVisible()
    if (await board.getByRole('link', { name: /^See all/ }).isVisible()) {
      await expect(alicesRow.filter({ hasNotText: netWorth })).toHaveCount(0)
    } else {
      await expect(alicesRow.first()).toContainText(netWorth)
    }
  })

  await test.step('Bob flips, and Alice watches his coin', async () => {
    const bobs = await flip(bob.page, 'heads', phone)
    await expect(alice.page.getByRole('article', { name: "Bob's seat" })).toContainText(
      seatAmount(bobs),
    )
    await snap(alice.page, 'coinflip', 'flipped', testInfo)
  })

  await test.step('the how-to-play card opens and closes', async () => {
    await alice.page.getByRole('button', { name: 'How to play' }).click()
    const card = alice.page.getByRole('dialog', { name: 'How to play Coin flip' })
    await expect(card).toContainText('Call heads or tails')
    await snap(alice.page, 'coinflip', 'how-to-play', testInfo)
    await card.getByRole('button', { name: 'Close' }).click()
    await expect(card).toBeHidden()
  })

  await alice.close()
  await bob.close()
})
