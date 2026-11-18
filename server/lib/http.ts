/**
 * The API toolkit. Each lane serves its endpoints from one function:
 *
 *   export default createApi([route({ method: 'POST', path: '/api/coinflip/play', ... })])
 *   export const config: Config = { path: ['/api/coinflip/*'] }
 *
 * Every route gets, without writing it again: the session check (rule 10),
 * a per-player rate limit (rule 10), input validation with a Zod schema
 * (rule 10), the Idempotency-Key header on chip-moving routes (rule 5), JSON
 * with chip amounts as numbers, plain-word errors, and `waitUntil` for
 * publishing live events after the commit.
 */
import type { Context } from '@netlify/functions'
import type { z } from 'zod'

import {
  authenticate,
  clearSessionCookie,
  readCookie,
  SESSION_COOKIE,
  type SessionUser,
  sessionCookie,
} from './auth.ts'
import { db } from './db.ts'
import { ApiError, badRequest, forbidden, unauthorized } from './errors.ts'
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_KEY_PATTERN, sweepOldKeys } from './idempotency.ts'
import { toJson } from './json.ts'
import { setDeployContext } from './live.ts'
import { enforce, type Limit, sweepOldWindows } from './rate-limit.ts'

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'
export type Auth = 'public' | 'user' | 'admin'

export interface RouteContext<I, A extends Auth> {
  req: Request
  input: I
  /** The logged-in player. Null only on public routes. */
  user: A extends 'public' ? null : SessionUser
  /** Values for :name segments in the route's path. */
  params: Record<string, string>
  /** This route, such as "POST /api/coinflip/play". */
  action: string
  /** The Idempotency-Key header on `idempotent` routes; null on the others. */
  idempotencyKey: string | null
  ip: string
  /**
   * The database's clock when the session was checked (spec rule 8). On
   * public routes, the server's clock. Compare deadlines in SQL with now().
   */
  now: Date
  /** Work to finish after the response is sent, such as publishing live events. */
  waitUntil(promise: Promise<unknown>): void
  /** Adds a Set-Cookie header to the response. */
  setCookie(value: string): void
}

export interface Route<I = unknown, A extends Auth = Auth> {
  method: Method
  /** Such as /api/coinflip/play or /api/rounds/:id */
  path: string
  /** `public` is only for signing up, logging in and redeeming a reset code. */
  auth: A
  /** Zod schema for the JSON body (POST, PATCH) or the query string (GET, DELETE). */
  input?: z.ZodType<I>
  /** Defaults: 120 a minute per player, or 30 a minute per address on public routes. */
  limit?: Limit
  /**
   * Set on every route that moves chips (rule 5). The browser must then send
   * an Idempotency-Key header, and the route runs its work through
   * chipTransaction() in server/lib/idempotency.ts.
   */
  idempotent?: boolean
  run(ctx: RouteContext<I, A>): Promise<unknown>
}

/** Declares a route with its types inferred from the schema. */
export function route<I = undefined, A extends Auth = Auth>(definition: Route<I, A>): Route<I, A> {
  return definition
}

const DEFAULT_USER_LIMIT: Limit = { limit: 120, windowSeconds: 60 }
const DEFAULT_PUBLIC_LIMIT: Limit = { limit: 30, windowSeconds: 60 }
const MAX_BODY_BYTES = 32 * 1024

function match(pattern: string, pathname: string): Record<string, string> | null {
  const a = pattern.split('/')
  const b = pathname.replace(/\/+$/, '').split('/')
  if (a.length !== b.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < a.length; i++) {
    const p = a[i] as string
    const v = b[i] as string
    if (p.startsWith(':')) {
      if (!v) return null
      params[p.slice(1)] = decodeURIComponent(v)
    } else if (p !== v) {
      return null
    }
  }
  return params
}

function json(status: number, body: unknown, headers: Headers = new Headers()): Response {
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  return new Response(toJson(body), { status, headers })
}

function errorResponse(error: ApiError, headers?: Headers): Response {
  const extra = error.extra ?? {}
  const response = json(
    error.status,
    { error: { code: error.code, message: error.message, ...extra } },
    headers,
  )
  if (error.status === 429 && typeof extra.retryAfterSeconds === 'number') {
    response.headers.set('retry-after', String(extra.retryAfterSeconds))
  }
  return response
}

async function readInput(req: Request, method: Method): Promise<unknown> {
  if (method === 'GET' || method === 'DELETE') {
    return Object.fromEntries(new URL(req.url).searchParams)
  }
  const type = req.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) {
    throw badRequest('Send the request as JSON.', 'bad_content_type')
  }
  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) throw badRequest('That request is too large.', 'too_large')
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw badRequest('That request is not valid JSON.', 'bad_json')
  }
}

function validationMessage(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'Something in that request is not right.'
  // Schemas in shared/ carry plain-word messages; Zod's own are a fallback.
  const field = issue.path.join('.')
  return issue.message.includes(':') && field
    ? `Check the ${field} field and try again.`
    : issue.message
}

/** Any route, whatever its input and auth. */
export type AnyRoute = Route<unknown, Auth>

export function createApi(routes: AnyRoute[]) {
  return async function handle(req: Request, context: Context): Promise<Response> {
    // Live channel names carry the deploy (production, a preview, or local).
    setDeployContext(context.deploy)
    const url = new URL(req.url)
    const method = req.method.toUpperCase() as Method
    const headers = new Headers()

    let found: { route: AnyRoute; params: Record<string, string> } | undefined
    let pathMatched = false
    for (const candidate of routes) {
      const params = match(candidate.path, url.pathname)
      if (!params) continue
      pathMatched = true
      if (candidate.method === method) {
        found = { route: candidate, params }
        break
      }
    }
    if (!found) {
      return pathMatched
        ? errorResponse(new ApiError(405, 'method_not_allowed', 'That method is not allowed here.'))
        : errorResponse(new ApiError(404, 'not_found', 'There is nothing at that address.'))
    }

    const { route: r, params } = found
    const bucket = `${r.method} ${r.path}`
    const ip = context.ip || 'unknown'

    try {
      let user: SessionUser | null = null
      let now = new Date()
      if (r.auth === 'public') {
        await enforce(db(), bucket, `ip:${ip}`, r.limit ?? DEFAULT_PUBLIC_LIMIT)
      } else {
        const token = readCookie(req, SESSION_COOKIE)
        if (!token) throw unauthorized()
        const limit = r.limit ?? DEFAULT_USER_LIMIT
        const auth = await authenticate(db(), token, bucket, limit.windowSeconds)
        if (!auth) {
          headers.append('set-cookie', clearSessionCookie())
          throw unauthorized('Your session has ended. Please log in again.')
        }
        if (auth.refreshed) headers.append('set-cookie', sessionCookie(token))
        if (r.auth === 'admin' && auth.user.role !== 'admin') throw forbidden()
        if (auth.hits > limit.limit) {
          throw new ApiError(
            429,
            'rate_limited',
            `Slow down a little. Try again in ${auth.retryAfterSeconds} seconds.`,
            { retryAfterSeconds: auth.retryAfterSeconds },
          )
        }
        user = auth.user
        now = auth.now
      }

      let idempotencyKey: string | null = null
      if (r.idempotent) {
        idempotencyKey = req.headers.get(IDEMPOTENCY_HEADER)
        if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
          throw badRequest(
            'This request is missing its request key. Reload the page and try again.',
            'missing_idempotency_key',
          )
        }
      }

      let input: unknown = undefined
      if (r.input) {
        const parsed = r.input.safeParse(await readInput(req, r.method))
        if (!parsed.success) throw badRequest(validationMessage(parsed.error), 'invalid_input')
        input = parsed.data
      }

      // Keep the rate-limit and key tables small without a scheduled job.
      if (Math.floor(Date.now() / 1000) % 97 === 0) {
        context.waitUntil(
          Promise.all([sweepOldWindows(db()), sweepOldKeys(db())]).catch((e) => console.error(e)),
        )
      }

      const result = await r.run({
        req,
        input,
        user,
        params,
        action: bucket,
        idempotencyKey,
        ip,
        now,
        waitUntil: (promise) => context.waitUntil(promise.catch((e) => console.error(e))),
        setCookie: (value) => headers.append('set-cookie', value),
      })
      if (result instanceof Response) {
        for (const [key, value] of headers) result.headers.append(key, value)
        return result
      }
      return json(200, result ?? { ok: true }, headers)
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(error, headers)
      console.error(`[api] ${bucket} failed`, error)
      return errorResponse(
        new ApiError(
          500,
          'server_error',
          'Something went wrong on our side. Try again in a moment.',
        ),
        headers,
      )
    }
  }
}
