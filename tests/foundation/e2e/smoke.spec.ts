/**
 * Signing in, at 1440 and at 375: visitors land on the login page, the form
 * signs them in, and they come back to the page they asked for.
 */
import { expect, test } from '@playwright/test'

import { PASSWORD, snap } from '../../e2e-helpers/players.ts'

test('a visitor lands on the login page', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible()
  await expect(page).toHaveTitle('Log in · Anzul Casino')
  await snap(page, 'foundation', 'login', testInfo)

  await page.getByRole('link', { name: /Sign up/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Sign up' })).toBeVisible()
  await snap(page, 'foundation', 'signup', testInfo)
})

test('logging in returns to the page asked for, and logging out ends it', async ({ page }) => {
  await page.goto('/room/mines')
  await expect(page).toHaveURL(/\/login\?next=%2Froom%2Fmines$/)

  await page.getByLabel('Username').fill('carol')
  await page.getByLabel('Password').fill('wrong password')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('alert')).toBeVisible()

  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/room\/mines$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Mines' })).toBeVisible()

  await page.getByRole('button', { name: 'Your account' }).click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
})
