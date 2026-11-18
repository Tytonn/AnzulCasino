/**
 * The browser's API client. Every request goes through it:
 *
 *   const { message } = await api.post<{ message: ChatMessage }>('/api/chat', { body })
 *
 * A request that moves chips carries an Idempotency-Key (spec rule 5). Make
 * one key per intent with requestKey() and pass it with the request; the
 * client retries a request that never reached the server with the same key,
 * so a bet counts once however often it is sent:
 *
 *   const key = requestKey()
 *   const result = await api.post('/api/coinflip/play', { bet, call }, { key })
 *
 * Errors arrive as ApiError with the server's plain-word message, ready for
 * a toast.
 */

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly extra: Record<string, unknown>

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.extra = extra
  }
}

export interface RequestOptions {
  /** The request's Idempotency-Key, for routes that move chips. */
  key?: string
  signal?: AbortSignal
}

/** A fresh Idempotency-Key: one per intent, reused when retrying it. */
export function requestKey(): string {
  return crypto.randomUUID()
}

const signedOutListeners = new Set<() => void>()

/** Runs `listener` when the server says the session has ended. */
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener)
  return () => {
    signedOutListeners.delete(listener)
  }
}

const NETWORK_MESSAGE = 'Could not reach the casino. Check your connection and try again.'

async function send(method: string, path: string, body: unknown, options: RequestOptions) {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (options.key) headers['idempotency-key'] = options.key
  return fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    signal: options.signal,
  })
}

async function request<T>(
  method: string,
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<T> {
  let res: Response | undefined
  // A keyed request is safe to send again: the server answers a repeat with
  // the first result. Others are sent once.
  const attempts = options.key ? 3 : 1
  for (let attempt = 1; !res; attempt++) {
    try {
      res = await send(method, path, body, options)
    } catch (error) {
      if (options.signal?.aborted) throw error
      if (attempt >= attempts) throw new ApiError(0, 'network', NETWORK_MESSAGE)
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
    }
  }

  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // Not JSON, such as a proxy's error page: handled below by the status.
  }
  if (res.ok) return json as T

  const error =
    typeof json === 'object' && json !== null && 'error' in json
      ? (json.error as { code?: string; message?: string } & Record<string, unknown>)
      : undefined
  const { code, message, ...extra } = error ?? {}
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    for (const listener of signedOutListeners) listener()
  }
  throw new ApiError(
    res.status,
    code ?? 'error',
    message ?? 'Something went wrong on our side. Try again in a moment.',
    extra,
  )
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body: unknown = {}, options?: RequestOptions) =>
    request<T>('POST', path, body, options),
  patch: <T>(path: string, body: unknown = {}, options?: RequestOptions) =>
    request<T>('PATCH', path, body, options),
  del: <T>(path: string, options?: RequestOptions) =>
    request<T>('DELETE', path, undefined, options),
}

/** A message for a toast from anything a request can throw. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return 'Something went wrong. Try again in a moment.'
}
