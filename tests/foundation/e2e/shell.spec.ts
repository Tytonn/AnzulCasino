/**
 * The shell in real browsers, at 1440 and at 375 (Stage 1 exit check): two
 * players see each other online and where they are, chat both ways, and
 * open each other's cards. Screenshots land in tests/foundation/screenshots.
 */
import { expect, type Locator, type Page, test } from '@playwright/test'

import { onPhone, openAs, snap } from '../../e2e-helpers/players.ts'

/** The chat panel: in the sidebar on desktop, a sheet from the tab bar on a phone. */
async function openChat(page: Page, phone: boolean): Promise<Locator> {
  if (!phone) return page.getByRole('region', { name: 'Chat' })
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Chat' }).click()
  return page.getByRole('dialog', { name: 'Chat' })
}

/** Who is online: in the sidebar on desktop, under the leaderboard sheet on a phone. */
async function openOnline(page: Page, phone: boolean): Promise<Locator> {
  if (!phone) return page.getByRole('region', { name: 'Online' })
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Leaderboard' })
    .click()
  return page.getByRole('dialog', { name: 'Leaderboard' })
}

async function send(chat: Locator, text: string) {
  const box = chat.getByRole('textbox', { name: 'Message' })
  await box.fill(text)
  await box.press('Enter')
  await expect(box).toHaveValue('')
}

test('two players see each other online and chat', async ({ browser }, testInfo) => {
  const phone = onPhone(testInfo)
  const alice = await openAs(browser, 'alice')
  const bob = await openAs(browser, 'bob')
  const stamp = `${testInfo.project.name}-${Date.now().toString(36)}`

  await test.step('Bob walks into a room, Alice stays on the Floor', async () => {
    await bob.page.goto('/room/coinflip')
    await alice.page.goto('/')
    await expect(alice.page.getByRole('heading', { level: 1, name: 'The Floor' })).toBeVisible()
    await expect(alice.page).toHaveTitle('The Floor · Anzul Casino')
    // The room card counts who is inside.
    await expect(
      alice.page.getByRole('main').getByRole('link', { name: /Coin flip/ }),
    ).toContainText('1 inside')
  })

  await test.step('Alice sees Bob online, in his room, and opens his card', async () => {
    const online = await openOnline(alice.page, phone)
    const row = online
      .getByRole('listitem')
      .filter({ has: alice.page.getByRole('link', { name: 'Coin flip' }) })
    await expect(row.getByRole('button', { name: 'Bob, here' })).toBeVisible()
    await expect(online.getByRole('button', { name: 'Alice, here' })).toBeVisible()
    await snap(alice.page, 'foundation', 'shell-online', testInfo)

    await row.getByRole('button', { name: 'Bob, here' }).click()
    const card = alice.page.getByRole('dialog', { name: 'Player' })
    await expect(card).toContainText('@bob')
    await expect(card).toContainText('Online in Coin flip')
    await snap(alice.page, 'foundation', 'shell-profile', testInfo)
    await card.getByRole('button', { name: 'Close' }).click()
    await expect(card).toBeHidden()
    if (phone) {
      await alice.page
        .getByRole('dialog', { name: 'Leaderboard' })
        .getByRole('button', { name: 'Close' })
        .click()
    }
  })

  await test.step('they chat both ways, and Bob sees that Alice mentioned him', async () => {
    const aliceChat = await openChat(alice.page, phone)
    const hello = `hi @bob, ready to lose? ${stamp}`
    await send(aliceChat, hello)
    await expect(aliceChat.getByText(hello)).toBeVisible()

    const bobChat = await openChat(bob.page, phone)
    const heard = bobChat.getByRole('listitem').filter({ hasText: hello })
    await expect(heard).toBeVisible()
    await expect(heard).toContainText('Mentions you:')

    const reply = `never 🎲 ${stamp}`
    await send(bobChat, reply)
    await expect(aliceChat.getByText(reply)).toBeVisible()
    await snap(bob.page, 'foundation', 'shell-chat', testInfo)
  })

  await test.step('a closed tab drops out of the online list', async () => {
    await bob.close()
    if (phone) {
      await alice.page
        .getByRole('dialog', { name: 'Chat' })
        .getByRole('button', { name: 'Close' })
        .click()
    }
    const online = await openOnline(alice.page, phone)
    await expect(online.getByRole('button', { name: 'Bob, here' })).toBeHidden()
    await expect(
      alice.page.getByRole('main').getByRole('link', { name: /Coin flip/ }),
    ).toContainText('Nobody inside')
  })

  await alice.close()
})

test('the Floor, a room and the setup page at both sizes', async ({ browser }, testInfo) => {
  const admin = await openAs(browser, 'admin')
  const { page } = admin

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'The Floor' })).toBeVisible()
  await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(9)
  await snap(page, 'foundation', 'shell-floor', testInfo)

  // A game that is not built yet shows its placeholder, with the shell around it.
  // Lanes replace placeholders as they merge, so open the first room the Floor
  // still marks Soon. Once every game is built there is none left to check.
  const unbuilt = page
    .getByRole('main')
    .getByRole('link')
    .filter({ has: page.getByText('Soon', { exact: true }) })
  if ((await unbuilt.count()) > 0) {
    const card = unbuilt.first()
    const name = await card.getByRole('heading', { level: 2 }).innerText()
    await card.click()
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
    await expect(page.getByText(/Opening soon/)).toBeVisible()
    await snap(page, 'foundation', 'shell-room', testInfo)
  }

  // Admins reach setup from the account menu.
  await page.getByRole('button', { name: 'Your account' }).click()
  await page.getByRole('menuitem', { name: /Setup/ }).click()
  await expect(page).toHaveURL(/\/setup$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Setup' })).toBeVisible()
  await expect(page.locator('.skeleton')).toHaveCount(0)
  await snap(page, 'foundation', 'shell-setup', testInfo)

  // An unknown address gets a friendly page, not a blank one.
  await page.goto('/nowhere')
  await expect(page.getByRole('link', { name: /Floor/ }).first()).toBeVisible()

  await admin.close()
})

/** Whether the top bar's row cuts a widget off at its edges, and whether those edges fade. */
function widgetRow(row: Locator) {
  return row.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const widgets = [...(el.querySelector('[data-top-bar-content]')?.children ?? [])]
    const cut = widgets.some((widget) => {
      const edge = widget.getBoundingClientRect()
      return edge.left < box.left - 1 || edge.right > box.right + 1
    })
    return { cut, faded: getComputedStyle(el).maskImage !== 'none' }
  })
}

test('the top bar keeps every widget in view, or fades the edge it scrolls past', async ({
  browser,
}, testInfo) => {
  const alice = await openAs(browser, 'alice')
  const { page } = alice
  const phone = onPhone(testInfo)

  await page.goto('/')
  const row = page.getByRole('banner').locator('[data-slot="top-bar"]')
  await expect(row.locator('[data-top-bar-content] > *').first()).toBeVisible()
  await expect(row.locator('.skeleton')).toHaveCount(0)

  // On desktop the widgets sit beside the wallet while they fit there, and on a
  // second line under it when they do not, so none is ever cut off. A phone's
  // row may still scroll, but then it fades the edge that widgets are behind.
  for (const width of phone ? [375, 320] : [1440, 1280, 1100, 900]) {
    await page.setViewportSize({ width, height: phone ? 812 : 900 })
    await expect
      .poll(async () => {
        const { cut, faded } = await widgetRow(row)
        return phone ? !cut || faded : !cut
      })
      .toBe(true)
    if (width === (phone ? 375 : 1280)) await snap(page, 'foundation', 'top-bar', testInfo)
  }

  await alice.close()
})
