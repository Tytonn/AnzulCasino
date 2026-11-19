export const ROLES = ['player', 'admin'] as const
export type Role = (typeof ROLES)[number]

/** `invite` creates an account; `reset` lets one player set a new password. */
export const INVITE_KINDS = ['invite', 'reset'] as const
export type InviteKind = (typeof INVITE_KINDS)[number]
