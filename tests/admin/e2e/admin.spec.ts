/**
 * The admin panel and the Audit page in real browsers, at 1440 and 375
 * (spec: Admin panel; Admin and trust > The audit page). The admin gives a
 * player a chip and takes it back, gives one away, flips a setting and puts
 * it back, makes an invite code and looks at ending the season, while
 * another player watches each action reach the Audit page live.
 * Screenshots land in tests/admin/screenshots.
 *
 * Each test leaves the chips and settings as it found them, so the tests
 * run again and again on a deploy preview. They never end or schedule a
 * season, disable a player or make a reset code.
 */
import { randomUUID } from 'node:crypto'

import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test'

import { formatChips } from '../../../shared/chips.ts'
import type { AdminConfigState, AdminPlayersResponse } from '../../../shared/features/admin.ts'
import { onPhone, openAs, snap } from '../../e2e-helpers/players.ts'

/** A line that tells this run's actions apart from earlier runs on a preview. */
function stampFor(project: string): string {
  return `${project} ${Date.now().toString(36)}`
}

async function players(request: APIRequestContext) {
  const res = await request.get('/api/admin/players')
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()) as AdminPlayersResponse).players
}

async function walletOf(request: APIRequestContext, username: string): Promise<number> {
  const player = (await players(request)).find((p) => p.username === username)
  expect(player?.wallet, `${username} has chips this season`).toBeTruthy()
  return player?.wallet?.balance ?? 0
}

/** The Audit page itself, apart from chat, which shows the same posts. */
function auditLog(page: Page): Locator {
  return page.getByRole('region', { name: 'Audit log' })
}

/** An Audit page entry, found by the reason or note it shows. */
function auditEntry(page: Page, text: string): Locator {
  return auditLog(page).getByRole('listitem').filter({ hasText: text })
}

async function openAudit(page: Page) {
  await page.goto('/audit')
  await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Everything' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
}

async function openTab(page: Page, tab: string) {
  await page.goto(tab === 'players' ? '/admin' : `/admin?tab=${tab}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible()
  await expect(page.getByRole('tab', { selected: true })).toContainText(new RegExp(tab, 'i'))
}

test('an admin gives a player a chip and takes it back, in public', async ({
  browser,
}, testInfo) => {
  const admin = await openAs(browser, 'admin')
  const watcher = await openAs(browser, 'carol')
  const stamp = stampFor(testInfo.project.name)
  const start = await walletOf(admin.context.request, 'alice')

  await openAudit(watcher.page)
  await openTab(admin.page, 'players')
  const row = admin.page.getByRole('listitem').filter({ hasText: '@alice' })
  await expect(row).toContainText(`${formatChips(start)} wallet`)

  await test.step('the dialog shows the chat post before anything moves', async () => {
    await row.getByRole('button', { name: 'Adjust chips' }).click()
    const dialog = admin.page.getByRole('dialog', { name: 'Adjust Alice’s chips' })
    await expect(dialog.getByRole('radio', { name: 'Add' })).toBeChecked()
    await expect(dialog.getByRole('radio', { name: 'Wallet' })).toBeChecked()
    await dialog.getByLabel('Chips', { exact: true }).fill('1')
    // No reason yet, so nothing can be saved.
    await expect(dialog.getByRole('button', { name: 'Add 1 chip' })).toBeDisabled()
    await dialog.getByLabel('Reason', { exact: true }).fill(`Browser test, ${stamp}: one chip`)
    await expect(dialog).toContainText(
      `🧾 Admin added 1 chip to Alice's wallet: Browser test, ${stamp}: one chip`,
    )
    await expect(dialog).toContainText('Alice also gets a note:')
    await snap(admin.page, 'admin', 'adjust-dialog', testInfo)

    await dialog.getByRole('button', { name: 'Add 1 chip' }).click()
    await expect(admin.page.getByText('Added 1 chip to Alice’s wallet.')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(row).toContainText(`${formatChips(start + 100)} wallet`)
  })

  await test.step('another player sees it on the Audit page without reloading', async () => {
    const entry = auditEntry(watcher.page, `Browser test, ${stamp}: one chip`)
    await expect(entry).toContainText('Admin added 1 chip to Alice’s wallet')
    await expect(entry).toContainText(`Wallet: ${formatChips(start)} → ${formatChips(start + 100)}`)
    await snap(watcher.page, 'admin', 'audit-live', testInfo)
  })

  await test.step('taking more than the wallet holds is caught before it is sent', async () => {
    await row.getByRole('button', { name: 'Adjust chips' }).click()
    const dialog = admin.page.getByRole('dialog', { name: 'Adjust Alice’s chips' })
    await dialog.getByRole('radio', { name: 'Take' }).click()
    await dialog.getByLabel('Chips', { exact: true }).fill(String(start / 100 + 2))
    await expect(dialog.getByRole('alert')).toContainText('Alice has only')
    await dialog.getByLabel('Chips', { exact: true }).fill('1')
    await expect(dialog.getByRole('alert')).toBeHidden()
    await dialog
      .getByLabel('Reason', { exact: true })
      .fill(`Browser test, ${stamp}: taking it back`)
    await dialog.getByRole('button', { name: 'Take 1 chip' }).click()
    await expect(admin.page.getByText('Took 1 chip from Alice’s wallet.')).toBeVisible()
    await expect(row).toContainText(`${formatChips(start)} wallet`)
  })

  await test.step('the Chips filter shows both, newest first', async () => {
    await watcher.page.getByRole('tab', { name: 'Chips' }).click()
    const back = auditEntry(watcher.page, `Browser test, ${stamp}: taking it back`)
    await expect(back).toContainText('Admin took 1 chip from Alice’s wallet')
    const entries = auditEntry(watcher.page, stamp)
    await expect(entries).toHaveCount(2)
    await expect(entries.first()).toContainText('taking it back')
  })

  expect(await walletOf(admin.context.request, 'alice')).toBe(start)
  await admin.close()
  await watcher.close()
})

test('a giveaway reaches the player it names', async ({ browser }, testInfo) => {
  const phone = onPhone(testInfo)
  const admin = await openAs(browser, 'admin')
  const bob = await openAs(browser, 'bob')
  const stamp = stampFor(testInfo.project.name)
  const start = await walletOf(admin.context.request, 'bob')
  const bobId = bob.id

  await bob.page.goto('/')
  await openTab(admin.page, 'giveaway')
  const page = admin.page

  await test.step('pick Bob, one chip each, with a note', async () => {
    await page.getByRole('radio', { name: 'Pick players' }).click()
    await page.getByRole('checkbox', { name: /Bob/ }).check()
    await expect(page.getByText('1 picked')).toBeVisible()
    await page.getByLabel('Chips each', { exact: true }).fill('1')
    await page.getByLabel('Note', { exact: true }).fill(`Browser test, ${stamp}`)
    const summary = page.getByRole('region', { name: 'Summary' })
    await expect(summary).toContainText(`🎁 Admin gave Bob 1 chip: Browser test, ${stamp}`)
    if (phone) await summary.scrollIntoViewIfNeeded()
    await snap(page, 'admin', 'giveaway', testInfo)
  })

  await test.step('it asks once more, then gives', async () => {
    await page.getByRole('button', { name: 'Give 1 chip' }).click()
    const confirm = page.getByRole('dialog', { name: 'Give these chips?' })
    await expect(confirm).toContainText('Bob gets 1 chip.')
    await confirm.getByRole('button', { name: 'Give 1 chip' }).click()
    await expect(page.getByText('Gave 1 chip to 1 player.')).toBeVisible()
    await expect(confirm).toBeHidden()
  })

  await test.step('Bob gets a note at once', async () => {
    await expect(
      bob.page.getByText(`🎁 Admin gave you 1 chip: Browser test, ${stamp}`),
    ).toBeVisible()
  })

  // Put the chip back, so the next run starts from the same chips.
  const back = await admin.context.request.post('/api/admin/chips', {
    data: {
      userId: bobId,
      amount: -100,
      account: 'wallet',
      reason: `Browser test, ${stamp}: taking back the test giveaway`,
    },
    headers: { 'idempotency-key': randomUUID() },
  })
  expect(back.ok(), await back.text()).toBe(true)
  expect(await walletOf(admin.context.request, 'bob')).toBe(start)
  await admin.close()
  await bob.close()
})

test('a setting is flipped, shown on the Audit page, and put back', async ({
  browser,
}, testInfo) => {
  const admin = await openAs(browser, 'admin')
  const watcher = await openAs(browser, 'carol')
  const stamp = stampFor(testInfo.project.name)
  const page = admin.page

  const res = await admin.context.request.get('/api/admin/config')
  const state = (await res.json()) as AdminConfigState
  const was = state.values.stream_round_runs
  const options = { fold: 'Fold into one line', separate: 'One line per round' } as const
  const to = was === 'fold' ? 'separate' : 'fold'

  await openAudit(watcher.page)
  await openTab(page, 'settings')
  const bar = page.getByText(/^1 unsaved change/)
  const save = page.getByRole('button', { name: /^Save/ })

  await test.step('a word another command has is flagged before saving', async () => {
    await page.getByRole('searchbox', { name: 'Find a setting' }).fill('roulette')
    const roulette = page.locator('#setting-command_roulette')
    await roulette.getByRole('textbox').fill('bj')
    await roulette.getByRole('textbox').press('Enter')
    await expect(roulette.getByRole('alert')).toHaveText('"bj" already belongs to Blackjack.')
    await expect(page.getByRole('button', { name: '· 1 to fix' })).toBeVisible()
    await expect(save).toBeDisabled()
    await roulette.getByRole('button', { name: 'Undo' }).click()
    await expect(bar).toBeHidden()
  })

  await test.step('flip how finished rounds show', async () => {
    await page.getByRole('searchbox', { name: 'Find a setting' }).fill('finished')
    const row = page.locator('#setting-stream_round_runs')
    await row.getByRole('radio', { name: options[to] }).click()
    await expect(row.getByText('Unsaved')).toBeVisible()
    await expect(bar).toBeVisible()
    await snap(page, 'admin', 'settings-unsaved', testInfo)
  })

  await test.step('leaving with it unsaved asks first', async () => {
    await page.getByRole('link', { name: 'Audit log' }).click()
    const leave = page.getByRole('dialog', { name: 'Leave without saving?' })
    await expect(leave).toContainText('You changed a setting and have not saved it.')
    await leave.getByRole('button', { name: 'Keep editing' }).click()
    await expect(leave).toBeHidden()
    await expect(page).toHaveURL(/tab=settings/)
  })

  await test.step('save it with a reason, and everyone sees it', async () => {
    await page.getByLabel('Why (optional, shown on the Audit page)').fill(`Browser test, ${stamp}`)
    await save.click()
    await expect(page.getByText('Saved 1 setting.')).toBeVisible()
    await expect(bar).toBeHidden()
    const entry = auditEntry(watcher.page, `Browser test, ${stamp}`)
    await expect(entry).toContainText(
      `Admin changed Finished rounds from ${options[was === 'fold' ? 'fold' : 'separate']} to ${options[to]}`,
    )
  })

  await test.step('put it back', async () => {
    const row = page.locator('#setting-stream_round_runs')
    await row.getByRole('radio', { name: options[was === 'fold' ? 'fold' : 'separate'] }).click()
    await page
      .getByLabel('Why (optional, shown on the Audit page)')
      .fill(`Browser test, ${stamp}: back`)
    await page.keyboard.press('ControlOrMeta+s')
    await expect(page.getByText('Saved 1 setting.').first()).toBeVisible()
    await expect(auditEntry(watcher.page, `Browser test, ${stamp}: back`)).toBeVisible()
  })

  const after = (await (
    await admin.context.request.get('/api/admin/config')
  ).json()) as AdminConfigState
  expect(after.values.stream_round_runs).toBe(was)
  await admin.close()
  await watcher.close()
})

test('an invite code is made and its message copied', async ({ browser }, testInfo) => {
  const admin = await openAs(browser, 'admin')
  await admin.context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const page = admin.page
  await openTab(page, 'codes')

  await page.getByRole('button', { name: 'New invite code' }).click()
  const made = page.getByRole('button', { name: 'Copy invite message' })
  await expect(made).toBeVisible()
  const code = (await page.locator('code').first().textContent())?.trim() ?? ''
  expect(code).toMatch(/^[A-Z0-9-]{6,}$/)
  await expect(page.getByRole('radio', { name: /^Not used \(\d+\)$/ })).toBeChecked()
  await expect(page.getByRole('listitem').filter({ hasText: code })).toContainText('Made just now')
  await snap(page, 'admin', 'codes', testInfo)

  await made.click()
  await expect(page.getByText('Invite message copied.')).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain(`/signup with the invite code ${code}.`)
  await admin.close()
})

test('ending the season early shows what it will post, and waits for a yes', async ({
  browser,
}, testInfo) => {
  const admin = await openAs(browser, 'admin')
  const page = admin.page
  await openTab(page, 'seasons')

  const running = page.getByRole('listitem').filter({ hasText: /Running|Final day/ })
  await expect(running).toHaveCount(1)
  const name = (await running.locator('span.font-semibold').first().textContent()) ?? ''
  await running.getByRole('button', { name: 'End early' }).click()
  const dialog = page.getByRole('dialog', { name: `End ${name} early` })
  await expect(dialog.getByRole('radio', { name: 'End now' })).toBeChecked()
  await expect(dialog).toContainText(`🛑 Admin ended ${name} early`)
  await expect(dialog).toContainText('This cannot be undone')
  await expect(dialog.getByRole('button', { name: `End ${name} now` })).toBeEnabled()
  await snap(page, 'admin', 'end-season', testInfo)

  // Never press it: Cancel leaves the season running.
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await expect(running).toContainText(/Running|Final day/)
  await admin.close()
})

test('players can read the Audit page but not open the admin panel', async ({
  browser,
}, testInfo) => {
  const carol = await openAs(browser, 'carol')
  await carol.page.goto('/admin')
  await expect(carol.page.getByRole('heading', { level: 1, name: 'Admins only' })).toBeVisible()

  await openAudit(carol.page)
  // The earlier tests' actions, or at least the season the sample data scheduled.
  await expect(auditLog(carol.page).locator('time').first()).toBeVisible()
  await snap(carol.page, 'admin', 'audit', testInfo)
  const res = await carol.context.request.get('/api/admin/players')
  expect(res.status()).toBe(403)
  await carol.close()
})
