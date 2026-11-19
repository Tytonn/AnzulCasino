/**
 * Errors an endpoint can return. The message is shown to the player as a
 * toast, so it says in plain words what happened and what to do next.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly extra: Record<string, unknown> | undefined

  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.extra = extra
  }
}

export const badRequest = (message: string, code = 'bad_request') =>
  new ApiError(400, code, message)
export const unauthorized = (message = 'Please log in again.') =>
  new ApiError(401, 'unauthorized', message)
export const forbidden = (message = 'You do not have access to that.') =>
  new ApiError(403, 'forbidden', message)
export const notFound = (message = 'That does not exist.') =>
  new ApiError(404, 'not_found', message)
export const conflict = (message: string, code = 'conflict') => new ApiError(409, code, message)
export const tooMany = (message: string, retryAfterSeconds: number) =>
  new ApiError(429, 'rate_limited', message, { retryAfterSeconds })
