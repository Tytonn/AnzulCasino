/**
 * How games and features plug into the shell without editing it (spec:
 * Manifests). A lane adds one file, and the shell finds it:
 *
 *   src/games/<id>/manifest.ts       export default defineGame({ ... })
 *   src/features/<name>/manifest.ts  export default defineFeature({ ... })
 *
 * A game brings its card for the stream, its commands, its room (until the
 * classic rooms go), how-to-play card and replay. A feature brings pages,
 * commands, and components for the shell's slots: the top bar, the profile
 * card, chat, banners, overlays and shop items. Pages, rooms and cards load
 * on demand, so a manifest stays small.
 */
import type { QueryClient } from '@tanstack/react-query'
import type { ComponentType, ReactNode } from 'react'

import type { Me } from '../../shared/accounts.ts'
import type { ChatMessage } from '../../shared/chat.ts'
import type { CommandKey } from '../../shared/config.ts'
import type { PlayerSummary } from '../../shared/players.ts'
import type { RoundView } from '../../shared/rounds.ts'
import type { Icon } from '../kit/icons.tsx'
import type { SeatExtrasProps } from '../kit/seat-extras.ts'

/** A module loaded when first needed: `() => import('./Room.tsx')`. */
export type Lazy<P = object> = () => Promise<{ default: ComponentType<P> }>

// ---------------------------------------------------------------- games

export interface GameManifest {
  /**
   * The game's name in code: its room (/room/<id>), its live channel
   * (room:<id>), its API paths (/api/<id>/*) and its rounds' `game`.
   */
  id: string
  /** On the rail, the Floor and in the ticker. */
  name: string
  /** Place on the rail and the Floor: smaller first. */
  order: number
  /**
   * The classic room under /classic, loaded when a player walks in. Only the
   * games built before the stream have one; a new game is a card and its
   * commands, never a room (docs/LANE_GUIDE.md, section 20).
   */
  room?: Lazy
  /** The how-to-play card: a few short paragraphs. */
  howToPlay: readonly string[]
  /**
   * One short line under its name on the Floor, such as "Heads or tails.".
   * Every spec game has one in src/shell/planned.ts already; set this only
   * to change it.
   */
  pitch?: string
  /** Its icon. Planned games have one drawn by the shell already. */
  icon?: Icon
  /** Art for its Floor card, drawn in the card's top half. */
  cardArt?: ComponentType
  /** Replays a saved round from its detail (History, the ticker and a folded card). */
  replay?: Lazy<{ round: RoundView }>
  /**
   * The game as a card in the stream (spec: The stream > Cards): what goes
   * under the card's header, for everyone watching, with buttons that work
   * for the round's player. Without one, the stream shows a plain card with
   * the bet and the result.
   */
  card?: Lazy<CardProps>
  /** The commands that start it, such as .bj 50. */
  commands?: readonly CommandSpec[]
  /** What one round is called, and several: ['hand', 'hands']. "round" without it. */
  roundName?: readonly [string, string]
}

// ---------------------------------------------------------------- the stream

/** What a game's card gets from the stream. */
export interface CardProps<D = unknown> {
  /** The round as it is now: the newest of the page, the live events and your own answers. */
  round: RoundView<D>
  /** The card's chat row. */
  message: ChatMessage
  /** Your own round: its buttons work for you, and it can take the keys. */
  mine: boolean
  /** It sits above the message box, in thumb reach. */
  pinned: boolean
  /** It has the keyboard: its shortcuts work, and the message box waits. */
  keys: boolean
}

/** A private item in your own stream, marked "only you" and never stored. */
export interface PrivateReply {
  /** A few words on what it is, such as "Your balance". */
  label: string
  content: ReactNode
}

export interface CommandContext {
  /** Everything typed after the command's word, trimmed, less a side it names: "50", "alice". */
  args: string
  /** The side named after the word (CommandSpec.choices), by its first word, or null for none. */
  choice: string | null
  /** How the player called it, with the prefix: ".bj". */
  called: string
  queryClient: QueryClient
  me: Me
  navigate(to: string): void
  /** Shows a private item in your stream. */
  reply(reply: PrivateReply): void
  /** Shows the card a request opened at once: it pins above the box and takes the keys. */
  showCard(card: ChatMessage): void
}

/**
 * A command (spec: Commands). Its words live in the setting `key`, so the
 * admin panel renames it; what it does lives here. To refuse, throw a
 * CommandRefusal (src/kit/cards.ts) or let an API error through: its text
 * stays in the box and the reason shows just above it.
 */
export interface CommandSpec {
  /** The setting with its words, such as 'command_blackjack' (shared/config.ts). */
  key: CommandKey
  /**
   * What goes after the word, as the command list shows it: "bet", "player",
   * "bet side". Its first word is what `needs` asks for.
   */
  args?: string
  /** An example of what goes after the word, such as "50". */
  example?: string
  /** One line on what it does, such as "Deal a hand of blackjack.". */
  description: string
  /** Refused before it runs without one: a bet or amount, or a player's name. */
  needs?: 'amount' | 'player'
  /**
   * Sides the player can name next to the amount, each by any of its words,
   * the first its name: [['heads', 'h'], ['tails', 't']]. The shell takes
   * the side out before it reads the amount, in either order (.flip 50 heads,
   * .flip t 50), refuses two sides at once, offers each side as a quick pick,
   * and hands the side's name to `run` as `choice`. A side's words must not
   * read as an amount.
   */
  choices?: readonly (readonly [string, ...string[]])[]
  adminOnly?: boolean
  /** A game still to come: the command list shows it only once its word is typed. */
  soon?: boolean
  run(context: CommandContext): Promise<void> | void
}

// ---------------------------------------------------------------- features

export interface FeatureRoute {
  /**
   * Such as /shop or /history/:roundId. A path the shell holds a placeholder
   * for (see src/shell/planned.ts) replaces the placeholder.
   */
  path: string
  page: Lazy
  /** The browser tab's title. */
  title: string
  adminOnly?: boolean
}

export interface NavItem {
  to: string
  label: string
  icon?: Icon
  /** Place among the rail's page links: Floor is 0, Leaderboard 10 ... Admin 50. */
  order: number
  adminOnly?: boolean
}

/** One component in a slot. */
export interface SlotEntry<P> {
  /** Unique, such as "economy.work". */
  id: string
  /** Smaller first. */
  order: number
  component: ComponentType<P>
  adminOnly?: boolean
}

/**
 * The props each slot hands its components. A lane can add a slot of its own
 * (say, for other lanes to fill its page) by extending this interface from
 * its own file:
 *
 *   declare module '../../shell/manifests.ts' {
 *     interface SlotProps { 'heist.vault-panel': { wallet: number } }
 *   }
 */
export interface SlotProps {
  /**
   * The top bar, in every room, on desktop and phone: the work, slut and
   * crime buttons, Collect, shield pips, steal attempts. `compact` is true on
   * a phone, where each widget gets about 4.5rem: show an icon and the
   * cooldown, and put the label in `title`/aria-label.
   */
  'top-bar': { compact: boolean }
  /**
   * One short status in the phone's strip over the stream, beside the
   * wallet, such as the economy's "Work 2:41". Keep it to a few words.
   */
  'stream-status': Record<string, never>
  /** Buttons on a player's profile card, such as Steal. */
  'profile-actions': { player: PlayerSummary }
  /** Sections on a player's profile card, such as season stats. */
  'profile-sections': { player: PlayerSummary }
  /**
   * Beside the chat box, such as the GIF picker. Call `sent` with what the
   * server saved, so it shows at once without waiting for the live echo.
   */
  'chat-composer': { sent(message: ChatMessage): void }
  /** Under each chat message, such as reactions. */
  'chat-message': { message: ChatMessage }
  /**
   * On every seat in every room, such as the social lane's seat reactions.
   * The seat is `relative`: draw inside its box (`absolute inset-0` covers
   * it) and leave the seat's own content readable.
   */
  seat: SeatExtrasProps
  /** Above the page in the center column, such as the final-day banner. */
  banner: Record<string, never>
  /** Mounted once for the whole session: notification toasts, celebrations. */
  overlay: Record<string, never>
  /** Cards on the Shop page (the heist lane's), from any lane: shields, ranks. */
  'shop-items': Record<string, never>
}

export type SlotName = keyof SlotProps

export type Slots = { [K in SlotName]?: readonly SlotEntry<SlotProps[K]>[] }

export interface FeatureManifest {
  /** The lane's name, such as "economy". */
  id: string
  routes?: readonly FeatureRoute[]
  /** Extra links on the rail. The spec's own pages are already there. */
  nav?: readonly NavItem[]
  slots?: Slots
  /** Its commands in the message box, such as .work. */
  commands?: readonly CommandSpec[]
}

/** Declares a game's manifest with its types checked. */
export function defineGame(manifest: GameManifest): GameManifest {
  return manifest
}

/** Declares a feature's manifest with its types checked. */
export function defineFeature(manifest: FeatureManifest): FeatureManifest {
  return manifest
}
