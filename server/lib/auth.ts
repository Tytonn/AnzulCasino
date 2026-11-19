/**
 * Sessions (spec: Accounts). The cookie holds a random token; the database
 * stores only its sha256. Sessions last 30 days and extend with use, at most
 * once an hour so a busy player does not write on every request.
 */
import { createHash } from 'node:crypto'

import { sql } from 'drizzle-orm'

import { sessions } from '../../db/schema/core.ts'
import type { Role } from '../../shared/users.ts'
import { type Executor, rows } from './db.ts'
import { randomToken } from './rng.ts'

export const SESSION_COOKIE = 'anzul_session'
const SESSION_DAYS = 30

export interface SessionUser {
  id: string
  username: string
  displayName: string
  avatar: string
  avatarColor: string
  role: Role
  theme: string
  soundVolume: number
  soundMuted: boolean
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(executor: Executor, userId: string): Promise<string> {
  const token = randomToken()
  await executor.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: sql`now() + make_interval(days => ${SESSION_DAYS})`,
  })
  return token
}

export async function destroySession(executor: Executor, token: string): Promise<void> {
  await executor.execute(sql`delete from sessions where token_hash = ${hashToken(token)}`)
}

export async function destroyAllSessions(executor: Executor, userId: string): Promise<void> {
  await executor.execute(sql`delete from sessions where user_id = ${userId}`)
}

interface AuthRow {
  id: string
  username: string
  display_name: string
  avatar: string
  avatar_color: string
  role: Role
  theme: string
  sound_volume: number
  sound_muted: boolean
  refreshed: boolean
  hits: number | null
  retry_after: number | null
  now_ms: number
}

export interface Authenticated {
  user: SessionUser
  /** The session was extended, so the cookie should be sent again. */
  refreshed: boolean
  /** Requests in the current rate-limit window, this one included. */
  hits: number
  retryAfterSeconds: number
  /** The database's clock at this request (spec rule 8). */
  now: Date
}

/**
 * Checks a session token and counts the request against the player's rate
 * limit for `bucket`, in one round trip. Returns null for a missing, expired
 * or disabled session.
 */
export async function authenticate(
  executor: Executor,
  token: string,
  bucket: string,
  windowSeconds: number,
): Promise<Authenticated | null> {
  const [row] = await rows<AuthRow>(
    executor,
    sql`
      with s as (
        select id, user_id from sessions
        where token_hash = ${hashToken(token)} and expires_at > now()
      ),
      touched as (
        update sessions
        set last_seen_at = now(), expires_at = now() + make_interval(days => ${SESSION_DAYS})
        where id in (select id from s) and last_seen_at < now() - interval '1 hour'
        returning id
      ),
      counted as (
        insert into rate_limits (bucket, subject, window_start, count)
        select ${bucket}, s.user_id::text,
               to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds}), 1
        from s
        on conflict (bucket, subject, window_start) do update set count = rate_limits.count + 1
        returning count,
          ceil(extract(epoch from window_start) + ${windowSeconds} - extract(epoch from now()))::int as retry_after
      )
      select u.id, u.username, u.display_name, u.avatar, u.avatar_color, u.role, u.theme,
             u.sound_volume, u.sound_muted,
             exists (select 1 from touched) as refreshed,
             (select count from counted) as hits,
             (select retry_after from counted) as retry_after,
             (extract(epoch from now()) * 1000)::float8 as now_ms
      from s join users u on u.id = s.user_id
      where u.disabled_at is null`,
  )
  if (!row) return null
  return {
    user: {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatar: row.avatar,
      avatarColor: row.avatar_color,
      role: row.role,
      theme: row.theme,
      soundVolume: Number(row.sound_volume),
      soundMuted: row.sound_muted,
    },
    refreshed: row.refreshed,
    hits: Number(row.hits ?? 0),
    retryAfterSeconds: Number(row.retry_after ?? windowSeconds),
    now: new Date(Number(row.now_ms)),
  }
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=')
  }
  return undefined
}
