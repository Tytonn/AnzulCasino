/**
 * The sample accounts. scripts/db/seed.ts writes them into the dev and
 * browser-test databases, and tests/e2e-helpers/preview-setup.ts signs them
 * up on a deploy preview. No imports, so the browser tests can share it.
 */

/** Every sample account's password on this machine. Previews use E2E_PASSWORD. */
export const SEED_PASSWORD = 'password123'

export const SEED_PLAYERS = [
  { username: 'admin', displayName: 'Admin', role: 'admin', avatar: 'crown', avatarColor: 'amber' },
  { username: 'alice', displayName: 'Alice', role: 'player', avatar: 'spade', avatarColor: 'cyan' },
  { username: 'bob', displayName: 'Bob', role: 'player', avatar: 'dice', avatarColor: 'green' },
  { username: 'carol', displayName: 'Carol', role: 'player', avatar: 'star', avatarColor: 'pink' },
] as const
