/**
 * Accounts (spec: Accounts and seasons > Accounts): sign up with an invite
 * code, log in, log out, redeem a reset code, edit the profile. The first
 * account created with ADMIN_BOOTSTRAP_CODE becomes the admin.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

import { and, eq, isNull, sql } from 'drizzle-orm'

import { inviteCodes, users } from '../../db/schema/core.ts'
import type {
  LoginInput,
  Me,
  ProfileInput,
  ResetInput,
  SignupInput,
} from '../../shared/accounts.ts'
import { isTestUsername } from '../../shared/test-accounts.ts'
import type { Role } from '../../shared/users.ts'
import { createSession, destroyAllSessions } from '../lib/auth.ts'
import { db, rows } from '../lib/db.ts'
import { env } from '../lib/env.ts'
import { ApiError, badRequest, conflict, forbidden, tooMany } from '../lib/errors.ts'
import { dummyPasswordHash, hashPassword, verifyPassword } from '../lib/passwords.ts'
import { isUniqueViolation } from '../lib/pg-errors.ts'
import { hit, peek } from '../lib/rate-limit.ts'
import { publish, walletEvents } from '../lib/live.ts'
import { joinSeason, startedSeason } from '../lib/seasons.ts'
import { normalizeCode } from '../lib/rng.ts'
import { ensureTestAccounts, refillTestAccounts } from './test-accounts.ts'

const INVALID_INVITE = 'That invite code is not valid, or it was already used.'
const LOGIN_FAILURES = { limit: 5, windowSeconds: 15 * 60 }
const TEST_ACCOUNTS_OFF =
  'The test accounts only work on deploy previews. This deploy uses the live database.'

type UserRow = typeof users.$inferSelect

export function toMe(user: UserRow): Me {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    avatarColor: user.avatarColor,
    role: user.role,
    theme: user.theme,
    soundVolume: user.soundVolume,
    soundMuted: user.soundMuted,
  }
}

function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export async function signup(input: SignupInput): Promise<{ user: Me; token: string }> {
  const passwordHash = await hashPassword(input.password)
  const created = await db().transaction(async (tx) => {
    let role: Role = 'player'
    let inviteCode: string | null = null

    const bootstrap = env('ADMIN_BOOTSTRAP_CODE')
    if (bootstrap && sameSecret(input.inviteCode.trim(), bootstrap)) {
      // One admin from the bootstrap code, ever. The lock makes two signups
      // with the code at the same moment take turns.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('anzul:admin-bootstrap'))`)
      const [admin] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'admin'))
        .limit(1)
      if (admin) throw badRequest(INVALID_INVITE, 'invalid_invite')
      role = 'admin'
    } else {
      inviteCode = normalizeCode(input.inviteCode)
      const [invite] = await tx
        .select()
        .from(inviteCodes)
        .where(and(eq(inviteCodes.code, inviteCode), eq(inviteCodes.kind, 'invite')))
        .for('update')
      if (!invite || invite.usedBy) throw badRequest(INVALID_INVITE, 'invalid_invite')
    }

    let user: UserRow
    try {
      const [created] = await tx
        .insert(users)
        .values({ username: input.username, passwordHash, displayName: input.username, role })
        .returning()
      user = created as UserRow
    } catch (error) {
      if (isUniqueViolation(error, 'users_username_lower_key')) {
        throw conflict('That username is taken. Try another one.', 'username_taken')
      }
      throw error
    }

    if (inviteCode) {
      await tx
        .update(inviteCodes)
        .set({ usedBy: user.id, usedAt: sql`now()` })
        .where(and(eq(inviteCodes.code, inviteCode), isNull(inviteCodes.usedBy)))
    }

    // A late joiner gets the same starting balance as everyone else.
    const season = await startedSeason(tx)
    const joined = season && (await joinSeason(tx, season, user.id))

    const token = await createSession(tx, user.id)
    return { user: toMe(user), token, joined: season && joined ? { season, joined } : null }
  })
  // After the commit: the new player appears on everyone's leaderboard.
  if (created.joined) {
    const { season, joined } = created.joined
    await publish(walletEvents(season.id, created.user.id, joined))
  }
  return { user: created.user, token: created.token }
}

export interface LoginOptions {
  /**
   * The test accounts work on this deploy (testAccountsOn in
   * server/core/test-accounts.ts): signing in as one of them creates it if
   * needed and fills its wallet. Off unless the route says so.
   */
  testAccounts?: boolean
  /**
   * A production deploy opened by its own link (isUnpublishedProduction in
   * server/lib/deploy.ts): a failed sign-in as a test account says they only
   * work on deploy previews, instead of only that the password is wrong.
   * Never on the live site, which has no reason to mention them.
   */
  testAccountsHint?: boolean
}

export async function login(
  input: LoginInput,
  options: LoginOptions = {},
): Promise<{ user: Me; token: string }> {
  const subject = input.username.toLowerCase()
  const failures = await peek(db(), 'login_failed', subject, LOGIN_FAILURES.windowSeconds)
  if (failures.count >= LOGIN_FAILURES.limit) {
    const minutes = Math.max(1, Math.ceil(failures.retryAfterSeconds / 60))
    throw tooMany(
      `Too many wrong passwords for ${input.username}. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      failures.retryAfterSeconds,
    )
  }

  const testAccount = options.testAccounts === true && isTestUsername(subject)
  if (testAccount) await ensureTestAccounts()

  const [user] = await db()
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = ${subject}`)
  const ok = await verifyPassword(input.password, user?.passwordHash ?? (await dummyPasswordHash()))
  if (!user || !ok) {
    await hit(db(), 'login_failed', subject, LOGIN_FAILURES.windowSeconds)
    if (options.testAccountsHint === true && isTestUsername(subject)) {
      throw new ApiError(400, 'test_accounts_off', TEST_ACCOUNTS_OFF)
    }
    throw new ApiError(400, 'bad_credentials', 'Wrong username or password.')
  }
  if (user.disabledAt) throw forbidden('This account is disabled. Ask the admin about it.')

  if (testAccount) {
    // Chips for trying things. A failure here must not lock the tester out.
    await refillTestAccounts(user.id).catch((error: unknown) =>
      console.error('[accounts] filling the test accounts failed', error),
    )
  }

  const token = await createSession(db(), user.id)
  return { user: toMe(user), token }
}

export async function redeemReset(input: ResetInput): Promise<{ user: Me; token: string }> {
  const passwordHash = await hashPassword(input.password)
  return db().transaction(async (tx) => {
    const code = normalizeCode(input.code)
    const [row] = await rows<{ user_id: string; username: string; used_by: string | null }>(
      tx,
      sql`select ic.used_by, u.id as user_id, u.username
          from invite_codes ic join users u on u.id = ic.target_user_id
          where ic.code = ${code} and ic.kind = 'reset'
          for update of ic`,
    )
    if (!row || row.used_by || row.username.toLowerCase() !== input.username.toLowerCase()) {
      throw badRequest(
        'That reset code is not valid for this username, or it was already used.',
        'invalid_reset',
      )
    }
    const [user] = await tx
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, row.user_id))
      .returning()
    await tx
      .update(inviteCodes)
      .set({ usedBy: row.user_id, usedAt: sql`now()` })
      .where(eq(inviteCodes.code, code))
    // A new password logs out every other device.
    await destroyAllSessions(tx, row.user_id)
    if (user?.disabledAt) throw forbidden('This account is disabled. Ask the admin about it.')
    const token = await createSession(tx, row.user_id)
    return { user: toMe(user as UserRow), token }
  })
}

export async function updateProfile(userId: string, input: ProfileInput): Promise<Me> {
  const changes = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
  if (Object.keys(changes).length === 0) {
    const [user] = await db().select().from(users).where(eq(users.id, userId))
    return toMe(user as UserRow)
  }
  const [user] = await db().update(users).set(changes).where(eq(users.id, userId)).returning()
  return toMe(user as UserRow)
}
