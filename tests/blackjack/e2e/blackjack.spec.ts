/**
 * The blackjack room in real browsers, at 1440 and 375: two players sit at
 * the same table, each plays a hand of 10 chips from the keyboard (desktop) or
 * with taps (phone), sees the cards land and the result, and watches the
 * other's hand play out on their seat. Screenshots land in
 * tests/blackjack/screenshots.
 */
import { expect, type Page, test } from '@playwright/test'

import { formatChips } from '../../../shared/chips.ts'
import {
  type BlackjackDetail,
  cardName,
  handTotal,
  type Move,
} from '../../../shared/games/blackjack.ts'
import type { PlayResult } from '../../../shared/rounds.ts'
import { onPhone, openAs, snap } from '../../e2e-helpers/players.ts'

type Hand = PlayResult<BlackjackDetail>

const LABELS: Record<Move, string> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
}

async function expectOk(res: { status(): number; text(): Promise<string> }) {
  expect(res.status(), await res.text()).toBe(200)
}

/** Deals a 10-chip hand and returns the server's answer. */
async function deal(page: Page, phone: boolean): Promise<Hand> {
  const box = page.getByRole('textbox', { name: 'Bet amount' })
  const answer = page.waitForResponse((r) => r.url().endsWith('/api/blackjack/deal'))
  await box.fill('10')
  if (phone) await page.getByRole('button', { name: /^Deal/ }).click()
  else await box.press('Enter')
  const res = await answer
  await expectOk(res)
  return (await res.json()) as Hand
}

/** Hits below 12, stands from there, until the hand is over. */
async function playOut(page: Page, hand: Hand, phone: boolean): Promise<Hand> {
  let result = hand
  for (let moves = 0; result.round.status === 'open' && moves < 12; moves++) {
    const { detail } = result.round
    const cards = detail.hands[detail.active ?? 0]?.cards ?? []
    const move: Move = handTotal(cards).total < 12 ? 'hit' : 'stand'
    const button = page
      .getByRole('group', { name: 'Your move' })
      .getByRole('button', { name: new RegExp(`^${LABELS[move]}`) })
    await expect(button).toBeEnabled()
    const answer = page.waitForResponse((r) => r.url().endsWith('/api/blackjack/move'))
    if (phone) await button.click()
    else await page.keyboard.press(move === 'hit' ? 'h' : 's')
    const res = await answer
    await expectOk(res)
    result = (await res.json()) as Hand
  }
  expect(result.round.status).toBe('settled')
  return result
}

/** How a result reads on a seat: "+10", "+15" for a blackjack, "−10" or "Push". */
function seatAmount(hand: Hand): string {
  const net = (hand.round.payout ?? 0) - hand.round.stake
  if (net > 0) return `+${formatChips(net)}`
  if (net < 0) return `−${formatChips(-net)}`
  return 'Push'
}

test('two players play a hand each and watch each other live', async ({ browser }, testInfo) => {
  const phone = onPhone(testInfo)
  const alice = await openAs(browser, 'alice')
  const bob = await openAs(browser, 'bob')

  await test.step('both sit at the table and see each other', async () => {
    await alice.page.goto('/room/blackjack')
    await bob.page.goto('/room/blackjack')
    await expect(alice.page).toHaveTitle('Blackjack · Anzul Casino')
    await expect(alice.page.getByRole('heading', { level: 1, name: 'Blackjack' })).toBeVisible()
    await expect(
      alice.page.getByText('Blackjack pays 3 to 2 · Dealer stands on all 17s'),
    ).toBeVisible()
    await expect(alice.page.getByRole('article', { name: "Bob's seat" })).toBeVisible()
    await expect(bob.page.getByRole('article', { name: "Alice's seat" })).toBeVisible()
    await expect(alice.page.getByRole('article', { name: 'Your seat' })).toBeVisible()
    await snap(alice.page, 'blackjack', 'room', testInfo)
  })

  const alices = await test.step('Alice deals, and her cards land on the table', async () => {
    const dealt = await deal(alice.page, phone)
    const [first] = dealt.round.detail.hands
    expect(dealt.round).toMatchObject({ stake: 10, detail: { bet: 10 } })
    expect(first?.cards).toHaveLength(2)
    expect(dealt.round.detail.dealer.length).toBeGreaterThanOrEqual(1)
    const seat = alice.page.getByRole('article', { name: 'Your seat' })
    for (const card of first?.cards ?? []) {
      await expect(seat.getByRole('img', { name: cardName(card) }).first()).toBeVisible()
    }
    if (dealt.round.status === 'open') {
      // The dealer's other card lies face down, and nobody's browser knows it.
      await expect(seat.getByRole('img', { name: 'A face-down card' })).toBeVisible()
      expect(JSON.stringify(dealt)).not.toContain('secret')
      await snap(alice.page, 'blackjack', 'dealt', testInfo)
    }
    return dealt
  })

  const finished = await test.step('Alice plays the hand out and sees how it ended', async () => {
    const result = await playOut(alice.page, alices, phone)
    const seat = alice.page.getByRole('article', { name: 'Your seat' })
    await expect(seat.locator('footer')).toContainText(seatAmount(result), { timeout: 10_000 })
    await expect(alice.page.getByRole('textbox', { name: 'Bet amount' })).toBeVisible()
    await snap(alice.page, 'blackjack', 'result', testInfo)
    return result
  })

  await test.step('Bob watches her hand on her seat', async () => {
    const seat = bob.page.getByRole('article', { name: "Alice's seat" })
    await expect(seat).toContainText(seatAmount(finished), { timeout: 10_000 })
    await expect(seat).toContainText('vs')
  })

  await test.step('Bob plays a hand, and Alice watches it', async () => {
    const bobs = await playOut(bob.page, await deal(bob.page, phone), phone)
    await expect(alice.page.getByRole('article', { name: "Bob's seat" })).toContainText(
      seatAmount(bobs),
      { timeout: 10_000 },
    )
    await snap(bob.page, 'blackjack', 'watching', testInfo)
  })

  await test.step('the how-to-play card opens and closes', async () => {
    await alice.page.getByRole('button', { name: 'How to play' }).click()
    const card = alice.page.getByRole('dialog', { name: 'How to play Blackjack' })
    await expect(card).toContainText('Get closer to 21 than the dealer')
    await card.getByRole('button', { name: 'Close' }).click()
    await expect(card).toBeHidden()
  })

  await alice.close()
  await bob.close()
})
