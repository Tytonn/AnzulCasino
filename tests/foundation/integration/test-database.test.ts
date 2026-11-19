import { expect, it } from 'vitest'

import { useTestDatabase } from '../../helpers/db.ts'

const db = await useTestDatabase()

it('gets its own database copied from the migrated template', async () => {
  const [row] = await db.query<{ name: string }>('SELECT current_database() AS name')
  expect(row?.name).toMatch(/^casino_test_[0-9a-f]{8}$/)
  const tracking = await db.query("SELECT to_regclass('netlify.migrations') AS t")
  expect(tracking[0]?.t).toBe('netlify.migrations')
})
