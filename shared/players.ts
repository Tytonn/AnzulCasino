/**
 * Every player, as GET /api/players lists them: enough to draw a name, an
 * avatar and a tier badge anywhere (chat, the online list, seats).
 */
import type { Tier } from './tiers.ts'
import type { Role } from './users.ts'

export interface PlayerSummary {
  id: string
  username: string
  displayName: string
  avatar: string
  avatarColor: string
  role: Role
  /** The player's tier in the current season; `base` without a wallet. */
  tier: Tier
}
