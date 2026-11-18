import { expect, test } from '@playwright/test'

test('the site loads', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page).toHaveTitle('Anzul Casino')
  await page.screenshot({
    path: `tests/foundation/screenshots/smoke-${testInfo.project.name}.png`,
    fullPage: true,
  })
})
