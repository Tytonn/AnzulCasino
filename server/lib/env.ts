/**
 * Server environment variables. Secrets live in Netlify's environment
 * variables (and a local .env for development), never in the repo or the
 * browser bundle.
 */
type Name =
  | 'ADMIN_BOOTSTRAP_CODE'
  | 'ABLY_API_KEY'
  | 'LIVE_RELAY_URL'
  | 'LIVE_RELAY_SECRET'
  // GIFs in chat (social lane). Server only: search goes through the API.
  | 'KLIPY_API_KEY'

declare const Netlify: { env: { get(name: string): string | undefined } } | undefined

export function env(name: Name): string | undefined {
  const fromNetlify = typeof Netlify === 'undefined' ? undefined : Netlify.env.get(name)
  const value = fromNetlify ?? process.env[name]
  return value ? value : undefined
}
