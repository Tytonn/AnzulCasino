/**
 * The stream in real browsers, at 1440 and 375 (spec: The stream, Tyton,
 * Nov 22, 2026): two players in one stream; a hand of blackjack dealt from
 * the message box and pinned above it with the keys, which the other player
 * watches live and cannot touch; Deal again; finished hands folding to a
 * line that opens to the replay; a private hint for a command that does not
 * exist and a private reply to .help; .work posting its result for
 * everyone; and the filters. Screenshots land in tests/shell/screenshots.
 *
 * On a deploy preview the stream keeps what earlier runs posted, so every
 * check looks for this run's own items: its chat lines, its rounds by id.
 */
import { expect, type Locator, type Page, type Response, test } from '@playwright/test'

import type { StreamFilter } from '../../../shared/chat.ts'
import { formatChips } from '../../../shared/chips.ts'
import type { ConfigValues } from '../../../shared/config.ts'
import type { IncomeResponse } from '../../../shared/features/economy.ts'
import {
  type BlackjackDetail,
  cardName,
  handTotal,
  type Move,
} from '../../../shared/games/blackjack.ts'
import type { PlayResult } from '../../../shared/rounds.ts'
import { onPhone, openAs, snap } from '../../e2e-helpers/players.ts'

type Hand = PlayResult<BlackjackDetail>

const LANE = 'shell'

const LABELS: Record<Move, string> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
}

const FILTERS: Record<StreamFilter, string> = {
  all: 'Everything',
  chat: 'Chat only',
  games: 'Games only',
}

const box = (page: Page) => page.getByRole('combobox', { name: 'Message or command' })
const stream = (page: Page) => page.getByRole('log', { name: /^The stream/ })
const pinned = (page: Page) => page.getByRole('region', { name: 'Your game' })
/** A round's card in the stream: live, or folded to its line. */
const inStream = (page: Page, roundId: number) =>
  stream(page).locator(`[data-round="${roundId}"], [data-folded="${roundId}"]`)

async function expectOk(res: Response) {
  expect(res.status(), await res.text()).toBe(200)
}

/** Types a line into the message box and presses Enter, as a player does. */
async function enter(page: Page, text: string) {
  await box(page).fill(text)
  await box(page).press('Enter')
}

/** Deals a 1-chip hand from the message box and returns the server's answer. */
async function deal(page: Page): Promise<Hand> {
  const answer = page.waitForResponse((r) => r.url().endsWith('/api/blackjack/deal'))
  await enter(page, '.bj 1')
  const res = await answer
  await expectOk(res)
  return (await res.json()) as Hand
}

/** Hits below 12 and stands from there: with the keys on a desktop, with taps on a phone. */
async function playOut(page: Page, hand: Hand, phone: boolean): Promise<Hand> {
  const card = pinned(page).locator(`[data-round="${hand.round.id}"]`)
  let result = hand
  for (let moves = 0; result.round.status === 'open' && moves < 12; moves++) {
    const { detail } = result.round
    const cards = detail.hands[detail.active ?? 0]?.cards ?? []
    const move: Move = handTotal(cards).total < 12 ? 'hit' : 'stand'
    const button = card
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

/** How a finished card says its result: "+1", "+1.50", "−1" or "±0". */
function signed(hand: Hand): string {
  const net = (hand.round.payout ?? 0) - hand.round.stake
  if (net > 0) return `+${formatChips(net)}`
  if (net < 0) return `−${formatChips(-net)}`
  return '±0'
}

/** Switches the stream's filter: pills over the stream on a desktop, one select on a phone. */
async function show(page: Page, phone: boolean, filter: StreamFilter) {
  if (phone) {
    await page.getByRole('combobox', { name: 'Show in the stream' }).selectOption(filter)
  } else {
    await page
      .getByRole('group', { name: 'Show in the stream' })
      .getByRole('button', { name: FILTERS[filter] })
      .click()
  }
  await expect(stream(page)).toHaveAccessibleName(`The stream: ${FILTERS[filter]}`)
}

/** The first card of the hand's player, which the replay shows face up. */
function firstCard(hand: Hand): string {
  const card = hand.round.detail.hands[0]?.cards[0]
  if (!card) throw new Error('The hand has no cards.')
  return cardName(card)
}

test('a hand dealt from the message box plays live for everyone, then folds', async ({
  browser,
}, testInfo) => {
  const phone = onPhone(testInfo)
  const alice = await openAs(browser, 'alice')
  const bob = await openAs(browser, 'bob')
  const stamp = `${testInfo.project.name}-${Date.now().toString(36)}`

  await test.step('both open the stream, and Alice says hi', async () => {
    await alice.page.goto('/')
    await bob.page.goto('/')
    await expect(alice.page).toHaveTitle('Anzul Casino')
    await expect(stream(alice.page)).toHaveAccessibleName('The stream: Everything')
    const hello = `deal me in ${stamp}`
    await enter(alice.page, hello)
    await expect(box(alice.page)).toHaveValue('')
    await expect(stream(alice.page).getByText(hello)).toBeVisible()
    await expect(stream(bob.page).getByText(hello)).toBeVisible()
  })

  await test.step('the box lists the commands, and a typo gets a hint for Alice alone', async () => {
    await box(alice.page).fill('.')
    const list = alice.page.getByRole('listbox', { name: 'Commands' })
    await expect(list).toBeVisible()
    await expect(list.getByRole('option').filter({ hasText: '.bj' })).toBeVisible()
    await snap(alice.page, LANE, 'stream-commands', testInfo)

    await enter(alice.page, '.bjj 1')
    const hint = alice.page.locator('[data-hint]')
    await expect(hint).toContainText('There is no .bjj. Did you mean .bj?')
    await expect(box(alice.page)).toHaveValue('.bjj 1')
    await hint.getByRole('button', { name: 'Use .bj' }).click()
    await expect(box(alice.page)).toHaveValue('.bj 1')
    await expect(hint).toBeHidden()
    // Nothing of it reached the stream.
    await expect(stream(bob.page).getByText('.bjj')).toHaveCount(0)
    await box(alice.page).fill('')
  })

  const first =
    await test.step('Alice types .bj 1: her card is pinned above the box with the keys', async () => {
      const dealt = await deal(alice.page)
      expect(dealt.round).toMatchObject({ game: 'blackjack', stake: 100 })
      expect(dealt.card?.meta).toMatchObject({ game: 'blackjack', roundId: dealt.round.id })
      // The dealer's hole card stays on the server.
      expect(JSON.stringify(dealt)).not.toContain('secret')
      // The command itself is never posted.
      await expect(box(alice.page)).toHaveValue('')
      await expect(stream(bob.page).getByText('.bj 1', { exact: true })).toHaveCount(0)

      const card = pinned(alice.page).locator(`[data-round="${dealt.round.id}"]`)
      await expect(card).toBeVisible()
      for (const shown of dealt.round.detail.hands[0]?.cards ?? []) {
        await expect(card.getByRole('img', { name: cardName(shown) }).first()).toBeVisible()
      }
      if (dealt.round.status === 'open') {
        // The keys are a desktop's; a phone's card says it is live.
        await expect(card).toContainText(phone ? 'live' : 'Your keys')
        await expect(card.getByRole('group', { name: 'Your move' })).toBeVisible()
        await expect(card.getByRole('img', { name: 'A face-down card' }).first()).toBeVisible()
        await expect(
          stream(alice.page).getByText(/Your blackjack hand is pinned below/),
        ).toBeVisible()
        await snap(alice.page, LANE, 'stream-dealt', testInfo)
      }
      return dealt
    })

  await test.step('Bob watches the hand live, without its buttons', async () => {
    const card = inStream(bob.page, first.round.id)
    await expect(card).toBeVisible()
    await expect(card.getByRole('group', { name: 'Your move' })).toHaveCount(0)
    await expect(card.getByRole('button', { name: /^Deal again/ })).toHaveCount(0)
    if (first.round.status === 'open') {
      await expect(card).toContainText('Their move…')
      await snap(bob.page, LANE, 'stream-watching', testInfo)
    }
  })

  const second =
    await test.step('Alice plays it out, then deals again at the same bet', async () => {
      const result = await playOut(alice.page, first, phone)
      const card = pinned(alice.page).locator(`[data-round="${first.round.id}"]`)
      await expect(card).toContainText(signed(result))
      const again = card.getByRole('button', { name: /^Deal again · 1/ })
      await expect(again).toBeVisible()
      await snap(alice.page, LANE, 'stream-result', testInfo)

      const answer = alice.page.waitForResponse((r) => r.url().endsWith('/api/blackjack/deal'))
      if (phone) await again.click()
      else await alice.page.keyboard.press('Space')
      const res = await answer
      await expectOk(res)
      const dealt = (await res.json()) as Hand
      expect(dealt.round.stake).toBe(100)
      // The new hand takes the pin at once; the finished one goes back to the stream.
      await expect(pinned(alice.page).locator(`[data-round="${dealt.round.id}"]`)).toBeVisible()
      await expect(pinned(alice.page).locator(`[data-round="${first.round.id}"]`)).toHaveCount(0)
      return { first: result, next: await playOut(alice.page, dealt, phone) }
    })

  await test.step('Bob saw how the first hand ended', async () => {
    // Live, or already folded to its line, unless both hands folded into one run.
    const card = inStream(bob.page, first.round.id)
    if ((await card.count()) > 0) await expect(card).toContainText(signed(second.first))
  })

  await test.step('both hands fold, and their line opens to the replay', async () => {
    const { config } = (await (await bob.page.request.get('/api/config')).json()) as {
      config: ConfigValues
    }
    const log = stream(bob.page)
    const firstLine = log.locator(`[data-folded="${first.round.id}"]`)
    const nextLine = log.locator(`[data-folded="${second.next.round.id}"]`)
    if (config.stream_round_runs === 'fold') {
      // One player's finished rounds in a row: one line for the run.
      const run = log.locator(
        `[data-rounds~="${first.round.id}"][data-rounds~="${second.next.round.id}"]`,
      )
      await expect(run).toBeVisible({ timeout: 20_000 })
      const toggle = run.getByRole('button', { name: /2 Blackjack hands/ })
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await snap(bob.page, LANE, 'stream-folded', testInfo)
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    }
    await expect(firstLine).toBeVisible({ timeout: 20_000 })
    await expect(nextLine).toBeVisible()
    await expect(firstLine).toContainText(signed(second.first))
    await expect(nextLine).toContainText(signed(second.next))

    const open = firstLine.getByRole('button').first()
    await open.click()
    await expect(open).toHaveAttribute('aria-expanded', 'true')
    await expect(
      firstLine.getByRole('img', { name: firstCard(second.first) }).first(),
    ).toBeVisible()
    await snap(bob.page, LANE, 'stream-replay', testInfo)

    // Alice's own pin let go, and her stream folds the hands too.
    await expect(pinned(alice.page)).toHaveCount(0, { timeout: 15_000 })
    await expect(stream(alice.page).locator(`[data-round="${second.next.round.id}"]`)).toHaveCount(
      0,
      { timeout: 15_000 },
    )
  })

  await alice.close()
  await bob.close()
})

test('.help answers privately, .work posts for everyone, and the filters sort the stream', async ({
  browser,
}, testInfo) => {
  const phone = onPhone(testInfo)
  const bob = await openAs(browser, 'bob')
  const carol = await openAs(browser, 'carol')
  const stamp = `${testInfo.project.name}-${Date.now().toString(36)}`
  await bob.page.goto('/')
  await carol.page.goto('/')
  await expect(stream(bob.page)).toBeVisible()
  await expect(stream(carol.page)).toBeVisible()

  await test.step('.help lists the commands for Bob alone', async () => {
    await enter(bob.page, '.help')
    const reply = stream(bob.page).locator('[data-kind="private"]').last()
    await expect(reply).toContainText('Only you · Commands')
    await expect(reply).toContainText('.bj')
    await expect(box(bob.page)).toHaveValue('')
    await expect(stream(carol.page).getByText('Only you · Commands')).toHaveCount(0)
    await snap(bob.page, LANE, 'stream-help', testInfo)
    await reply.getByRole('button', { name: 'Dismiss' }).click()
    await expect(reply).toHaveCount(0)
  })

  const hello = `who is working ${stamp}`
  await test.step('Bob says something, for the filters', async () => {
    await enter(bob.page, hello)
    await expect(stream(carol.page).getByText(hello)).toBeVisible()
  })

  await test.step('.work posts Carol’s pay for everyone, or says when it is ready', async () => {
    const answer = carol.page.waitForResponse((r) => r.url().endsWith('/api/economy/work'))
    await enter(carol.page, '.work')
    const res = await answer
    if (res.status() === 200) {
      const { result } = (await res.json()) as IncomeResponse
      const line = stream(bob.page).locator('[data-kind="income"]').filter({ hasText: 'Carol' })
      await expect(line.last()).toContainText(
        `${result.outcome === 'paid' ? '+' : '−'}${formatChips(result.amount)}`,
      )
      await expect(box(carol.page)).toHaveValue('')
    } else {
      // Worked a moment ago, in an earlier test: the box says when, for Carol alone.
      expect(res.status(), await res.text()).toBe(409)
      const hint = carol.page.locator('[data-hint]')
      await expect(hint).toContainText('Only you')
      await expect(hint).toContainText(/is ready again in/)
      await expect(box(carol.page)).toHaveValue('.work')
    }
  })

  await test.step('Games only hides the chat, Chat only hides the games', async () => {
    const log = stream(bob.page)
    await show(bob.page, phone, 'games')
    await expect(log.getByText(hello)).toHaveCount(0)
    await expect(log.locator('[data-kind="player"]')).toHaveCount(0)
    await snap(bob.page, LANE, 'stream-games', testInfo)

    await show(bob.page, phone, 'chat')
    await expect(log.getByText(hello)).toBeVisible()
    await expect(
      log.locator('[data-row="card"], [data-row="run"], [data-kind="income"]'),
    ).toHaveCount(0)

    await show(bob.page, phone, 'all')
    await expect(log.getByText(hello)).toBeVisible()
  })

  await bob.close()
  await carol.close()
})

/** Whether any part of the page is wider than the screen. */
function overflows(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
}

test('the panels beside the stream, and a page over it', async ({ browser }, testInfo) => {
  const phone = onPhone(testInfo)
  const alice = await openAs(browser, 'alice')
  const { page } = alice
  await page.goto('/')
  await expect(stream(page)).toBeVisible()
  expect(await overflows(page)).toBe(false)

  const look = async (name: string, panel: (where: Locator) => Promise<void>) => {
    if (!phone) {
      await panel(page.getByRole('complementary', { name }))
      return
    }
    await page
      .getByRole('button', { name: name === 'You' ? /^You: / : 'Leaderboard and who is online' })
      .click()
    const sheet = page.getByRole('dialog', { name: name === 'You' ? 'You' : 'Leaderboard' })
    await panel(sheet)
    await snap(page, LANE, `stream-${name === 'You' ? 'you' : 'board'}`, testInfo)
    await sheet.getByRole('button', { name: 'Close' }).click()
    await expect(sheet).toBeHidden()
  }

  await test.step('the board: the leaderboard and who is online', async () => {
    await look('The board', async (board) => {
      await expect(board.getByRole('region', { name: 'Leaderboard' })).toBeVisible()
      await expect(board.getByRole('region', { name: 'Online' })).toContainText('Alice')
    })
  })

  await test.step('You: the wallet, the vault and the pages', async () => {
    await look('You', async (you) => {
      await expect(you.getByRole('group', { name: 'Your chips' })).toContainText('Wallet')
      await expect(you.getByRole('group', { name: 'Your chips' })).toContainText('Vault')
      await expect(you.getByRole('link', { name: 'Shop' })).toBeVisible()
      await expect(you.getByRole('link', { name: 'Classic rooms' })).toBeVisible()
    })
    if (!phone) await snap(page, LANE, 'stream-desktop', testInfo)
  })

  await test.step('the Shop opens over the stream, and Escape goes back to it', async () => {
    if (phone) {
      await page.getByRole('button', { name: /^You: / }).click()
      await page.getByRole('dialog', { name: 'You' }).getByRole('link', { name: 'Shop' }).click()
    } else {
      await page
        .getByRole('complementary', { name: 'You' })
        .getByRole('link', { name: 'Shop' })
        .click()
    }
    await expect(page).toHaveURL(/\/shop$/)
    const panel = page.getByRole('region', { name: 'Shop' })
    await expect(panel.getByRole('heading', { level: 1, name: 'Shop' })).toBeVisible()
    expect(await overflows(page)).toBe(false)
    await snap(page, LANE, 'stream-page', testInfo)
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/$/)
    await expect(panel).toBeHidden()
    await expect(box(page)).toBeVisible()
  })

  await alice.close()
})
