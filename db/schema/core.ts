/**
 * Every table in the spec's Data model. Owned by the foundation: lanes read
 * these tables and write them only through the shared server libraries.
 * A lane that needs its own table adds it in db/schema/<lane>.ts with the
 * table name prefixed by the lane name.
 *
 * Chip amounts are bigint counts of hundredths of a chip (spec rule 2).
 * Time columns are timestamptz and are compared against the database's now().
 */
import { type SQL, sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { CHAT_KINDS, CHAT_MAX_LENGTH } from '../../shared/chat.ts'
import { LEDGER_ACCOUNTS } from '../../shared/ledger.ts'
import { ROUND_STATUSES } from '../../shared/rounds.ts'
import { SEASON_STATUSES } from '../../shared/seasons.ts'
import { STEAL_OUTCOMES } from '../../shared/steals.ts'
import { TIERS } from '../../shared/tiers.ts'
import { INVITE_KINDS, ROLES } from '../../shared/users.ts'

/** A chip amount: a bigint count of hundredths of a chip. */
const chips = (name: string) => bigint(name, { mode: 'bigint' })
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })
const bigId = (name: string) => bigint(name, { mode: 'number' })

/** `column in ('a', 'b')` for a check constraint. The values are our own constants. */
function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`
}

// ---------------------------------------------------------------- accounts

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    /** An avatar id from the built-in set, and a color name from the theme. */
    avatar: text('avatar').notNull().default('chip'),
    avatarColor: text('avatar_color').notNull().default('violet'),
    role: text('role', { enum: ROLES }).notNull().default('player'),
    theme: text('theme').notNull().default('midnight'),
    soundVolume: smallint('sound_volume').notNull().default(70),
    soundMuted: boolean('sound_muted').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    disabledAt: ts('disabled_at'),
  },
  (t) => [
    uniqueIndex('users_username_lower_key').on(sql`lower(${t.username})`),
    check('users_role_check', oneOf(t.role, ROLES)),
    check('users_sound_volume_check', sql`${t.soundVolume} between 0 and 100`),
  ],
)

export const sessions = pgTable(
  'sessions',
  {
    id: bigId('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** sha256 of the cookie token. The token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

export const inviteCodes = pgTable(
  'invite_codes',
  {
    code: text('code').primaryKey(),
    kind: text('kind', { enum: INVITE_KINDS }).notNull().default('invite'),
    /** For a reset code: the player whose password it resets. */
    targetUserId: uuid('target_user_id').references(() => users.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    usedBy: uuid('used_by').references(() => users.id),
    usedAt: ts('used_at'),
  },
  (t) => [
    check('invite_codes_kind_check', oneOf(t.kind, INVITE_KINDS)),
    check(
      'invite_codes_reset_target_check',
      sql`${t.kind} <> 'reset' or ${t.targetUserId} is not null`,
    ),
    check('invite_codes_used_check', sql`(${t.usedBy} is null) = (${t.usedAt} is null)`),
  ],
)

// ---------------------------------------------------------------- seasons and chips

export const seasons = pgTable(
  'seasons',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    name: text('name').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    startingBalance: chips('starting_balance').notNull(),
    status: text('status', { enum: SEASON_STATUSES }).notNull().default('scheduled'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('seasons_window_check', sql`${t.endsAt} > ${t.startsAt}`),
    check('seasons_starting_balance_check', sql`${t.startingBalance} > 0`),
    check('seasons_status_check', oneOf(t.status, SEASON_STATUSES)),
  ],
)

export const wallets = pgTable(
  'wallets',
  {
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    balance: chips('balance').notNull().default(0n),
    vault: chips('vault').notNull().default(0n),
    /** The player's purchased Rank. Written only by the economy lane. */
    tier: text('tier', { enum: TIERS }).notNull().default('base'),
    /** When the current net worth was reached. Breaks leaderboard ties. */
    netWorthAt: ts('net_worth_at').notNull().defaultNow(),
    /**
     * When the work, third (`hustle`) and crime buttons can next be pressed
     * (spec: Work and crime). Null means now. Compared with now() inside the
     * transaction that locks this row, and written only by the economy lane.
     */
    workReadyAt: ts('work_ready_at'),
    hustleReadyAt: ts('hustle_ready_at'),
    crimeReadyAt: ts('crime_ready_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.seasonId, t.userId] }),
    check('wallets_balance_check', sql`${t.balance} >= 0`),
    check('wallets_vault_check', sql`${t.vault} >= 0`),
    check('wallets_tier_check', oneOf(t.tier, TIERS)),
  ],
)

/** Foreign key from (season_id, <player column>) to the player's wallet. */
function walletKey(name: string, seasonId: AnyPgColumn, userId: AnyPgColumn) {
  return foreignKey({
    name,
    columns: [seasonId, userId],
    foreignColumns: [wallets.seasonId, wallets.userId],
  })
}

export const ledger = pgTable(
  'ledger',
  {
    id: bigId('id').primaryKey().generatedAlwaysAsIdentity(),
    seasonId: integer('season_id').notNull(),
    userId: uuid('user_id').notNull(),
    account: text('account', { enum: LEDGER_ACCOUNTS }).notNull(),
    delta: chips('delta').notNull(),
    balanceAfter: chips('balance_after').notNull(),
    /** One of LEDGER_REASONS in shared/ledger.ts. */
    reason: text('reason').notNull(),
    /** What caused it, such as ('game_round', '42') or ('steal', '7'). */
    refType: text('ref_type'),
    refId: text('ref_id'),
    meta: jsonb('meta'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    walletKey('ledger_wallet_fk', t.seasonId, t.userId),
    index('ledger_wallet_idx').on(t.seasonId, t.userId, t.id),
    index('ledger_ref_idx').on(t.refType, t.refId),
    check('ledger_account_check', oneOf(t.account, LEDGER_ACCOUNTS)),
    check('ledger_delta_check', sql`${t.delta} <> 0`),
    check('ledger_balance_after_check', sql`${t.balanceAfter} >= 0`),
  ],
)

// ---------------------------------------------------------------- games

export const sharedRounds = pgTable(
  'shared_rounds',
  {
    id: bigId('id').primaryKey().generatedAlwaysAsIdentity(),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id),
    game: text('game').notNull(),
    roundNo: bigId('round_no').notNull(),
    /** Game-defined, such as betting, spinning, settled. */
    state: text('state').notNull(),
    opensAt: ts('opens_at').notNull(),
    closesAt: ts('closes_at').notNull(),
    /** Public result, saved when it is drawn. */
    result: jsonb('result'),
    /** Hidden until the reveal (a crash point). Never sent to a browser. */
    secret: jsonb('secret'),
    settledAt: ts('settled_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [unique('shared_rounds_round_key').on(t.seasonId, t.game, t.roundNo)],
)

export const gameRounds = pgTable(
  'game_rounds',
  {
    id: bigId('id').primaryKey().generatedAlwaysAsIdentity(),
    seasonId: integer('season_id').notNull(),
    userId: uuid('user_id').notNull(),
    game: text('game').notNull(),
    status: text('status', { enum: ROUND_STATUSES }).notNull().default('open'),
    stake: chips('stake').notNull(),
    payout: chips('payout'),
    /** For display only. Payouts are computed in bigint chips. */
    multiplier: numeric('multiplier', { precision: 14, scale: 4 }),
    /** Public JSON, enough to replay the round. Each game exports its type. */
    detail: jsonb('detail')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Hidden JSON. Cleared at settle. Never in a response or live event. */
    secret: jsonb('secret'),
    /** One line for the ticker and History, such as "Heads". Set at settle. */
    summary: text('summary'),
    /** The stake was at least big_bet_pct of net worth when it was placed, or all-in. */
    bigBet: boolean('big_bet').notNull().default(false),
    /** The stake emptied the wallet. A won all-in is celebrated like a 10x win. */
    allIn: boolean('all_in').notNull().default(false),
    /**
     * Counts the round's changes (start 0, each action and the settle add 1),
     * so browsers can tell newer room news from older (shared/rounds.ts).
     */
    steps: integer('steps').notNull().default(0),
    /** The player's last move. An open round idle past round_timeout_minutes is finished for them. */
    actedAt: ts('acted_at').notNull().defaultNow(),
    sharedRoundId: bigId('shared_round_id').references(() => sharedRounds.id),
    startedAt: ts('started_at').notNull().defaultNow(),
    settledAt: ts('settled_at'),
  },
  (t) => [
    walletKey('game_rounds_wallet_fk', t.seasonId, t.userId),
    // One open round per player per game (spec: The room model).
    uniqueIndex('game_rounds_one_open_key')
      .on(t.seasonId, t.userId, t.game)
      .where(sql`${t.status} = 'open'`),
    index('game_rounds_feed_idx').on(t.seasonId, t.settledAt),
    index('game_rounds_player_idx').on(t.seasonId, t.userId, t.startedAt),
    index('game_rounds_shared_idx').on(t.sharedRoundId),
    // Finding open rounds left idle, game by game.
    index('game_rounds_idle_idx')
      .on(t.game, t.actedAt)
      .where(sql`${t.status} = 'open'`),
    check('game_rounds_steps_check', sql`${t.steps} >= 0`),
    check('game_rounds_status_check', oneOf(t.status, ROUND_STATUSES)),
    check('game_rounds_stake_check', sql`${t.stake} >= 0`),
    check('game_rounds_payout_check', sql`${t.payout} is null or ${t.payout} >= 0`),
    check('game_rounds_settled_check', sql`(${t.status} = 'open') = (${t.settledAt} is null)`),
    check('game_rounds_secret_check', sql`${t.status} = 'open' or ${t.secret} is null`),
  ],
)

// ---------------------------------------------------------------- daily limits, steals, shields

export const dailyState = pgTable(
  'daily_state',
  {
    seasonId: integer('season_id').notNull(),
    userId: uuid('user_id').notNull(),
    /** From gameDay(): the day that starts at 4:00 AM Central. */
    gameDay: date('game_day', { mode: 'string' }).notNull(),
    bonusClaimed: boolean('bonus_claimed').notNull().default(false),
    streak: integer('streak').notNull().default(0),
    stealAttemptsUsed: integer('steal_attempts_used').notNull().default(0),
    /** The Shop's extra steal attempt, at most one per game day. */
    extraStealBought: boolean('extra_steal_bought').notNull().default(false),
    stolenToday: chips('stolen_today').notNull().default(0n),
    netWorthAtReset: chips('net_worth_at_reset'),
    vaultMoved: boolean('vault_moved').notNull().default(false),
    /** At most one Rank purchase per game day. */
    tierBought: boolean('tier_bought').notNull().default(false),
    challenges: jsonb('challenges')
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (t) => [
    primaryKey({ columns: [t.seasonId, t.userId, t.gameDay] }),
    walletKey('daily_state_wallet_fk', t.seasonId, t.userId),
    check('daily_state_counts_check', sql`${t.streak} >= 0 and ${t.stealAttemptsUsed} >= 0`),
    check('daily_state_stolen_check', sql`${t.stolenToday} >= 0`),
  ],
)

export const steals = pgTable(
  'steals',
  {
    id: bigId('id').primaryKey().generatedAlwaysAsIdentity(),
    seasonId: integer('season_id').notNull(),
    thiefId: uuid('thief_id').notNull(),
    targetId: uuid('target_id').notNull(),
    gameDay: date('game_day', { mode: 'string' }).notNull(),
    outcome: text('outcome', { enum: STEAL_OUTCOMES }).notNull(),
    amount: chips('amount').notNull().default(0n),
    fine: chips('fine').notNull().default(0n),
    thiefRank: integer('thief_rank').notNull(),
    targetRank: integer('target_rank').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    walletKey('steals_thief_wallet_fk', t.seasonId, t.thiefId),
    walletKey('steals_target_wallet_fk', t.seasonId, t.targetId),
    index('steals_thief_idx').on(t.seasonId, t.thiefId, t.gameDay),
    index('steals_target_idx').on(t.seasonId, t.targetId, t.createdAt),
    check('steals_outcome_check', oneOf(t.outcome, STEAL_OUTCOMES)),
    check('steals_self_check', sql`${t.thiefId} <> ${t.targetId}`),
    check('steals_amounts_check', sql`${t.amount} >= 0 and ${t.fine} >= 0`),
  ],
)

export const shields = pgTable(
  'shields',
  {
    seasonId: integer('season_id').notNull(),
    userId: uuid('user_id').notNull(),
    charges: integer('charges').notNull().default(0),
    immuneUntil: ts('immune_until'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.seasonId, t.userId] }),
    walletKey('shields_wallet_fk', t.seasonId, t.userId),
    check('shields_charges_check', sql`${t.charges} >= 0`),
  ],
)

export const shieldPurchases = pgTable(
  'shield_purchases',
  {
    id: bigId('id').primaryKey().generatedAlwaysAsIdentity(),
    seasonId: integer('season_id').notNull(),
    userId: uuid('user_id').notNull(),
    price: chips('price').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    walletKey('shield_purchases_wallet_fk', t.seasonId, t.userId),
    index('shield_purchases_player_idx').on(t.seasonId, t.userId, t.createdAt),
    check('shield_purchases_price_check', sql`${t.price} > 0`),
  ],
)

// ---------------------------------------------------------------- social, config, audit

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: bigId('id').primaryKey().generatedAlwaysAsIdentity(),
    /** Empty for system posts. */
    userId: uuid('user_id').references(() => users.id),
    kind: text('kind', { enum: CHAT_KINDS }).notNull().default('player'),
    body: text('body').notNull(),
    /**
     * For system posts: what happened, such as a round or a steal, for
     * styling and links. For GIFs: Klipy's id and URLs (GifMeta). For cards:
     * the game and the round (CardMeta).
     */
    meta: jsonb('meta'),
    createdAt: ts('created_at').notNull().defaultNow(),
    deletedAt: ts('deleted_at'),
    deletedBy: uuid('deleted_by').references(() => users.id),
  },
  (t) => [
    index('chat_messages_created_idx').on(t.createdAt),
    check('chat_messages_kind_check', oneOf(t.kind, CHAT_KINDS)),
    check(
      'chat_messages_player_check',
      sql`${t.kind} <> 'player' or (${t.userId} is not null and char_length(${t.body}) between 1 and ${sql.raw(String(CHAT_MAX_LENGTH))})`,
    ),
    // A GIF is someone's message with Klipy's id and URLs in meta (shared/chat.ts).
    check(
      'chat_messages_gif_check',
      sql`${t.kind} <> 'gif' or (${t.userId} is not null and ${t.meta} is not null and char_length(${t.body}) <= ${sql.raw(String(CHAT_MAX_LENGTH))})`,
    ),
    // A card names its game, and shows one round or one shared round (shared/chat.ts).
    check(
      'chat_messages_card_check',
      sql`${t.kind} <> 'card' or (${t.meta} ->> 'game') is not null`,
    ),
    uniqueIndex('chat_messages_card_round_key')
      .on(sql`(${t.meta} ->> 'roundId')`)
      .where(sql`${t.kind} = 'card'`),
    uniqueIndex('chat_messages_card_shared_key')
      .on(sql`(${t.meta} ->> 'sharedRoundId')`)
      .where(sql`${t.kind} = 'card'`),
  ],
)

/**
 * Tunable values. A key can have several rows: the one in force is the latest
 * with effective_at <= now(), so a change can be scheduled for the next daily
 * reset and shown on the Audit page ahead of time. Defaults live in code.
 */
export const config = pgTable(
  'config',
  {
    id: bigId('id').primaryKey().generatedAlwaysAsIdentity(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    description: text('description'),
    effectiveAt: ts('effective_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('config_key_idx').on(t.key, t.effectiveAt)],
)

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigId('id').primaryKey().generatedAlwaysAsIdentity(),
    actorId: uuid('actor_id').references(() => users.id),
    action: text('action').notNull(),
    target: text('target'),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    seasonId: integer('season_id').references(() => seasons.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_created_idx').on(t.createdAt)],
)

export const seasonResults = pgTable(
  'season_results',
  {
    seasonId: integer('season_id').notNull(),
    userId: uuid('user_id').notNull(),
    finalRank: integer('final_rank').notNull(),
    finalNetWorth: chips('final_net_worth').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.seasonId, t.userId] }),
    walletKey('season_results_wallet_fk', t.seasonId, t.userId),
    unique('season_results_rank_key').on(t.seasonId, t.finalRank),
  ],
)

/** One point per player per hour, written when chips move (no timers). */
export const netWorthSnapshots = pgTable(
  'net_worth_snapshots',
  {
    seasonId: integer('season_id').notNull(),
    userId: uuid('user_id').notNull(),
    /** The start of the hour. */
    at: ts('at').notNull(),
    netWorth: chips('net_worth').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.seasonId, t.userId, t.at] }),
    walletKey('net_worth_snapshots_wallet_fk', t.seasonId, t.userId),
  ],
)

// ---------------------------------------------------------------- request safety

/**
 * Replay protection (spec rule 5). The row is inserted in the same
 * transaction as the work, so a repeated key waits for the first request and
 * then returns its saved response.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    key: text('key').notNull(),
    /** Which action used the key, such as coinflip:play. */
    scope: text('scope').notNull(),
    response: jsonb('response'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index('idempotency_keys_created_idx').on(t.createdAt),
    check('idempotency_keys_key_check', sql`char_length(${t.key}) between 8 and 100`),
  ],
)

/**
 * Fixed-window counters. `subject` is a user id for per-user limits, or a
 * lowercased username for login throttling.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    bucket: text('bucket').notNull(),
    subject: text('subject').notNull(),
    windowStart: ts('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.bucket, t.subject, t.windowStart] }),
    index('rate_limits_window_idx').on(t.windowStart),
  ],
)
