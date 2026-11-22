/**
 * Admin (spec: Admin and trust; Economy > Giveaways): what the admin panel,
 * the Audit page and the server share. The owner runs the site and plays for
 * the pot too, so every admin power is public by design: each action writes
 * an audit row that every player can read, and the ones that move chips or
 * end a season also post in chat.
 *
 * Chip amounts are whole chips: bigint on the server, plain safe integers on
 * the wire. Names and reasons are plain text, never HTML (rule 10).
 */
import { z } from 'zod'

import { cleanChatText } from '../chat.ts'
import { chipCount, formatChips } from '../chips.ts'
import { GAME_DAY_TIME_ZONE } from '../game-day.ts'
import { LEDGER_ACCOUNTS, type LedgerAccount } from '../ledger.ts'
import type { Tier } from '../tiers.ts'
import type { Role } from '../users.ts'

export const ADMIN = 'admin'

/** The most one adjustment or giveaway can move: a billion chips. */
export const MAX_ADMIN_AMOUNT = 1_000_000_000

/** Longest reason or giveaway note, in characters. They are shown in chat and on the Audit page. */
export const REASON_MAX = 140

/** Players one giveaway can name. Everyone is always allowed. */
export const GIVEAWAY_MAX_PLAYERS = 100

// ---------------------------------------------------------------- inputs

/** Plain text on one line, as chat stores it, then checked for length. */
function line(min: number, tooShort: string) {
  return z
    .string(tooShort)
    .max(REASON_MAX * 8, `Keep it to ${REASON_MAX} characters.`)
    .transform(cleanChatText)
    .pipe(z.string().min(min, tooShort).max(REASON_MAX, `Keep it to ${REASON_MAX} characters.`))
}

/** A reason everyone will read. Required for chip adjustments (spec: Admin panel > Chips). */
const Reason = line(3, 'Say why in a few words. Everyone sees it in chat and on the Audit page.')

/** An optional reason or note. An empty one counts as none. */
const OptionalReason = line(0, 'Type a reason.')
  .optional()
  .transform((text) => (text ? text : undefined))

/** A chip amount, as it travels. Chips are whole numbers. */
function amount(message: string) {
  return z
    .number(message)
    .int('Chips are whole numbers. Type an amount without a decimal point.')
    .refine((n) => Math.abs(n) <= MAX_ADMIN_AMOUNT, 'That is more than a billion chips.')
}

/** POST /api/admin/chips: a manual adjustment, up or down. */
export const AdjustInput = z.strictObject({
  userId: z.uuid({ error: 'Pick a player.' }),
  /** Chips. Above zero adds chips, below zero takes them. */
  amount: amount('Type an amount.').refine((n) => n !== 0, 'Type an amount other than zero.'),
  account: z.enum(LEDGER_ACCOUNTS, { error: 'Choose the wallet or the vault.' }).default('wallet'),
  reason: Reason,
})
export type AdjustInput = z.infer<typeof AdjustInput>

/** POST /api/admin/giveaways */
export const GiveawayInput = z.strictObject({
  /** Everyone in the season, or the players named. */
  to: z.union(
    [
      z.literal('everyone'),
      z
        .array(z.uuid({ error: 'Pick players from the list.' }))
        .min(1, 'Pick at least one player.')
        .max(GIVEAWAY_MAX_PLAYERS, `Pick up to ${GIVEAWAY_MAX_PLAYERS} players, or everyone.`)
        .transform((ids) => [...new Set(ids)]),
    ],
    { error: 'Pick players, or everyone.' },
  ),
  /** Chips: each player's, or the whole pot when `split`. */
  amount: amount('Type an amount.').refine((n) => n > 0, 'Type an amount above zero.'),
  /** True splits `amount` between them; false gives each of them `amount`. */
  split: z.boolean().default(false),
  note: OptionalReason,
})
export type GiveawayInput = z.infer<typeof GiveawayInput>

/** POST /api/admin/players/:id/disable and /enable */
export const PlayerStatusInput = z.strictObject({ reason: OptionalReason })
export type PlayerStatusInput = z.infer<typeof PlayerStatusInput>

const When = (message: string) =>
  z.iso.datetime({ offset: true, error: message }).transform((value) => new Date(value))

/** POST /api/admin/seasons/:id/end: now, or at a time before its current end. */
export const EndSeasonInput = z.strictObject({
  /** Leave out to end it now. */
  at: When('Pick the new end time.').optional(),
  reason: OptionalReason,
})
export type EndSeasonInput = z.infer<typeof EndSeasonInput>

/** PATCH /api/admin/seasons/:id. Dates and starting chips only before the season starts. */
export const EditSeasonInput = z
  .strictObject({
    name: z
      .string('Name the season.')
      .trim()
      .min(1, 'Name the season.')
      .max(40, 'Season names are up to 40 characters.')
      .optional(),
    startsAt: When('Pick a start time.').optional(),
    endsAt: When('Pick an end time.').optional(),
    /** Chips. */
    startingBalance: z
      .number('Type the starting chips.')
      .int('The starting balance must be a whole number of chips.')
      .positive('The starting balance must be above zero.')
      .max(MAX_ADMIN_AMOUNT, 'That is more than a billion chips.')
      .optional(),
  })
  .refine(
    (edit) => Object.values(edit).some((value) => value !== undefined),
    'Change something first.',
  )
export type EditSeasonInput = z.infer<typeof EditSeasonInput>

/** POST /api/admin/config: several settings saved together, in one transaction. */
export const ConfigSaveInput = z.strictObject({
  changes: z
    .array(
      z.strictObject({
        key: z.string('Name the setting.').min(1, 'Name the setting.').max(64),
        /** The wire form: a number (chips, or shares in basis points), text, or a list. */
        value: z.unknown(),
      }),
    )
    .min(1, 'Change a setting first.')
    .max(120, 'That is too many changes for one save.')
    .refine(
      (changes) => new Set(changes.map((c) => c.key)).size === changes.length,
      'Each setting can only change once in a save.',
    ),
  reason: OptionalReason,
})
export type ConfigSaveInput = z.infer<typeof ConfigSaveInput>

// ---------------------------------------------------------------- the audit log

/** How the Audit page groups actions. */
export const AUDIT_KINDS = ['chips', 'config', 'seasons', 'accounts', 'chat'] as const
export type AuditKind = (typeof AUDIT_KINDS)[number]

export const AUDIT_KIND_LABELS: Record<AuditKind, string> = {
  chips: 'Chips',
  config: 'Settings',
  seasons: 'Seasons',
  accounts: 'Accounts',
  chat: 'Chat',
}

/**
 * Which actions belong to each kind, by the start of their name. The
 * foundation writes season.created, config.changed, reset_code.created and
 * chat.deleted; this lane writes the rest.
 */
export const AUDIT_KIND_PREFIXES: Record<AuditKind, readonly string[]> = {
  chips: ['chips.', 'giveaway.'],
  config: ['config.'],
  seasons: ['season.'],
  accounts: ['player.', 'reset_code.', 'invite.'],
  chat: ['chat.'],
}

/** The kind an action belongs to, or null for one nobody has named yet. */
export function auditKind(action: string): AuditKind | null {
  for (const kind of AUDIT_KINDS) {
    if (AUDIT_KIND_PREFIXES[kind].some((prefix) => action.startsWith(prefix))) return kind
  }
  return null
}

/** GET /api/admin/audit: the newest page, or the page before an entry id. */
export const AuditListInput = z.strictObject({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  kind: z.enum(AUDIT_KINDS, { error: 'Pick a kind from the list.' }).optional(),
})
export type AuditListInput = z.infer<typeof AuditListInput>

export const AUDIT_PAGE_SIZE = 40

/** A player as the Audit page names them, by their current name. */
export interface AuditPerson {
  id: string
  username: string
  displayName: string
  avatar: string
  avatarColor: string
}

/**
 * One audit row as the Audit page and `audit.logged` send it. `before` and
 * `after` are the action's own shapes (the *Audit types below for this lane's
 * actions); chip amounts in them are whole chips.
 */
export interface AuditEntryView {
  id: number
  /** When it happened, ISO. */
  at: string
  action: string
  kind: AuditKind | null
  actor: AuditPerson | null
  /** Such as a username, a setting's key or season:3. */
  target: string | null
  before: unknown
  after: unknown
  reason: string | null
  season: { id: number; name: string } | null
  /** Everyone the entry names (the actor, the players it touched), by id. */
  people: Record<string, AuditPerson>
}

/** A setting change waiting for the next daily reset (spec: listed ahead of time). */
export interface PendingChangeView {
  key: string
  /** The wire form of the value it will take. */
  value: unknown
  /** The wire form of the value in force now. */
  current: unknown
  effectiveAt: string
  by: AuditPerson | null
  reason: string | null
}

/** GET /api/admin/audit */
export interface AuditPage {
  entries: AuditEntryView[]
  /** True when older entries exist. */
  more: boolean
  pending: PendingChangeView[]
  /** The next daily reset, when delayed changes take effect. */
  nextReset: string
}

/** chips.adjusted: target is the player's username. */
export interface AdjustAudit {
  before: { userId: string; account: LedgerAccount; value: number }
  after: { userId: string; account: LedgerAccount; value: number; delta: number }
}

/** giveaway.given: target is "everyone" or how many players. */
export interface GiveawayAudit {
  after: {
    split: boolean
    everyone: boolean
    /** What was typed: each player's chips, or the pot when split. */
    amount: number
    /** What each player got. */
    share: number
    total: number
    recipients: { userId: string; amount: number }[]
  }
}

/** season.ended_early: target is season:<id>. */
export interface SeasonEndAudit {
  before: { endsAt: string }
  after: { endsAt: string; immediate: boolean }
}

/** season.updated: only the fields that changed. */
export interface SeasonEditAudit {
  before: SeasonFields
  after: SeasonFields
}

export interface SeasonFields {
  name?: string
  startsAt?: string
  endsAt?: string
  startingBalance?: number
}

/** player.disabled and player.enabled: target is the player's username. */
export interface PlayerStatusAudit {
  after: { userId: string }
}

// ---------------------------------------------------------------- views

/** One account as the admin panel lists it. Amounts in chips. */
export interface AdminPlayerView {
  id: string
  username: string
  displayName: string
  avatar: string
  avatarColor: string
  role: Role
  createdAt: string
  disabledAt: string | null
  /** The last request any of their sessions made, to the hour. */
  lastSeenAt: string | null
  /** Their chips in the current season, or null without a wallet there. */
  wallet: { balance: number; vault: number; tier: Tier } | null
}

/** GET /api/admin/players */
export interface AdminPlayersResponse {
  seasonId: number | null
  players: AdminPlayerView[]
}

/** The last change to a setting that has taken effect. */
export interface LastChangeView {
  at: string
  effectiveAt: string
  by: AuditPerson | null
  reason: string | null
}

/** GET /api/admin/config, and the answer to a save. */
export interface AdminConfigState {
  /** Every value in force now, in its wire form. */
  values: Record<string, unknown>
  pending: PendingChangeView[]
  /** Keys changed at least once, with the change in force. */
  changed: Record<string, LastChangeView>
  nextReset: string
}

/** POST /api/admin/config */
export interface ConfigSaveResponse {
  state: AdminConfigState
  saved: { key: string; effectiveAt: string }[]
}

/** POST /api/admin/giveaways */
export interface GiveawayResponse {
  share: number
  total: number
  recipients: { userId: string; amount: number }[]
}

// ---------------------------------------------------------------- live and chat

declare module '../events.ts' {
  interface FeedEvents {
    /** An admin action was written to the audit log. Version: the audit row id. */
    'audit.logged': AuditEntryView
  }
}

/** What an admin post in chat is about, for a richer drawing than its text. */
export type AdminPostMeta =
  | {
      kind: 'adjust'
      by: string
      userId: string
      account: LedgerAccount
      amount: number
      reason: string
    }
  | {
      kind: 'giveaway'
      by: string
      split: boolean
      everyone: boolean
      share: number
      total: number
      recipients: { userId: string; amount: number }[]
      note: string | null
    }
  | {
      kind: 'season_end'
      by: string
      seasonId: number
      endsAt: string
      immediate: boolean
      reason: string | null
    }

declare module '../chat.ts' {
  interface SystemMeta {
    /** A post about an admin action (the admin lane's). */
    admin?: AdminPostMeta
  }
}

// ---------------------------------------------------------------- the math

/**
 * What each player gets. A split rounds each share down to a whole chip and
 * gives nothing of the remainder, so a pot is never overpaid.
 */
export function giveawayShares(
  amount: bigint,
  players: number,
  split: boolean,
): { share: bigint; total: bigint; leftover: bigint } {
  if (players <= 0) return { share: 0n, total: 0n, leftover: amount }
  const count = BigInt(players)
  if (!split) return { share: amount, total: amount * count, leftover: 0n }
  const share = amount / count
  return { share, total: share * count, leftover: amount - share * count }
}

// ---------------------------------------------------------------- wording

/** "Alice", "Alice and Bob", "Alice, Bob and Carol", or the first few "and 3 others". */
export function nameList(names: readonly string[], max = 12): string {
  if (names.length === 0) return 'nobody'
  const shown = names.length > max ? names.slice(0, max - 1) : [...names]
  const rest = names.length - shown.length
  if (rest > 0) return `${shown.join(', ')} and ${rest} others`
  if (shown.length === 1) return shown[0] ?? ''
  return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`
}

/** A reason or note at the end of a post: ": birthday bonus" and no full stop, or "." with none. */
function ending(text: string | null | undefined): string {
  return text ? `: ${text}` : '.'
}

/** The chat post for a manual adjustment (spec: manual chip adjustments also post in chat). */
export function adjustPostText(post: {
  admin: string
  player: string
  self: boolean
  amount: bigint
  account: LedgerAccount
  reason: string
}): string {
  const whose = post.self ? `their own ${post.account}` : `${post.player}'s ${post.account}`
  const verb =
    post.amount > 0n
      ? `added ${chipCount(post.amount)} to ${whose}`
      : `took ${chipCount(-post.amount)} from ${whose}`
  return `🧾 ${post.admin} ${verb}${ending(post.reason)}`
}

/** The chat post for a giveaway, with names and amounts (spec: Giveaways). */
export function giveawayPostText(post: {
  admin: string
  names: readonly string[]
  everyone: boolean
  split: boolean
  /** Chips: what was typed (each, or the pot). */
  amount: bigint
  share: bigint
  note?: string | null
}): string {
  const count = post.names.length
  const who = post.everyone ? 'everyone' : nameList(post.names)
  let what: string
  if (count === 1) what = `gave ${who} ${chipCount(post.share)}`
  else if (post.split) {
    const between = post.everyone ? `all ${count} players` : who
    what = `split ${chipCount(post.amount)} between ${between}, ${formatChips(post.share)} each`
  } else if (post.everyone) what = `gave everyone ${chipCount(post.share)}`
  else what = `gave ${who} ${chipCount(post.share)} each`
  return `🎁 ${post.admin} ${what}${ending(post.note)}`
}

const centralTime = new Intl.DateTimeFormat('en-US', {
  timeZone: GAME_DAY_TIME_ZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/** A moment in the game's time zone, the way the spec names times: "Sun, Nov 23, 4:00 AM CT". */
export function centralWhen(at: Date): string {
  return `${centralTime.format(at)} CT`
}

/** The chat post when the admin ends a season early or moves its end earlier. */
export function seasonEndPostText(post: {
  admin: string
  season: string
  /** Null: it ended at once. */
  endsAt: Date | null
  reason?: string | null
}): string {
  if (!post.endsAt) return `🛑 ${post.admin} ended ${post.season} early${ending(post.reason)}`
  return `⏱️ ${post.admin} moved the end of ${post.season} to ${centralWhen(post.endsAt)}${ending(post.reason)}`
}

/** The private note a player gets when the admin adjusts their chips. */
export function adjustNoticeText(
  admin: string,
  amount: bigint,
  account: LedgerAccount,
  reason: string,
): string {
  return amount > 0n
    ? `${admin} added ${chipCount(amount)} to your ${account}: ${reason}`
    : `${admin} took ${chipCount(-amount)} from your ${account}: ${reason}`
}

/** The private note each giveaway recipient gets. */
export function giveawayNoticeText(admin: string, share: bigint, note?: string | null): string {
  return `🎁 ${admin} gave you ${chipCount(share)}${ending(note)}`
}
