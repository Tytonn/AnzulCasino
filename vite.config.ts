import netlify from '@netlify/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

import { devApi } from './scripts/dev/dev-api.ts'
import { devDatabase } from './scripts/dev/dev-database.ts'
import { liveRelay } from './scripts/dev/live-relay.ts'

export default defineConfig(({ mode }) => {
  // Local dev only: hand .env values to the functions, which read
  // process.env. On Netlify they come from the project's environment variables.
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of ['DATABASE_URL', 'ADMIN_BOOTSTRAP_CODE', 'ABLY_API_KEY']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key]
  }

  return {
    plugins: [
      liveRelay(),
      devDatabase(),
      // Answers /api/* in-process; Netlify's emulation takes ~3 s a request.
      devApi(),
      react(),
      tailwindcss(),
      netlify({
        // With DATABASE_URL set, functions use that local Postgres instead of
        // Netlify's embedded one (see server/lib/db.ts).
        database: { enabled: !process.env.DATABASE_URL },
        // Features this site does not use.
        aiGateway: { enabled: false },
        blobs: { enabled: false },
        edgeFunctions: { enabled: false },
        geolocation: { enabled: false },
        images: { enabled: false },
        server: { enabled: false },
      }),
    ],
    server: { port: 8888, strictPort: true },
    build: { target: 'es2022', sourcemap: true },
  }
})
