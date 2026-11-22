/**
 * The test account at 1440 and 375 (shared/test-accounts.ts): `test` with
 * the password `test` signs in from the login page, locally and on a deploy
 * preview, and lands in the stream with a season to play in and at least
 * 10,000 chips. The integration tests check that production deploys never
 * have it.
 */
import { expect, test } from '@playwright/test'

import { formatChips } from '../../../shared/chips.ts'
import type { SeasonState } from '../../../shared/seasons.ts'
import { TEST_BALANCE, TEST_PASSWORD } from '../../../shared/test-accounts.ts'
import { hideNetlifyDrawer, snap } from '../../e2e-helpers/players.ts'

test('test / test signs in from the login page, with chips to play', async ({ page }, testInfo) => {
  await hideNetlifyDrawer(page.context())
  await page.goto('/login')
  await page.getByLabel('Username').fill('test')
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('combobox', { name: 'Message or command' })).toBeVisible()

  const res = await page.request.get('/api/season')
  expect(res.ok(), await res.text()).toBe(true)
  const { current, wallet } = (await res.json()) as SeasonState
  expect(current?.phase).toMatch(/^(open|final_day)$/)
  expect(wallet?.balance ?? 0).toBeGreaterThanOrEqual(Number(TEST_BALANCE))
  await expect(page.getByLabel('Your chips')).toContainText(formatChips(wallet?.balance ?? 0))
  await snap(page, 'foundation', 'test-account', testInfo)

  // The account menu is in the header on a desktop, and in You on a phone.
  if (testInfo.project.name === 'phone') {
    await page.getByRole('button', { name: /^You: / }).click()
    await page.getByRole('dialog', { name: 'You' }).getByRole('button', { name: 'Log out' }).click()
  } else {
    await page.getByRole('button', { name: 'Your account' }).click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
  }
  await expect(page).toHaveURL(/\/login$/)
})
