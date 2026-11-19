/**
 * The end of a season in real browsers, at 1440 and 375: the final-day
 * banner and countdown, and the Hall of Fame with a finished season's
 * podium and standings. Screenshots land in tests/economy/screenshots.
 *
 * The final day is shown by moving the page's clock forward, so the real
 * season is untouched. Locally and in CI the test writes a finished season
 * to the database first and removes it after; on a deploy preview it checks
 * whatever the Hall of Fame holds, empty or not.
 */
import { expect, type Locator, test } from '@playwright/test'
import pg from 'pg'

import type { HallOfFame } from '../../../shared/features/season.ts'
import type { SeasonState } from '../../../shared/seasons.ts'
import { onPhone, openAs, snap } from '../../e2e-helpers/players.ts'

const HOUR = 3_600_000

/**
 * Waits until nothing in the podium has moved for a moment: the blocks have
 * risen and the crown has landed. A fixed wait is not enough on a busy
 * machine, where the rise starts late, and the picture would catch it halfway.
 */
async function podiumRisen(podium: Locator): Promise<void> {
  const boxes = () =>
    podium.evaluate((list) =>
      [...list.querySelectorAll('*')]
        .map((node) => {
          const box = node.getBoundingClientRect()
          return `${box.x.toFixed(1)},${box.y.toFixed(1)},${box.width.toFixed(1)},${box.height.toFixed(1)}`
        })
        .join(' '),
    )
  await expect
    .poll(
      async () => {
        const before = await boxes()
        await new Promise((resolve) => setTimeout(resolve, 400))
        return before === (await boxes())
      },
      { message: 'The podium is still moving.', timeout: 15_000 },
    )
    .toBe(true)
}

test('the final day shows a banner and a countdown, and the end says so', async ({
  browser,
}, testInfo) => {
  const player = await openAs(browser, onPhone(testInfo) ? 'bob' : 'carol')
  const { page } = player
  // The page sets its clock against the server's as it loads: let that finish
  // before moving the clock, or the offset it measures spans the jump.
  const synced = page.waitForResponse((r) => r.url().endsWith('/api/time'))
  await page.goto('/')
  await synced
  await expect(page.getByRole('button', { name: /^Daily: / })).toBeVisible()
  const { current } = (await (await page.request.get('/api/season')).json()) as SeasonState
  expect(current?.phase).toBe('open')
  if (!current) return
  const endsAt = Date.parse(current.endsAt)

  // Nothing shows while the season runs.
  await expect(page.getByRole('region', { name: 'Final day' })).toHaveCount(0)

  await test.step('five hours before the end', async () => {
    await page.clock.setFixedTime(endsAt - 5 * HOUR)
    const banner = page.getByRole('region', { name: 'Final day' })
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('Final day')
    await expect(banner.getByRole('timer')).toHaveText(/^(4:59:5\d|5:00:0\d)$/)
    await expect(banner).toContainText('Steals, shields, vault moves and rank purchases are off.')
    await snap(page, 'economy', 'final-day', testInfo)
  })

  await test.step('in the last hour', async () => {
    await page.clock.setFixedTime(endsAt - 20 * 60_000)
    await expect(page.getByRole('region', { name: 'Final day' })).toContainText('Final hour')
  })

  await test.step('at the end', async () => {
    await page.clock.setFixedTime(endsAt + 10_000)
    await expect(page.getByRole('region', { name: 'Final day' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Season over' })).toContainText(
      `${current.name} is over.`,
    )
  })

  await player.close()
})

// ---------------------------------------------------------------- the Hall of Fame

const PAST = 'Hall of Fame test season'

/** Final standings for a finished season, best first: [username, tier, net worth]. */
const STANDINGS = [
  ['bob', 'gold', 18_452_000],
  ['alice', 'silver', 12_904_050],
  ['carol', 'bronze', 9_850_000],
  ['admin', 'base', 125_000],
] as const

/** Writes a finished season with frozen standings, as the end of a season does. */
async function addFinishedSeason(db: pg.Client): Promise<void> {
  await db.query('begin')
  const [season] = (
    await db.query<{ id: number }>(
      `insert into seasons (name, starts_at, ends_at, starting_balance, status)
       values ($1, now() - interval '70 days', now() - interval '40 days', 10000, 'ended')
       returning id`,
      [PAST],
    )
  ).rows
  if (!season) throw new Error('The season was not saved.')
  for (const [rank, [username, tier, netWorth]] of STANDINGS.entries()) {
    await db.query(
      `insert into wallets (season_id, user_id, tier)
       select $1, id, $3 from users where username = $2`,
      [season.id, username, tier],
    )
    await db.query(
      `insert into season_results (season_id, user_id, final_rank, final_net_worth, created_at)
       select $1, id, $3, $4, now() - interval '40 days' from users where username = $2`,
      [season.id, username, rank + 1, netWorth],
    )
  }
  await db.query('commit')
}

async function removeFinishedSeason(db: pg.Client): Promise<void> {
  const where = 'season_id in (select id from seasons where name = $1)'
  await db.query(`delete from season_results where ${where}`, [PAST])
  await db.query(`delete from wallets where ${where}`, [PAST])
  await db.query('delete from seasons where name = $1', [PAST])
}

test('the Hall of Fame keeps each finished season, with its podium and standings', async ({
  browser,
}, testInfo) => {
  const local = !process.env.E2E_BASE_URL
  const db = local ? new pg.Client({ connectionString: process.env.E2E_DATABASE_URL }) : null
  if (db) {
    await db.connect()
    await removeFinishedSeason(db)
    await addFinishedSeason(db)
  }
  const player = await openAs(browser, 'alice')
  const { page } = player
  try {
    await page.goto('/hall-of-fame')
    await expect(page).toHaveTitle('Hall of Fame · Anzul Casino')
    await expect(page.getByRole('heading', { level: 1, name: 'Hall of Fame' })).toBeVisible()

    const fame = (await (await page.request.get('/api/economy/hall-of-fame')).json()) as HallOfFame
    const latest = fame.seasons[0]
    if (!latest) {
      await expect(page.getByText('No season has finished yet')).toBeVisible()
      await snap(page, 'economy', 'hall-of-fame-empty', testInfo)
      return
    }
    if (local) expect(latest.name).toBe(PAST)

    const card = page.getByRole('article', { name: latest.name })
    const podium = card.getByRole('list', { name: 'Podium' })
    await expect(podium.getByRole('listitem')).toHaveCount(Math.min(3, latest.places.length))
    for (const place of latest.places) await expect(card).toContainText(place.displayName)
    if (local) {
      await expect(podium.getByRole('listitem').first()).toHaveAccessibleName('1st: Bob, 184,520')
      // The viewer's own row is marked.
      await expect(card.locator('[aria-current="true"]')).toContainText('Alice')
      await expect(card).toContainText('You finished 2nd')
    }
    await podiumRisen(podium)
    await snap(page, 'economy', 'hall-of-fame', testInfo)

    await card.getByRole('button', { name: `Replay the podium for ${latest.name}` }).click()
    const screen = page.getByRole('dialog').filter({ has: page.getByText('Final standings') })
    await expect(screen).toBeVisible()
    if (local) await expect(screen).toContainText(`Bob wins ${PAST}`)
    await podiumRisen(screen.getByRole('list', { name: 'Podium' }))
    await snap(page, 'economy', 'podium', testInfo)
    await page.keyboard.press('Escape')
    await expect(screen).toBeHidden()
  } finally {
    await player.close()
    if (db) {
      await removeFinishedSeason(db)
      await db.end()
    }
  }
})
