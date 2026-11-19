/** Themes a player can pick. `vegas` arrives later (spec: Themes). */
export const THEMES = ['midnight'] as const
export type Theme = (typeof THEMES)[number]
