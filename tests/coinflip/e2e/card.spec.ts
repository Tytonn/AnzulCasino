/**
 * Coin flip as a card in the stream, in real browsers at 1440 and 375
 * (spec: The stream > Cards): the message box offers a bet and a side and
 * asks for what is missing; .flip 25 t lands the coin on a card pinned above
 * the box; the player changes the call and flips again, with the keys on a
 * desktop and taps on a phone; the other player watches it land without the
 * buttons; and the flips fold to a line that stays open to the replay.
 * Screenshots land in tests/coinflip/screenshots.
 *
 * On a deploy preview the stream keeps what earlier runs posted, so every
 * check looks for this run's own items: its chat line, its rounds by id.
 */
import { expect, type Page, test } from '@playwright/test'

import { formatChips } from '../../../shared/chips.ts'
import type { ConfigValues } from '../../../shared/config.ts'
import { type CoinflipDetail, SIDE_NAMES } from '../../../shared/games/coinflip.ts'
import type { PlayResult } from '../../../shared/rounds.ts'
import { onPhone, openAs, snap } from '../../e2e-helpers/players.ts'

type Flip = PlayResult<CoinflipDetail>

const LANE = 'coinflip'

const box = (page: Page) => page.getByRole('combobox', { name: 'Message or command' })
const stream = (page: Page) => page.getByRole('log', { name: /^The stream/ })
const pinned = (page: Page) => page.getByRole('region', { name: 'Your game' })
/** A round's card in the stream: live, or folded to its line. */
const inStream = (page: Page, roundId: number) =>
  stream(page).locator(`[data-round="${roundId}"], [data-folded="${roundId}"]`)

/** Types a line into the message box and presses Enter, as a player does. */
async function enter(page: Page, text: string) {
  await box(page).fill(text)
  await box(page).press('Enter')
}

async function answer(page: Page, send: () => Promise<void>): Promise<Flip> {
  const response = page.waitForResponse((r) => r.url().endsWith('/api/coinflip/play'))
  await send()
  const res = await response
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as Flip
}

function landed(flip: Flip): string {
  const face = flip.round.detail.face
  if (!face) throw new Error('The coin never landed.')
  return SIDE_NAMES[face]
}

/** How the card says it: "Tails! +24" (1.96x of 25 pays 49) or "Heads. −25". */
function outcome(flip: Flip): string {
  const net = (flip.round.payout ?? 0) - flip.round.stake
  return net > 0
    ? `${landed(flip)}! +${formatChips(net)}`
    : `${landed(flip)}. −${formatChips(flip.round.stake)}`
}

/** How a folded line says it: "+24" or "−25". */
function signed(flip: Flip): string {
  const net = (flip.round.payout ?? 0) - flip.round.stake
  return net > 0 ? `+${formatChips(net)}` : `−${formatChips(-net)}`
}

test('a flip from the message box lands live for everyone, flips again, then folds', async ({
  browser,
}, testInfo) => {
  const phone = onPhone(testInfo)
  const alice = await openAs(browser, 'alice')
  const bob = await openAs(browser, 'bob')
  const stamp = `${testInfo.project.name}-${Date.now().toString(36)}`

  await test.step('both open the stream, and Alice says she is flipping', async () => {
    await alice.page.goto('/')
    await bob.page.goto('/')
    const hello = `heads I win ${stamp}`
    await enter(alice.page, hello)
    await expect(stream(bob.page).getByText(hello)).toBeVisible()
  })

  await test.step('the box offers a bet and a side, and asks for what is missing', async () => {
    await box(alice.page).fill('.flip ')
    await alice.page.getByRole('button', { name: 'tails', exact: true }).click()
    await expect(box(alice.page)).toHaveValue('.flip tails')
    await alice.page.getByRole('button', { name: '50', exact: true }).click()
    await expect(box(alice.page)).toHaveValue('.flip 50 tails')
    await snap(alice.page, LANE, 'card-command', testInfo)

    const hint = alice.page.locator('[data-hint]')
    await enter(alice.page, '.flip tails')
    await expect(hint).toContainText('.flip needs a bet, like .flip 50 heads or .flip all.')
    await enter(alice.page, '.flip 25 heads t')
    await expect(hint).toContainText('Pick one: heads or tails.')
    await box(alice.page).fill('')
  })

  const first =
    await test.step('Alice types .flip 25 t: the coin lands on her pinned card', async () => {
      const flip = await answer(alice.page, () => enter(alice.page, '.flip 25 t'))
      expect(flip.round).toMatchObject({
        game: 'coinflip',
        stake: 25,
        status: 'settled',
        detail: { call: 'tails' },
      })
      expect(flip.card?.meta).toMatchObject({ game: 'coinflip', roundId: flip.round.id })
      await expect(box(alice.page)).toHaveValue('')

      const card = pinned(alice.page).locator(`[data-round="${flip.round.id}"]`)
      await expect(card.getByRole('img', { name: `The coin landed ${landed(flip)}` })).toBeVisible()
      await expect(card).toContainText(outcome(flip))
      await expect(card).toContainText('you called tails')
      await expect(stream(alice.page).getByText('Your coin flip is pinned below')).toBeVisible()
      await snap(alice.page, LANE, 'card-landed', testInfo)
      return flip
    })

  const second = await test.step('Alice calls heads and flips again at the same bet', async () => {
    const card = pinned(alice.page).locator(`[data-round="${first.round.id}"]`)
    const heads = card
      .getByRole('group', { name: 'Your call' })
      .getByRole('button', { name: /^Heads/ })
    const again = card.getByRole('button', { name: /^Flip again · 25\b/ })
    await expect(again).toBeVisible()
    if (phone) await heads.click()
    else await alice.page.keyboard.press('h')
    await expect(heads).toHaveAttribute('aria-pressed', 'true')

    const flip = await answer(alice.page, async () => {
      if (phone) await again.click()
      else await alice.page.keyboard.press('Space')
    })
    expect(flip.round).toMatchObject({ stake: 25, detail: { call: 'heads' } })
    // The new flip takes the pin at once; the first goes back to the stream.
    const next = pinned(alice.page).locator(`[data-round="${flip.round.id}"]`)
    await expect(next).toContainText(outcome(flip))
    await expect(pinned(alice.page).locator(`[data-round="${first.round.id}"]`)).toHaveCount(0)
    return flip
  })

  await test.step('Bob watched both land, without the buttons', async () => {
    for (const flip of [first, second]) {
      const card = inStream(bob.page, flip.round.id)
      // Live, or already folded to its line, unless both folded into one run.
      if ((await card.count()) === 0) continue
      await expect(card).toContainText(signed(flip))
      await expect(card.getByRole('group', { name: 'Your call' })).toHaveCount(0)
      await expect(card.getByRole('button', { name: /^Flip again/ })).toHaveCount(0)
    }
    const live = stream(bob.page).locator(`[data-round="${second.round.id}"]`)
    if ((await live.count()) > 0) {
      await expect(live).toContainText('called heads')
      await snap(bob.page, LANE, 'card-watching', testInfo)
    }
  })

  await test.step('both flips fold to their replay, open, and the line closes it', async () => {
    const { config } = (await (await bob.page.request.get('/api/config')).json()) as {
      config: ConfigValues
    }
    const log = stream(bob.page)
    const firstLine = log.locator(`[data-folded="${first.round.id}"]`)
    if (config.stream_round_runs === 'fold') {
      const run = log.locator(
        `[data-rounds~="${first.round.id}"][data-rounds~="${second.round.id}"]`,
      )
      await expect(run).toBeVisible({ timeout: 20_000 })
      const toggle = run.getByRole('button', { name: /2 Coin flips/ })
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    }
    await expect(firstLine).toBeVisible({ timeout: 20_000 })
    await expect(firstLine).toContainText(`Coin flip 25 · ${landed(first)}`)
    await expect(firstLine).toContainText(signed(first))

    // The result stays in view: the line is open to the replay until closed.
    const open = firstLine.getByRole('button').first()
    await expect(open).toHaveAttribute('aria-expanded', 'true')
    const coin = firstLine.getByRole('img', { name: `The coin landed ${landed(first)}` })
    await expect(coin).toBeVisible()
    await expect(firstLine).toContainText(`Called Tails, landed ${landed(first)}`)
    await snap(bob.page, LANE, 'card-replay', testInfo)
    await open.click()
    await expect(open).toHaveAttribute('aria-expanded', 'false')
    await expect(coin).toHaveCount(0)
    await open.click()
    await expect(coin).toBeVisible()

    // Alice's pin let go, and her stream folds the flips too.
    await expect(pinned(alice.page)).toHaveCount(0, { timeout: 15_000 })
    await expect(stream(alice.page).locator(`[data-round="${second.round.id}"]`)).toHaveCount(0, {
      timeout: 15_000,
    })
  })

  await alice.close()
  await bob.close()
})
