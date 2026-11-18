/**
 * Keeps the local dev database migrated during `npm run dev`.
 *
 * Uses DATABASE_URL (a local Postgres) when it is set, otherwise the embedded
 * database that Netlify's Vite plugin starts. Applies pending migrations on
 * start and whenever a new migration appears. Local only: scripts/db/local.ts
 * refuses any database that is not on this machine.
 */
import type { Plugin } from 'vite'

import { MIGRATIONS_DIR, migrate } from '../db/local.ts'

export function devDatabase(): Plugin {
  let running: Promise<void> = Promise.resolve()

  const run = () => {
    running = running.then(async () => {
      const url = process.env.DATABASE_URL || process.env.NETLIFY_DB_URL
      if (!url) {
        console.warn('[db] No local database yet, so no migrations were applied.')
        return
      }
      try {
        const applied = await migrate(url)
        if (applied.length) console.info(`[db] Applied migrations: ${applied.join(', ')}`)
      } catch (error) {
        console.error(`[db] Migrations failed: ${String(error)}`)
      }
    })
    return running
  }

  return {
    name: 'anzul-dev-database',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => void run())
      let timer: ReturnType<typeof setTimeout> | undefined
      server.watcher.add(MIGRATIONS_DIR)
      server.watcher.on('add', (file) => {
        if (!file.startsWith(MIGRATIONS_DIR) || !file.endsWith('.sql')) return
        clearTimeout(timer)
        timer = setTimeout(() => void run(), 300)
      })
    },
  }
}
