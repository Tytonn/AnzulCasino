/**
 * Local development and browser tests only: answers /api/* inside the Vite
 * dev server by calling the same function handlers Netlify runs. They load
 * through Vite, so a code change applies on the next request.
 *
 * Why: Netlify's local emulation (@netlify/vite-plugin 3) rebuilds and
 * cold-starts a function for every request, about 3 seconds each, which
 * hides how fast the site is and makes every click slow. Deploy previews and
 * production always run the real Netlify runtime, so test there before
 * calling anything done.
 *
 * Set NETLIFY_FUNCTIONS=emulate to use Netlify's emulation instead.
 *
 * Each function file in netlify/functions/ exports its handler as default
 * and its paths in `config.path`, as Netlify reads them. Paths may end in
 * `/*` or hold `:name` segments.
 */
import { readdirSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import type { Context } from '@netlify/functions'
import type { Plugin, ViteDevServer } from 'vite'

type Handler = (req: Request, context: Context) => Promise<Response>

interface FunctionModule {
  default?: Handler
  config?: { path?: string | string[] }
}

const FUNCTIONS_DIR = join(import.meta.dirname, '..', '..', 'netlify', 'functions')

/** A Netlify function path as a regular expression. */
export function pathPattern(path: string): RegExp {
  const pattern = path
    .split('/')
    .map((segment) => {
      if (segment === '*') return '.*'
      if (segment.startsWith(':')) return '[^/]+'
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  return new RegExp(`^${pattern}/?$`)
}

async function loadFunctions(server: ViteDevServer) {
  const found: { name: string; handler: Handler; patterns: RegExp[] }[] = []
  for (const file of readdirSync(FUNCTIONS_DIR)) {
    if (!/\.(ts|mts|js|mjs)$/.test(file)) continue
    const mod = (await server.ssrLoadModule(join(FUNCTIONS_DIR, file))) as FunctionModule
    const paths = mod.config?.path
    if (!mod.default || !paths) continue
    const list = Array.isArray(paths) ? paths : [paths]
    found.push({ name: file, handler: mod.default, patterns: list.map(pathPattern) })
  }
  return found
}

function toRequest(req: IncomingMessage): Request {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v)
    else if (value !== undefined) headers.set(key, value)
  }
  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    // Node's fetch needs this for a streamed request body.
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit)
}

async function send(res: ServerResponse, response: Response) {
  res.statusCode = response.status
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() !== 'set-cookie') res.setHeader(key, value)
  }
  const cookies = response.headers.getSetCookie()
  if (cookies.length) res.setHeader('set-cookie', cookies)
  res.end(Buffer.from(await response.arrayBuffer()))
}

export function devApi(): Plugin {
  return {
    name: 'anzul-dev-api',
    apply: 'serve',
    configureServer(server) {
      if (process.env.NETLIFY_FUNCTIONS === 'emulate') return
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '/').split('?')[0] ?? '/'
        if (!pathname.startsWith('/api/')) return next()
        void (async () => {
          const functions = await loadFunctions(server)
          const fn = functions.find((f) => f.patterns.some((p) => p.test(pathname)))
          if (!fn) return next()
          const context = {
            ip: req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? '127.0.0.1',
            deploy: { context: 'dev', id: '0', published: false },
            params: {},
            waitUntil(promise: Promise<unknown>) {
              promise.catch((error: unknown) => console.error(`[dev-api] ${fn.name}`, error))
            },
          } as unknown as Context
          await send(res, await fn.handler(toRequest(req), context))
        })().catch((error: unknown) => {
          console.error('[dev-api]', error)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('content-type', 'application/json')
          }
          res.end(JSON.stringify({ error: { code: 'server_error', message: String(error) } }))
        })
      })
    },
  }
}
