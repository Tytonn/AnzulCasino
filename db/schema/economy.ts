/**
 * The economy lane's tables (spec: Economy > Ranks and Giveaways). Everything
 * else the lane keeps lives in core tables it owns columns of: `wallets.tier`
 * and the `*_ready_at` cooldowns, `daily_state` (the bonus, the streak, the
 * challenges, the rank bought today), `seasons.status` and `season_results`.
 *
 * Chip amounts are bigint hundredths; times are timestamptz compared with the
 * database's now().
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { chatMessages, seasons, wallets } from './core.ts'

const chips = (name: string) => bigint(name, { mode: 'bigint' })
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })
const bigId = (name: string) => bigint(name, { mode: 'number' })

/**
 * One row per player per season, made on their first Collect, rank purchase
 * or button press.
 */
export const economyPlayers = pgTable(
  'economy_players',
  {
    seasonId: integer('season_id').notNull(),
    userId: uuid('user_id').notNull(),
    /**
     * When rank income was last collected. Null until the first collect:
     * income builds from the player's start in the season.
     */
    collectedAt: ts('collected_at'),
    /**
     * Grows by one with every change the player makes to their economy. The
     * `economy.changed` event carries it, so other tabs can tell news from
     * what they already fetched.
     */
    version: bigId('version').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.seasonId, t.userId] }),
    foreignKey({
      name: 'economy_players_wallet_fk',
      columns: [t.seasonId, t.userId],
      foreignColumns: [wallets.seasonId, wallets.userId],
    }),
    check('economy_players_version_check', sql`${t.version} >= 0`),
  ],
)

/**
 * Chat drops (spec: Giveaways). The next drop waits as a row with only its
 * time set; nobody can see that time, and it lands on the first request
 * after it. Landing sets the pot and the winners from the config then, posts
 * it in chat, and schedules the next one.
 */
export const economyDrops = pgTable(
  'economy_drops',
  {
    id: bigId('id').primaryKey().generatedAlwaysAsIdentity(),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id),
    /** When it lands. Hidden: no response or live event carries it. */
    appearsAt: ts('appears_at').notNull(),
    /** The whole pot, split evenly between the winners. Set when it lands. */
    pot: chips('pot').notNull().default(0n),
    /** How many players can claim a share. Set when it lands. */
    winners: integer('winners').notNull().default(1),
    /** The chat post that announced it. */
    messageId: bigId('message_id').references(() => chatMessages.id),
    /** When it landed. Null while it waits. */
    postedAt: ts('posted_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    // One drop waiting per season.
    uniqueIndex('economy_drops_waiting_key')
      .on(t.seasonId)
      .where(sql`${t.postedAt} is null`),
    index('economy_drops_posted_idx').on(t.seasonId, t.postedAt),
    check('economy_drops_pot_check', sql`${t.pot} >= 0`),
    check('economy_drops_winners_check', sql`${t.winners} > 0`),
  ],
)

/** Who grabbed a share of which drop: one share per player per drop. */
export const economyDropClaims = pgTable(
  'economy_drop_claims',
  {
    dropId: bigId('drop_id')
      .notNull()
      .references(() => economyDrops.id),
    seasonId: integer('season_id').notNull(),
    userId: uuid('user_id').notNull(),
    amount: chips('amount').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.dropId, t.userId] }),
    foreignKey({
      name: 'economy_drop_claims_wallet_fk',
      columns: [t.seasonId, t.userId],
      foreignColumns: [wallets.seasonId, wallets.userId],
    }),
    check('economy_drop_claims_amount_check', sql`${t.amount} > 0`),
  ],
)

/**
 * Chat posts that go out once per season, such as each rank unlock, the
 * final day and the end. The row is the proof it went out, so two requests
 * at the same moment cannot both post.
 */
export const economyAnnouncements = pgTable(
  'economy_announcements',
  {
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id),
    /** Such as unlock:silver, final_day or ended. */
    key: text('key').notNull(),
    /** The post, or null when it was skipped as too old to be news. */
    messageId: bigId('message_id').references(() => chatMessages.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.key] })],
)
