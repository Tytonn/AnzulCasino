/**
 * Chat message kinds (spec: Social layer).
 *
 * - `player`: a message someone typed. Plain text, never HTML (rule 10).
 * - `gif`: a GIF someone picked (Social layer > GIFs in chat). Its `meta`
 *   holds only Klipy's id and URLs (GifMeta); the image loads straight from
 *   Klipy. The server accepts URLs on Klipy's domains only. `body` holds the
 *   GIF's title, used as its alt text.
 * - `system`: a post from the site itself, such as a big win or a steal.
 */
export const CHAT_KINDS = ['player', 'gif', 'system'] as const
export type ChatKind = (typeof CHAT_KINDS)[number]

export const CHAT_MAX_LENGTH = 300

/**
 * `meta` of a `gif` message. The social lane owns the picker, the search
 * endpoint and the URL checks, and may add fields here as a shared change.
 */
export interface GifMeta {
  gif: {
    provider: 'klipy'
    /** Klipy's id for the GIF. */
    id: string
    /** The image or video to show, on a Klipy domain. */
    url: string
    /** A smaller version for the chat list, on a Klipy domain. */
    previewUrl?: string
    width: number
    height: number
  }
  /** The system post this GIF answers, such as a big win or a steal. */
  replyTo?: number
}
