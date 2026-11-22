/**
 * Browser-test helpers for every lane: a signed-in player in a browser
 * context of their own, at the test project's screen size. The browser-test
 * database has the sample players from scripts/db/sample-players.ts (admin,
 * alice, bob, carol) and a running season. On a deploy preview,
 * preview-setup.ts signs them up first.
 */
import {
  type Browser,
  type BrowserContext,
  type Cookie,
  expect,
  type Page,
  type TestInfo,
} from '@playwright/test'

import { SEED_PASSWORD } from '../../scripts/db/sample-players.ts'

/**
 * The sample players' password: the local one here, and E2E_PASSWORD on a
 * deploy preview, which anyone on the internet can open.
 */
export const PASSWORD = process.env.E2E_BASE_URL ? (process.env.E2E_PASSWORD ?? '') : SEED_PASSWORD

export interface Player {
  id: string
  context: BrowserContext
  page: Page
  /** Closes the player's tabs the way a person does, then the context (`closeTabs`). */
  close(): Promise<void>
}

/**
 * Each player's session from their first sign-in. The server allows 30
 * sign-ins per address every 15 minutes, which a whole run of every lane's
 * tests would pass, so each player signs in once and later contexts reuse
 * the session, like a second tab. If a test logs it out, the next sign-in
 * notices and signs in again.
 */
const sessions = new Map<string, { id: string; cookies: Cookie[] }>()

/**
 * Keeps Netlify's review drawer off the page. Netlify adds it to every
 * deploy preview, and on a phone it covers the tab bar. `signIn` calls it,
 * so call it yourself only on a context that never signs in.
 */
export async function hideNetlifyDrawer(context: BrowserContext) {
  await context.route('**/.netlify/scripts/cdp', (route) => route.abort())
}

/**
 * Signs a context in and returns the player's id. `password` is for the test
 * accounts (TEST_PASSWORD); the sample players use PASSWORD.
 */
export async function signIn(
  context: BrowserContext,
  username: string,
  password = PASSWORD,
): Promise<string> {
  await hideNetlifyDrawer(context)
  const saved = sessions.get(username)
  if (saved) {
    await context.addCookies(saved.cookies)
    if ((await context.request.get('/api/me')).ok()) return saved.id
    await context.clearCookies()
  }
  const res = await context.request.post('/api/auth/login', {
    data: { username, password },
  })
  expect(res.ok(), await res.text()).toBe(true)
  const id = ((await res.json()) as { user: { id: string } }).user.id
  sessions.set(username, { id, cookies: await context.cookies() })
  return id
}

/** A player signed in with a page open. Close it with `player.close()`. */
export async function openAs(
  browser: Browser,
  username: string,
  password?: string,
): Promise<Player> {
  const context = await browser.newContext()
  const id = await signIn(context, username, password)
  return { id, context, page: await context.newPage(), close: () => closeTabs(context) }
}

/**
 * Closes a context's tabs the way a person closes a tab, so each page hears
 * beforeunload and the player leaves the online list at once, then closes
 * the context. Closing only the context drops the connection instead, and
 * on a preview Ably keeps the player online for 15 more seconds, which is
 * long enough to show up in the next test.
 */
export async function closeTabs(context: BrowserContext) {
  await Promise.all(
    context.pages().map(async (page) => {
      const closed = page.waitForEvent('close', { timeout: 5_000 }).catch(() => undefined)
      await page.close({ runBeforeUnload: true })
      await closed
    }),
  )
  await context.close()
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
