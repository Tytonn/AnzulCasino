/**
 * Account inputs and shapes, shared by the browser (form checks) and the
 * server (the real checks). Messages are shown to players as they are.
 */
import { z } from 'zod'

import { AVATAR_COLORS, AVATARS } from './avatars.ts'
import { THEMES } from './themes.ts'
import type { Role } from './users.ts'

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/

export const Username = z
  .string()
  .trim()
  .regex(USERNAME_PATTERN, 'Usernames are 3 to 16 letters, digits or underscores.')

export const Password = z
  .string()
  .min(8, 'Passwords need at least 8 characters.')
  .max(200, 'That password is too long.')

/** Invite and reset codes, typed loosely: case, spaces and dashes do not matter. */
export const Code = z
  .string()
  .trim()
  .min(4, 'Enter the code you were given.')
  .max(40, 'That code is too long.')

export const DisplayName = z
  .string()
  .transform((s) =>
    s
      .replace(/[\p{Cc}\p{Cf}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  .pipe(z.string().min(1, 'Pick a display name.').max(20, 'Display names are up to 20 characters.'))

export const SignupInput = z.strictObject({
  username: Username,
  password: Password,
  inviteCode: Code,
})
export type SignupInput = z.infer<typeof SignupInput>

export const LoginInput = z.strictObject({
  username: z.string().trim().min(1, 'Enter your username.').max(40, 'Enter your username.'),
  password: z.string().min(1, 'Enter your password.').max(200, 'That password is too long.'),
})
export type LoginInput = z.infer<typeof LoginInput>

export const ResetInput = z.strictObject({
  username: Username,
  code: Code,
  password: Password,
})
export type ResetInput = z.infer<typeof ResetInput>

export const ProfileInput = z
  .strictObject({
    displayName: DisplayName,
    avatar: z.enum(AVATARS, 'Pick an avatar from the list.'),
    avatarColor: z.enum(AVATAR_COLORS, 'Pick a color from the list.'),
    theme: z.enum(THEMES, 'Pick a theme from the list.'),
    soundVolume: z.number().int().min(0).max(100),
    soundMuted: z.boolean(),
  })
  .partial()
export type ProfileInput = z.infer<typeof ProfileInput>

/** The logged-in player, as /api/me returns it. */
export interface Me {
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

export const CreateInviteInput = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('invite') }),
  z.strictObject({ kind: z.literal('reset'), username: Username }),
])
export type CreateInviteInput = z.infer<typeof CreateInviteInput>

export interface InviteCodeView {
  code: string
  kind: 'invite' | 'reset'
  /** For a reset code: whose password it resets. */
  forUsername: string | null
  createdAt: string
  usedBy: string | null
  usedAt: string | null
}
