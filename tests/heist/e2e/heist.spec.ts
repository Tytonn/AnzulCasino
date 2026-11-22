/**
 * Heist in real browsers, at 1440 and 375: the Shop (a shield charge and a
 * vault move), the heist panel from the top bar, and a steal from start to
 * finish while the target watches, whatever the dice say. Screenshots land
 * in tests/heist/screenshots.
 *
 * The same tests run on a deploy preview, whose database keeps what earlier
 * runs did: a player may already hold two charges, have moved their vault
 * today or used their steal attempts. Each step checks the player's heist
 * state first and tests what the page should say instead.
 *
 * Steals round down to a whole chip, so a sample player ranked below the
 * thief with about 100 chips is worth nothing to rob ("Small wallet"). The
 * steal falls back to the test accounts, which hold 1,000 chips or more, and
 * which the foundation's test-account spec has signed in by then.
 */
import { expect, type Page, test } from '@playwright/test'

import { chipCount, formatChips } from '../../../shared/chips.ts'
import type { HeistState, StealResponse, VaultResponse } from '../../../shared/features/heist.ts'
import { TEST_ACCOUNTS, TEST_PASSWORD } from '../../../shared/test-accounts.ts'
import { SEED_PLAYERS } from '../../../scripts/db/sample-players.ts'
import { onPhone, openAs, snap } from '../../e2e-helpers/players.ts'

const LANE = 'heist'

/** Players the steal can open as its target, with their password when it is not the sample one. */
const TARGETS: { username: string; displayName: string; password?: string }[] = [
  ...SEED_PLAYERS,
  ...TEST_ACCOUNTS.map((a) => ({ ...a, password: TEST_PASSWORD })),
]

async function heistState(page: Page): Promise<HeistState> {
  const res = await page.request.get('/api/heist/state')
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as HeistState
}

/** Waits for the top bar's heist widgets, which show once the heist state has loaded. */
async function heistReady(page: Page) {
  await expect(page.getByRole('button', { name: /^Steals/ })).toBeVisible()
}

test('the Shop sells a shield charge, and the vault keeps chips out of reach', async ({
  browser,
}, testInfo) => {
  // Each screen size shops as its own player, so both find a shield to buy.
  const player = await openAs(browser, onPhone(testInfo) ? 'carol' : 'bob')
  const { page } = player

  await test.step('the Shop shows what is for sale and how heists work', async () => {
    await page.goto('/shop')
    await expect(page).toHaveTitle('Shop · Anzul Casino')
    await expect(page.getByRole('heading', { level: 1, name: 'Shop' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Shield charge' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Extra steal attempt' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'How heists work' })).toBeVisible()
    await expect(page.getByText(/A steal works 55% of the time/)).toBeVisible()
    await heistReady(page)
    await snap(page, LANE, 'shop', testInfo)
  })

  await test.step('a shield charge lights up a pip in the top bar', async () => {
    const before = (await heistState(page)).me
    const buy = page.getByRole('button', { name: /^Buy a charge/ })
    if (before.charges >= 2 || before.shieldsThisWeek >= 3) {
      // An earlier run on this preview filled them up.
      await expect(buy).toBeDisabled()
      return
    }
    const answer = page.waitForResponse((r) => r.url().endsWith('/api/heist/shield'))
    await buy.click()
    expect((await answer).status()).toBe(200)
    await expect(page.getByText(/^Shield up/)).toBeVisible()
    const charges = before.charges + 1
    await expect(
      page.getByRole('button', {
        name: new RegExp(`^${charges === 1 ? '1 shield charge' : `${charges} shield charges`}`),
      }),
    ).toBeVisible()
  })

  await test.step('half the vault room goes in, and the day’s move is used', async () => {
    const { me } = await heistState(page)
    const vault = page.getByRole('region', { name: 'Your vault' })
    const box = vault.getByRole('textbox', { name: 'Amount to deposit' })
    if (me.vaultMoved) {
      await expect(box).toBeDisabled()
      await expect(vault.getByText(/^One move a game day\. The next one opens in/)).toBeVisible()
      return
    }
    await box.fill('lots')
    await expect(vault.getByText('"lots" is not an amount. Try 20, half or max.')).toBeVisible()
    await vault.getByRole('button', { name: 'Half' }).click()
    await expect(box).toHaveValue('half')
    const answer = page.waitForResponse((r) => r.url().endsWith('/api/heist/vault'))
    await vault.getByRole('button', { name: 'Lock in' }).click()
    const res = await answer
    expect(res.status(), await res.text()).toBe(200)
    const moved = (await res.json()) as VaultResponse
    await expect(
      page.getByText(`${chipCount(moved.amount)} locked in your vault, safe from steals.`),
    ).toBeVisible()
    await expect(vault.getByText(/^One move a game day\. The next one opens in/)).toBeVisible()
    await expect(box).toBeDisabled()
    await snap(page, LANE, 'shop-after', testInfo)
  })

  await player.close()
})

test('a steal plays out for the thief, and the target sees it as it lands', async ({
  browser,
}, testInfo) => {
  const phone = onPhone(testInfo)
  const thief = await openAs(browser, phone ? 'admin' : 'alice')
  const page = thief.page
  const thiefName = phone ? 'Admin' : 'Alice'

  const targetName = await test.step('the heist panel opens from the top bar', async () => {
    await page.goto('/')
    await heistReady(page)
    await page.getByRole('button', { name: /^Steals/ }).click()
    const panel = page.getByRole('dialog', { name: 'Heist' })
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('tab', { name: /^Rob/ })).toHaveAttribute('aria-selected', 'true')
    await snap(page, LANE, 'panel-rob', testInfo)
    await panel.getByRole('tab', { name: 'Defend' }).click()
    await expect(panel.getByText('Lost to steals today')).toBeVisible()
    await expect(panel.getByRole('region', { name: 'Your vault' })).toBeVisible()
    await snap(page, LANE, 'panel-defend', testInfo)
    await panel.getByRole('tab', { name: /^Rob/ }).click()

    // The first sample player this thief can rob right now, once the list is
    // in, else a test account. A preview can hold other players too.
    await expect(panel.getByRole('button', { name: /^Rob / }).first()).toBeVisible()
    const robbable = panel.getByRole('button', { name: /^Rob / }).and(page.locator(':enabled'))
    const { me } = await heistState(page)
    if (me.attemptsUsed >= me.attemptsAllowed) return null
    const names = (
      await robbable.evaluateAll((buttons) =>
        buttons.map((b) => b.getAttribute('aria-label') ?? ''),
      )
    ).map((label) => label.replace(/^Rob /, ''))
    const first = (pool: readonly { displayName: string }[]) =>
      names.find((name) => pool.some((p) => p.displayName === name))
    return first(SEED_PLAYERS) ?? first(TEST_ACCOUNTS) ?? null
  })
  test.skip(
    targetName === null,
    `${thiefName} has no steal attempts or nobody to rob today (an earlier run on this database).`,
  )
  if (targetName === null) return

  const account = TARGETS.find((p) => p.displayName === targetName)
  if (!account) throw new Error(`${targetName} is not a sample player or a test account.`)
  const target = await openAs(browser, account.username, account.password)
  await target.page.goto('/')
  await heistReady(target.page)

  const answer = await test.step('the thief sees the odds, then cracks the vault', async () => {
    // Exact, since "Rob Test" is also the start of "Rob Test 2".
    await page
      .getByRole('dialog', { name: 'Heist' })
      .getByRole('button', { name: `Rob ${targetName}`, exact: true })
      .click()
    const dialog = page.getByRole('dialog', { name: 'Rob a player' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Chance')).toBeVisible()
    await expect(dialog.getByText('If it works')).toBeVisible()
    await expect(dialog.getByText('If you’re caught')).toBeVisible()
    await snap(page, LANE, 'steal-confirm', testInfo)
    const response = page.waitForResponse((r) => r.url().endsWith('/api/heist/steal'))
    await dialog.getByRole('button', { name: new RegExp(`^Rob ${targetName}`) }).click()
    await expect(dialog.getByText(`Cracking ${targetName}’s vault…`)).toBeVisible()
    const res = await response
    expect(res.status(), await res.text()).toBe(200)
    return (await res.json()) as StealResponse
  })

  await test.step('the ending matches the server’s answer', async () => {
    const ending = page.getByRole('dialog', { name: 'Rob a player' }).getByRole('status')
    const { outcome, amount, fine } = answer.steal
    if (outcome === 'success') {
      await expect(ending).toContainText(/Clean getaway|Big score/)
      await expect(ending).toContainText(`+${formatChips(amount)}`)
      await expect(ending).toContainText(`You robbed ${targetName}.`)
    } else if (outcome === 'blocked') {
      await expect(ending).toContainText('Blocked')
      await expect(ending).toContainText(`${targetName}’s shield stopped you`)
    } else {
      await expect(ending).toContainText('Caught')
      await expect(ending).toContainText(fine > 0 ? `−${formatChips(fine)}` : '0')
    }
    // The count-up and the chips have landed.
    await page.waitForTimeout(1_200)
    await snap(page, LANE, `steal-${outcome}`, testInfo)
  })

  await test.step('the target hears about it at once', async () => {
    const alert = target.page.getByRole('alert').filter({ hasText: thiefName })
    const words = {
      success: `${thiefName} robbed you`,
      blocked: `Your shield blocked ${thiefName}`,
      failed: `${thiefName} got caught robbing you`,
    }[answer.steal.outcome]
    await expect(alert).toContainText(words)
    if (answer.steal.outcome !== 'blocked') {
      await expect(alert.getByRole('button', { name: 'Rob back' })).toBeVisible()
    }
    await snap(target.page, LANE, 'alert', testInfo)
  })

  await test.step('the attempt is in the log, and the attempt is used', async () => {
    const dialog = page.getByRole('dialog', { name: 'Rob a player' })
    await dialog.getByRole('button', { name: /^Done/ }).click()
    await expect(dialog).toBeHidden()
    const { me } = await heistState(page)
    expect(me.attemptsUsed).toBe(answer.attemptsUsed)
    const left = me.attemptsAllowed - me.attemptsUsed
    await expect(
      page.getByRole('button', { name: new RegExp(`^Steals: ${left} of ${me.attemptsAllowed}`) }),
    ).toBeVisible()
    await page.getByRole('button', { name: /^Steals/ }).click()
    const panel = page.getByRole('dialog', { name: 'Heist' })
    await panel.getByRole('tab', { name: 'Log' }).click()
    const line = {
      success: `${thiefName} robbed ${targetName}`,
      blocked: `${targetName}’s shield blocked ${thiefName}`,
      failed: `${thiefName} got caught robbing ${targetName}`,
    }[answer.steal.outcome]
    await expect(panel.getByText(line, { exact: true }).first()).toBeVisible()
    await snap(page, LANE, 'panel-log', testInfo)
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
  })

  if (!phone) {
    await test.step('the target’s card says why they cannot be robbed again today', async () => {
      // "Test" is also the start of "Test 2", so leave out rows of players whose names hold it.
      let row = page
        .getByRole('complementary')
        .getByRole('button', { name: new RegExp(targetName) })
      for (const other of TARGETS) {
        if (other.displayName !== targetName && other.displayName.includes(targetName)) {
          row = row.filter({ hasNotText: other.displayName })
        }
      }
      await row.first().click()
      const card = page.getByRole('dialog', { name: 'Player' })
      await expect(
        card.getByRole('button', { name: new RegExp(`^Rob ${targetName}`) }),
      ).toBeDisabled()
      await expect(card.getByText(/is immune for|You already tried/)).toBeVisible()
      await snap(page, LANE, 'profile-card', testInfo)
    })
  }

  await target.close()
  await thief.close()
})
