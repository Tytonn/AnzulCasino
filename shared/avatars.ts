/**
 * The built-in avatar set (spec: Accounts > Profile). Each avatar is an icon
 * drawn by the shell, in one of the theme's avatar colors.
 */
export const AVATARS = [
  'chip',
  'spade',
  'heart',
  'club',
  'diamond',
  'crown',
  'dice',
  'star',
  'moon',
  'bolt',
  'flame',
  'clover',
] as const
export type Avatar = (typeof AVATARS)[number]

export const AVATAR_COLORS = [
  'violet',
  'blue',
  'cyan',
  'teal',
  'green',
  'lime',
  'amber',
  'orange',
  'red',
  'pink',
] as const
export type AvatarColor = (typeof AVATAR_COLORS)[number]
