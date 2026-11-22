/**
 * The test accounts (Tyton, Nov 20, 2026): an easy login for trying the site
 * on a deploy preview or locally, without an invite code or a long password.
 * They exist only where server/core/test-accounts.ts turns them on, never on
 * the live site.
 *
 * Signing in as either one there creates both if they are missing, puts them
 * in a running season and fills their wallets back up to TEST_BALANCE. Two of
 * them, so one can rob the other or watch the other's seat from a second
 * window.
 *
 * No imports outside shared/, so the browser tests can share it.
 */
import { chips } from './chips.ts'

/** Both accounts' password. Short on purpose: these accounts hold nothing worth taking. */
export const TEST_PASSWORD = 'test'

/** What a test account's wallet is filled back up to when one signs in: 10,000 chips, ten starts. */
export const TEST_BALANCE = chips(10_000)

export const TEST_ACCOUNTS = [
  { username: 'test', displayName: 'Test', avatar: 'bolt', avatarColor: 'lime' },
  { username: 'test2', displayName: 'Test 2', avatar: 'moon', avatarColor: 'blue' },
] as const

const USERNAMES = new Set<string>(TEST_ACCOUNTS.map((a) => a.username))

/** Whether a username, in any case, is one of the test accounts. */
export function isTestUsername(username: string): boolean {
  return USERNAMES.has(username.trim().toLowerCase())
}
