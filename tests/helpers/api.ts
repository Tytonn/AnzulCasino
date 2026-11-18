/**
 * Calls an API handler the way Netlify would, with a cookie jar per client,
 * so tests can act as several players at once.
 *
 *   const alice = apiClient(coreApi)
 *   await alice.post('/api/auth/login', { username: 'alice', password: '...' })
 */
import type { Context } from '@netlify/functions'

type Handler = (req: Request, context: Context) => Promise<Response>

export interface ApiResult<T = any> {
  status: number
  body: T
  headers: Headers
}

export function apiClient(handler: Handler, options: { ip?: string } = {}) {
  const jar = new Map<string, string>()
  const pending: Promise<unknown>[] = []
  const ip = options.ip ?? '203.0.113.7'

  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    rawBody?: string,
  ): Promise<ApiResult<T>> {
    const headers = new Headers()
    if (jar.size) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '))
    let payload: string | undefined
    if (rawBody !== undefined) {
      payload = rawBody
    } else if (body !== undefined) {
      headers.set('content-type', 'application/json')
      payload = JSON.stringify(body)
    }
    const req = new Request(`http://localhost${path}`, { method, headers, body: payload })
    const context = {
      ip,
      params: {},
      waitUntil: (promise: Promise<unknown>) => void pending.push(promise),
    } as unknown as Context
    const res = await handler(req, context)
    for (const cookie of res.headers.getSetCookie()) {
      const [pair, ...attributes] = cookie.split(';').map((p) => p.trim())
      const [name, ...value] = (pair ?? '').split('=')
      if (!name) continue
      if (attributes.some((a) => a.toLowerCase() === 'max-age=0')) jar.delete(name)
      else jar.set(name, value.join('='))
    }
    const text = await res.text()
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers }
  }

  return {
    get: <T = any>(path: string) => call<T>('GET', path),
    post: <T = any>(path: string, body: unknown = {}) => call<T>('POST', path, body),
    patch: <T = any>(path: string, body: unknown = {}) => call<T>('PATCH', path, body),
    del: <T = any>(path: string) => call<T>('DELETE', path),
    raw: <T = any>(method: string, path: string, body: string) =>
      call<T>(method, path, undefined, body),
    cookies: jar,
    /** Waits for work the handlers passed to waitUntil, such as live publishes. */
    settle: () => Promise.all(pending.splice(0)),
  }
}

export type ApiClient = ReturnType<typeof apiClient>
