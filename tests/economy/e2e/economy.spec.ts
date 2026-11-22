/**
 * The economy in real browsers, at 1440 and 375: the top-bar buttons and
 * their result card, Collect, the Daily panel, and a chat drop two players
 * race for. Screenshots land in tests/economy/screenshots.
 *
 * On a deploy preview the players keep their chips, cooldowns and claims
 * from run to run, so every step reads the state first instead of assuming
 * it. The chat drop needs the local database to land one, so it runs only
 * locally and in CI.
 */
import { expect, type Page, test } from '@playwright/test'
import pg from 'pg'

import { chipCount, formatChips } from '../../../shared/chips.ts'
import type { CollectResponse, IncomeResponse } from '../../../shared/features/economy.ts'
import { onPhone, openAs, snap } from '../../e2e-helpers/players.ts'

/** Each screen size plays as its own player, so cooldowns from one never block the other. */
const playerFor = (phone: boolean) => (phone ? 'bob' : 'alice')

/** The wallet in the top bar shows this balance. */
async function expectWallet(page: Page, balance: number) {
  await expect(page.getByLabel('Your chips')).toContainText(formatChips(balance))
}

test('work, slut and crime pay from the top bar, then cool down', async ({ browser }, testInfo) => {
  const phone = onPhone(testInfo)
  const player = await openAs(browser, playerFor(phone))
  const { page } = player
  await page.goto('/')

  const jobs = page.getByRole('group', { name: /^Work, .+ and crime$/ })
  await expect(jobs).toBeVisible()
  const work = jobs.getByRole('button', { name: /^Work: / })
  const card = page.locator('[data-economy-result]')

  if (/ready in/.test((await work.getAttribute('aria-label')) ?? '')) {
    await test.step('Work is cooling down from an earlier run: it says when', async () => {
      await work.click()
      await expect(page.getByText(/^Work is ready again in /)).toBeVisible()
    })
  } else {
    await test.step('Work pays at once, with a line, and says when it is ready again', async () => {
      const answer = page.waitForResponse((r) => r.url().endsWith('/api/economy/work'))
      await work.click()
      const res = await answer
      expect(res.status(), await res.text()).toBe(200)
      const body = (await res.json()) as IncomeResponse
      expect(body.result.outcome).toBe('paid')
      await expect(card).toBeVisible()
      await expect(card).toContainText(`+${formatChips(body.result.amount)}`)
      await expect(card).toContainText(body.result.line)
      await expect(card).toContainText(/Work again in \d/)
      await expectWallet(page, body.wallet.balance)
      await expect(work).toHaveAttribute('aria-label', /^Work: ready in /)
      await snap(page, 'economy', 'work-result', testInfo)
    })

    await test.step('pressing it again before then sends nothing', async () => {
      let sent = false
      page.on('request', (r) => {
        if (r.url().endsWith('/api/economy/work')) sent = true
      })
      await page.keyboard.press('Escape')
      await expect(card).toBeHidden()
      await work.click()
      await expect(page.getByText(/^Work is ready again in /)).toBeVisible()
      expect(sent).toBe(false)
    })
  }

  const crime = jobs.getByRole('button', { name: /^Crime: / })
  if (!/ready in/.test((await crime.getAttribute('aria-label')) ?? '')) {
    await test.step('crime pays or fines, and the card shows which', async () => {
      const answer = page.waitForResponse((r) => r.url().endsWith('/api/economy/crime'))
      // Shift+C from anywhere on a keyboard; a tap on a phone.
      if (phone) await crime.click()
      else await page.keyboard.press('Shift+C')
      const res = await answer
      expect(res.status(), await res.text()).toBe(200)
      const body = (await res.json()) as IncomeResponse
      const sign = body.result.outcome === 'paid' ? '+' : '−'
      await expect(card).toContainText(`${sign}${formatChips(body.result.amount)}`)
      await expect(card).toContainText(/Crime again in \d/)
      await expectWallet(page, body.wallet.balance)
      await card.getByRole('button', { name: 'Close' }).click()
      await expect(card).toBeHidden()
    })
  }

  await player.close()
})

test('Collect pays the rank income and the streak bonus', async ({ browser }, testInfo) => {
  const phone = onPhone(testInfo)
  const player = await openAs(browser, playerFor(phone))
  const { page } = player
  await page.goto('/')

  const button = page.getByRole('button', { name: /^Collect/ })
  await expect(button).toBeVisible()
  if (!/^Collect [\d,.]+: /.test((await button.getAttribute('aria-label')) ?? '')) {
    // Collected moments ago on a preview: income builds a whole chip at a time.
    await button.click()
    await expect(
      page.getByText(/^Nothing to collect yet\. (Your next chip comes in |Income builds at )/),
    ).toBeVisible()
    await player.close()
    return
  }

  const answer = page.waitForResponse((r) => r.url().endsWith('/api/economy/collect'))
  await button.click()
  const res = await answer
  expect(res.status(), await res.text()).toBe(200)
  const body = (await res.json()) as CollectResponse
  const { income, bonus, streak } = body.collected

  const card = page.locator('[data-economy-result]')
  await expect(card).toContainText('Collected')
  await expect(card).toContainText(`+${formatChips(income + bonus)}`)
  if (income > 0) await expect(card).toContainText(`rank income: ${chipCount(income)}.`)
  if (bonus > 0) await expect(card).toContainText(`Day ${streak} streak bonus: ${chipCount(bonus)}`)
  await expectWallet(page, body.wallet.balance)
  await snap(page, 'economy', 'collect-result', testInfo)
  await player.close()
})

test('the Daily panel shows the challenges, the streak and the next rank', async ({
  browser,
}, testInfo) => {
  const phone = onPhone(testInfo)
  const player = await openAs(browser, playerFor(phone))
  const { page } = player
  await page.goto('/')

  const daily = page.getByRole('button', { name: /^Daily: / })
  await expect(daily).toBeVisible()
  if (phone) await daily.click()
  else await page.keyboard.press('Shift+D')

  const panel = page.getByRole('dialog', { name: 'Daily' })
  await expect(panel).toBeVisible()
  const challenges = panel.getByRole('region', { name: 'Challenges' })
  await expect(challenges.getByRole('listitem')).toHaveCount(3)
  await expect(challenges).toContainText(/Easy/)
  await expect(challenges).toContainText(/Medium/)
  await expect(challenges).toContainText(/Hard/)
  await expect(panel.getByRole('region', { name: 'Streak' })).toBeVisible()
  await expect(panel.getByRole('region', { name: 'Rank' })).toContainText(/Base|Bronze|Silver/)
  await snap(page, 'economy', 'daily', testInfo)

  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await player.close()
})

// ---------------------------------------------------------------- chat drops

/** Lands a chat drop now, the way the server does, straight in the local database. */
async function landDrop(pot: number, winners: number): Promise<number> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL })
  await db.connect()
  try {
    await db.query('begin')
    const [season] = (
      await db.query<{ id: number }>(
        `select id from seasons where starts_at <= now() and now() < ends_at order by starts_at desc limit 1`,
      )
    ).rows
    if (!season) throw new Error('No running season in the browser-test database.')
    const share = Math.floor(pot / winners)
    const [drop] = (
      await db.query<{ id: string }>(
        `insert into economy_drops (season_id, appears_at, pot, winners, posted_at)
         values ($1, now(), $2, $3, now()) returning id`,
        [season.id, pot, winners],
      )
    ).rows
    if (!drop) throw new Error('The drop was not saved.')
    const id = Number(drop.id)
    const [message] = (
      await db.query<{ id: string }>(
        `insert into chat_messages (user_id, kind, body, meta)
         values (null, 'system', $1, $2) returning id`,
        [
          `💰 Chat drop! ${formatChips(pot)} chips for the first ${winners} to grab it: ${formatChips(share)} each.`,
          JSON.stringify({ tone: 'win', drop: { id, pot, winners, share } }),
        ],
      )
    ).rows
    await db.query('update economy_drops set message_id = $1 where id = $2', [message?.id, id])
    await db.query('commit')
    return id
  } catch (error) {
    await db.query('rollback')
    throw error
  } finally {
    await db.end()
  }
}

test('a chat drop lands, and the first players to grab it split the pot, live', async ({
  browser,
}, testInfo) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Lands the drop through the local database.')
  const phone = onPhone(testInfo)
  const dropId = await landDrop(9, 3)

  const alice = await openAs(browser, 'alice')
  const bob = await openAs(browser, 'bob')
  await alice.page.goto('/')
  await bob.page.goto('/')

  const alicePill = alice.page.getByRole('status', { name: 'Chat drop' })
  const bobPill = bob.page.getByRole('status', { name: 'Chat drop' })
  await expect(alicePill).toContainText('3 each · 3 of 3 left')
  await expect(bobPill).toContainText('3 each · 3 of 3 left')
  await snap(alice.page, 'economy', 'drop-pill', testInfo)

  await test.step('Alice grabs a share from the pill', async () => {
    const answer = alice.page.waitForResponse((r) => r.url().endsWith('/api/economy/drops/claim'))
    await alicePill.getByRole('button', { name: 'Grab 3' }).click()
    const res = await answer
    expect(res.status(), await res.text()).toBe(200)
    await expect(alice.page.getByText('You grabbed 3 chips from the chat drop.')).toBeVisible()
    await expect(alicePill).toBeHidden()
  })

  await test.step('Bob watches the shares go down, and grabs one too', async () => {
    await expect(bobPill).toContainText('3 each · 2 of 3 left')
    if (!phone) {
      const post = bob.page.locator(`[data-economy-drop="${dropId}"]`)
      await expect(post).toContainText('2 of 3 shares left')
      await expect(post.getByLabel('Grabbed by')).toContainText('Alice')
    }
    await bobPill.getByRole('button', { name: 'Grab 3' }).click()
    await expect(bob.page.getByText('You grabbed 3 chips from the chat drop.')).toBeVisible()
    if (!phone) {
      await expect(alice.page.locator(`[data-economy-drop="${dropId}"]`)).toContainText(
        'You grabbed 3 chips.',
      )
      await snap(alice.page, 'economy', 'drop-chat', testInfo)
    }
  })

  await alice.close()
  await bob.close()
})
