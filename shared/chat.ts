/** `player` is a message someone typed; anything else is a system post. */
export const CHAT_KINDS = ['player', 'system'] as const
export type ChatKind = (typeof CHAT_KINDS)[number]

export const CHAT_MAX_LENGTH = 300
