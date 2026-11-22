import { eq, sql } from 'drizzle-orm'
import { expect, it } from 'vitest'

import { seasons } from '../../../db/schema/core.ts'
import { db, rows } from '../../../server/lib/db.ts'
import { useTestDatabase } from '../../helpers/db.ts'

await useTestDatabase()

it('reads and writes through Drizzle with chips as bigint', async () => {
  const [created] = await db()
    .insert(seasons)
    .values({
      name: 'Season 2',
      startsAt: new Date('2026-12-01T10:00:00Z'),
      endsAt: new Date('2026-12-31T10:00:00Z'),
      startingBalance: 100n,
    })
    .returning()
  expect(created?.startingBalance).toBe(100n)
  expect(created?.startsAt).toEqual(new Date('2026-12-01T10:00:00Z'))

  const [found] = await db().select().from(seasons).where(eq(seasons.id, created!.id))
  expect(found?.name).toBe('Season 2')
})

it('runs raw SQL and transactions', async () => {
  const [row] = await rows<{ answer: number }>(db(), sql`select 6 * 7 as answer`)
  expect(row?.answer).toBe(42)

  await expect(
    db().transaction(async (tx) => {
      await tx.insert(seasons).values({
        name: 'Rolled back',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 1000),
        startingBalance: 1n,
      })
      throw new Error('stop')
    }),
  ).rejects.toThrow('stop')
  const left = await db().select().from(seasons).where(eq(seasons.name, 'Rolled back'))
  expect(left).toHaveLength(0)
})
