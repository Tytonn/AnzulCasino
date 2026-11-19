/**
 * The live layer in real browsers, before the shell uses it: two players see
 * each other online, hear the server's news, and see each other leave. It
 * loads the live client straight from the dev server's source.
 */
import { expect, type Page, test } from '@playwright/test'

import { signIn } from '../../e2e-helpers/players.ts'

interface LiveWindow {
  live: {
    online: readonly { userId: string; room: string | null; status: string }[]
    status: string
    setRoom(room: string | null): void
    stop(): void
  }
  heard: unknown[]
  resyncs: number
}

/**
 * Starts a live client in the page, in the given room, listening to the feed.
 * The page is a blank one on the site's address, so the shell's own live
 * client does not start beside the test's.
 */
async function startLive(page: Page, room: string) {
  await page.route('/live-test', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Live test</title>' }),
  )
  await page.goto('/live-test')
  await page.evaluate(async (inRoom) => {
    const source = '/src/live/browser.ts'
    const { createBrowserLiveClient } = (await import(/* @vite-ignore */ source)) as {
      createBrowserLiveClient(): LiveWindow['live'] & {
        start(): void
        on(channel: string, name: string, handler: (data: unknown) => void): () => void
        onResync(handler: () => void): () => void
      }
    }
    const client = createBrowserLiveClient()
    const win = window as unknown as LiveWindow
    win.live = client
    win.heard = []
    win.resyncs = 0
    client.on('feed', 'season.state', (data) => win.heard.push(data))
    client.onResync(() => win.resyncs++)
    client.setRoom(inRoom)
    client.start()
  }, room)
}

const online = (page: Page) =>
  page.evaluate(() => (window as unknown as LiveWindow).live.online.map((p) => ({ ...p })))

test('two players see each other online, hear the news, and see each other leave', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'No layout here; once at desktop size is enough.')
  test.skip(
    !!process.env.E2E_BASE_URL,
    'Loads the live client from the dev server; shell.spec.ts covers previews.',
  )

  const aliceContext = await browser.newContext()
  const bobContext = await browser.newContext()
  const adminContext = await browser.newContext()
  const aliceId = await signIn(aliceContext, 'alice')
  const bobId = await signIn(bobContext, 'bob')
  await signIn(adminContext, 'admin')

  const alice = await aliceContext.newPage()
  const bob = await bobContext.newPage()
  await startLive(alice, 'coinflip')
  await startLive(bob, 'blackjack')

  // Each sees the other, in the right room.
  await expect
    .poll(async () => (await online(alice)).find((p) => p.userId === bobId))
    .toMatchObject({ room: 'blackjack', status: 'active' })
  await expect
    .poll(async () => (await online(bob)).find((p) => p.userId === aliceId))
    .toMatchObject({ room: 'coinflip', status: 'active' })
  await expect.poll(() => alice.evaluate(() => (window as unknown as LiveWindow).resyncs)).toBe(1)

  // A room change shows up on the other screen.
  await bob.evaluate(() => (window as unknown as LiveWindow).live.setRoom('mines'))
  await expect
    .poll(async () => (await online(alice)).find((p) => p.userId === bobId)?.room)
    .toBe('mines')

  // The server's news reaches both: the admin schedules a season.
  const startsAt = Date.now() + 400 * 86_400_000
  const created = await adminContext.request.post('/api/seasons', {
    headers: { 'idempotency-key': `e2e-live-${Date.now()}` },
    data: {
      name: 'Live check',
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + 30 * 86_400_000).toISOString(),
    },
  })
  expect(created.ok(), await created.text()).toBe(true)
  const seasonId = ((await created.json()) as { season: { id: number } }).season.id
  for (const page of [alice, bob]) {
    await expect
      .poll(() => page.evaluate(() => (window as unknown as LiveWindow).heard))
      .toContainEqual({ seasonId, phase: 'upcoming' })
  }

  // Closing a tab takes that player out of presence.
  await bob.close()
  await expect.poll(async () => (await online(alice)).some((p) => p.userId === bobId)).toBe(false)

  await aliceContext.close()
  await bobContext.close()
  await adminContext.close()
})
