import { defineConfig } from 'drizzle-kit'

// Drizzle Kit only generates SQL files here. Netlify applies them on every
// deploy preview and production deploy. Never run drizzle-kit push or migrate
// against a Netlify-hosted database (see .claude/skills/netlify-database).
export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema/*.ts',
  out: 'netlify/database/migrations',
})
