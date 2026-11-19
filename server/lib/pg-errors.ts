/** Postgres error checks that work whether or not Drizzle wrapped the error. */
interface PgErrorLike {
  code?: string
  constraint?: string
  cause?: unknown
}

function pgError(error: unknown): PgErrorLike | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const candidate = current as PgErrorLike
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) return candidate
    current = candidate.cause
  }
  return undefined
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = pgError(error)
  return e?.code === '23505' && (constraint === undefined || e.constraint === constraint)
}

export function isCheckViolation(error: unknown, constraint?: string): boolean {
  const e = pgError(error)
  return e?.code === '23514' && (constraint === undefined || e.constraint === constraint)
}
