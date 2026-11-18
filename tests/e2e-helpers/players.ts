/**
 * Browser-test helpers for every lane: a signed-in player in a browser
 * context of their own, at the test project's screen size. The browser-test
 * database has the sample players from scripts/db/seed.ts (admin, alice,
 * bob, carol) and a running season.
 */
import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  type TestInfo,
} from '@playwright/test'

export const PASSWORD = 'password123'

export interface Player {
  id: string
  context: BrowserContext
  page: Page
}

/** Signs a context in through the API and returns the player's id. */
export async function signIn(context: BrowserContext, username: string): Promise<string> {
  const res = await context.request.post('/api/auth/login', {
    data: { username, password: PASSWORD },
  })
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()) as { user: { id: string } }).user.id
}

/** A player signed in with a page open. Close it with `player.context.close()`. */
export async function openAs(browser: Browser, username: string): Promise<Player> {
  const context = await browser.newContext()
  const id = await signIn(context, username)
  return { id, context, page: await context.newPage() }
}

/** Whether this test runs in the phone project (375px, touch). */
export const onPhone = (testInfo: TestInfo) => testInfo.project.name === 'phone'

/** Saves a screenshot under the lane's screenshots folder, named for the project. */
export async function snap(page: Page, lane: string, name: string, testInfo: TestInfo) {
  await page.screenshot({
    path: `tests/${lane}/screenshots/${name}-${testInfo.project.name}.png`,
    animations: 'disabled',
  })
}
