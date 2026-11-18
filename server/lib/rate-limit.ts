/**
 * Fixed-window rate limits stored in the database, timed by the database
 * clock (spec rule 10). Login throttling uses the same table.
 */
import { sql } from 'drizzle-orm'

import { type Executor, rows } from './db.ts'
import { tooMany } from './errors.ts'

export interface Limit {
  /** Requests allowed per window. */
  limit: number
  windowSeconds: number
}

/** Counts one hit and returns the count in the current window. */
export async function hit(
  executor: Executor,
  bucket: string,
  subject: string,
  windowSeconds: number,
): Promise<{ count: number; retryAfterSeconds: number }> {
  const [row] = await rows<{ count: number; retry_after: number }>(
    executor,
    sql`
      insert into rate_limits (bucket, subject, window_start, count)
      values (${bucket}, ${subject},
              to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds}), 1)
      on conflict (bucket, subject, window_start)
        do update set count = rate_limits.count + 1
      returning count,
        ceil(extract(epoch from window_start) + ${windowSeconds} - extract(epoch from now()))::int as retry_after`,
  )
  return {
    count: Number(row?.count ?? 0),
    retryAfterSeconds: Number(row?.retry_after ?? windowSeconds),
  }
}

/** Reads the count in the current window without adding to it. */
export async function peek(
  executor: Executor,
  bucket: string,
  subject: string,
  windowSeconds: number,
): Promise<{ count: number; retryAfterSeconds: number }> {
  const [row] = await rows<{ count: number; retry_after: number }>(
    executor,
    sql`
      select count,
        ceil(extract(epoch from window_start) + ${windowSeconds} - extract(epoch from now()))::int as retry_after
      from rate_limits
      where bucket = ${bucket} and subject = ${subject}
        and window_start = to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds})`,
  )
  return { count: Number(row?.count ?? 0), retryAfterSeconds: Number(row?.retry_after ?? 0) }
}

/** Counts a hit and throws a 429 once the limit is passed. */
export async function enforce(
  executor: Executor,
  bucket: string,
  subject: string,
  { limit, windowSeconds }: Limit,
): Promise<void> {
  const { count, retryAfterSeconds } = await hit(executor, bucket, subject, windowSeconds)
  if (count > limit) {
    throw tooMany(
      `Slow down a little. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`,
      retryAfterSeconds,
    )
  }
}

/** Deletes old windows now and then, so the table stays small without a timer. */
export async function sweepOldWindows(executor: Executor): Promise<void> {
  await executor.execute(sql`delete from rate_limits where window_start < now() - interval '1 day'`)
}
