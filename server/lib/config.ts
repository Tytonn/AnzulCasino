/**
 * Reads and changes config (spec rule 9). Game code never hard-codes a
 * tunable number:
 *
 *   const cfg = await loadConfig(tx)
 *   if (stake < cfg.min_bet) ...
 *
 * A value is its default from shared/config.ts unless the admin changed it:
 * each change is a row in `config` with the moment it takes effect, and the
 * latest row whose moment has passed wins. "Passed" is decided by the
 * database clock inside the query (rule 8). Rows are never edited or
 * deleted, so the table is also the history of every change.
 */
import { desc, eq, gt, lte, sql } from 'drizzle-orm'

import { config } from '../../db/schema/core.ts'
import {
  type ConfigKey,
  type ConfigValue,
  type ConfigValues,
  configDefaults,
  configPair,
  configWireValue,
  formatConfigValue,
  isConfigKey,
  parseConfigValue,
  waitsForReset,
} from '../../shared/config.ts'
import { nextReset } from '../../shared/game-day.ts'
import { writeAudit } from './audit.ts'
import type { Executor, Tx } from './db.ts'
import { badRequest } from './errors.ts'

/** Every config value in effect right now. One small query. */
export async function loadConfig(executor: Executor): Promise<ConfigValues> {
  const changed = await executor
    .selectDistinctOn([config.key], { key: config.key, value: config.value })
    .from(config)
    .where(lte(config.effectiveAt, sql`now()`))
    .orderBy(config.key, desc(config.effectiveAt), desc(config.id))

  const values = configDefaults() as Record<ConfigKey, ConfigValue>
  for (const row of changed) {
    // A key removed from the defaults file, or a value outside today's
    // limits, falls back to the default rather than breaking every request.
    if (!isConfigKey(row.key)) continue
    const parsed = parseConfigValue(row.key, row.value)
    if (parsed.ok) values[row.key] = parsed.value
    else console.warn(`[config] ignoring stored ${row.key}: ${parsed.error}`)
  }
  return values as ConfigValues
}

export interface ConfigChange {
  key: string
  /** The wire form: a plain number (chips as hundredths), or a list of strings for lines. */
  value: unknown
  actorId: string
  /** Why, in the admin's words. Shown on the Audit page. */
  reason?: string
  /** Database time (`ctx.now`): changes that wait start at the next reset after it. */
  now: Date
}

/**
 * Schedules a change, writes it to the audit log, and returns when it takes
 * effect: at once, or at the next daily reset for the economy and steals.
 * For the admin lane's config editor.
 */
export async function changeConfig(tx: Tx, change: ConfigChange): Promise<{ effectiveAt: Date }> {
  if (!isConfigKey(change.key)) throw badRequest(`There is no setting called ${change.key}.`)
  const key = change.key
  const parsed = parseConfigValue(key, change.value)
  if (!parsed.ok) throw badRequest(parsed.error, 'invalid_config_value')

  const before = (await loadConfig(tx))[key]
  const pair = configPair(key)
  if (pair) await checkPair(tx, pair, key, parsed.value)

  const effectiveAt = waitsForReset(key) ? nextReset(change.now) : change.now
  await tx.insert(config).values({
    key,
    value: configWireValue(parsed.value),
    description: change.reason ?? null,
    effectiveAt,
    updatedBy: change.actorId,
  })
  await writeAudit(tx, {
    actorId: change.actorId,
    action: 'config.changed',
    target: key,
    before: { value: configWireValue(before) },
    after: { value: configWireValue(parsed.value), effectiveAt: effectiveAt.toISOString() },
    reason: change.reason,
  })
  return { effectiveAt }
}

/**
 * Refuses a minimum above its maximum. The other side is compared at its
 * newest scheduled value, which is what it will be once this change takes
 * effect: both sides of a pair share a group, so they wait for the same reset.
 */
async function checkPair(
  tx: Tx,
  [minKey, maxKey]: readonly [ConfigKey, ConfigKey],
  key: ConfigKey,
  value: ConfigValue,
): Promise<void> {
  const other = key === minKey ? maxKey : minKey
  const [latest] = await tx
    .select({ value: config.value })
    .from(config)
    .where(eq(config.key, other))
    .orderBy(desc(config.effectiveAt), desc(config.id))
    .limit(1)
  const parsed = latest ? parseConfigValue(other, latest.value) : null
  const otherValue = parsed?.ok ? parsed.value : configDefaults()[other]
  // Pairs are chips or whole numbers, never lines.
  const mine = BigInt(value as bigint | number)
  const theirs = BigInt(otherValue as bigint | number)
  const shown = formatConfigValue(other, otherValue)
  if (key === minKey && mine > theirs) {
    throw badRequest(
      `${minKey} cannot be more than ${maxKey}, which is ${shown}.`,
      'invalid_config_value',
    )
  }
  if (key === maxKey && mine < theirs) {
    throw badRequest(
      `${maxKey} cannot be less than ${minKey}, which is ${shown}.`,
      'invalid_config_value',
    )
  }
}

export interface PendingChange {
  key: string
  value: unknown
  effectiveAt: Date
  updatedBy: string | null
  reason: string | null
}

/** Changes that have not taken effect yet, soonest first. The Audit page lists them ahead of time. */
export async function pendingConfigChanges(executor: Executor): Promise<PendingChange[]> {
  return executor
    .select({
      key: config.key,
      value: config.value,
      effectiveAt: config.effectiveAt,
      updatedBy: config.updatedBy,
      reason: config.description,
    })
    .from(config)
    .where(gt(config.effectiveAt, sql`now()`))
    .orderBy(config.effectiveAt, config.id)
}
