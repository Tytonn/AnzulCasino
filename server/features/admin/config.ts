/**
 * The settings editor (spec: Admin panel > Config, and Work and crime names
 * and lines; the shell's command and stream settings). It reads every value
 * in force with who last changed it, and saves several changes in one
 * transaction through the foundation's changeConfig, which checks each value
 * and writes its audit row. Changes to the economy and steals wait for the
 * next daily reset and show as scheduled until then (spec: Admin and trust >
 * The audit page).
 */
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm'

import { auditLog, config, users } from '../../../db/schema/core.ts'
import {
  CONFIG_KEYS,
  type ConfigKey,
  configDefaults,
  configWireValue,
  isConfigKey,
  parseConfigValue,
} from '../../../shared/config.ts'
import type {
  AdminConfigState,
  ConfigSaveInput,
  ConfigSaveResponse,
  LastChangeView,
} from '../../../shared/features/admin.ts'
import { nextReset } from '../../../shared/game-day.ts'
import { changeConfig, loadConfig } from '../../lib/config.ts'
import type { Executor, Tx } from '../../lib/db.ts'
import { ApiError } from '../../lib/errors.ts'
import type { AfterCommit } from '../../lib/idempotency.ts'
import { type Outgoing, publish } from '../../lib/live.ts'
import { auditEvent, auditViews, pendingChanges, personColumns, sameValue } from './audit.ts'

/** Every setting in force, what is scheduled, and who last changed each one. */
export async function configState(executor: Executor, now: Date): Promise<AdminConfigState> {
  const values = await loadConfig(executor)
  const wire: Record<string, unknown> = {}
  for (const key of CONFIG_KEYS) wire[key] = configWireValue(values[key])

  const inForce = await executor
    .selectDistinctOn([config.key], {
      key: config.key,
      at: config.createdAt,
      effectiveAt: config.effectiveAt,
      updatedBy: config.updatedBy,
      reason: config.description,
    })
    .from(config)
    .where(lte(config.effectiveAt, sql`now()`))
    .orderBy(config.key, desc(config.effectiveAt), desc(config.id))
  const actorIds = [...new Set(inForce.map((r) => r.updatedBy).filter((id): id is string => !!id))]
  const actors = actorIds.length
    ? await executor.select(personColumns).from(users).where(inArray(users.id, actorIds))
    : []
  const byId = new Map(actors.map((a) => [a.id, a]))

  const changed: Record<string, LastChangeView> = {}
  for (const row of inForce) {
    if (!isConfigKey(row.key)) continue
    changed[row.key] = {
      at: row.at.toISOString(),
      effectiveAt: row.effectiveAt.toISOString(),
      by: (row.updatedBy && byId.get(row.updatedBy)) || null,
      reason: row.reason,
    }
  }

  return {
    values: wire,
    pending: await pendingChanges(executor),
    changed,
    nextReset: nextReset(now).toISOString(),
  }
}

/** The same refusal, now naming the setting, so the editor can show it on that row. */
function onKey(error: ApiError, key: string): ApiError {
  return new ApiError(error.status, error.code, error.message, { ...error.extra, key })
}

/**
 * Each key's newest scheduled value (in force, or waiting for the reset), in
 * its wire form: what a save compares against to skip a change that changes
 * nothing.
 */
async function newestValues(tx: Tx, keys: ConfigKey[]): Promise<Record<string, unknown>> {
  const defaults = configDefaults()
  const newest: Record<string, unknown> = {}
  for (const key of keys) newest[key] = configWireValue(defaults[key])
  const found = await tx
    .selectDistinctOn([config.key], { key: config.key, value: config.value })
    .from(config)
    .where(inArray(config.key, keys))
    .orderBy(config.key, desc(config.effectiveAt), desc(config.id))
  for (const row of found) {
    if (!isConfigKey(row.key)) continue
    const parsed = parseConfigValue(row.key, row.value)
    if (parsed.ok) newest[row.key] = configWireValue(parsed.value)
  }
  return newest
}

/**
 * Saves several settings at once. Each value is checked first, and a refusal
 * names its key. A value equal to what is already scheduled is skipped;
 * saving the value in force while a change waits for the reset takes that
 * change back.
 *
 * A minimum and its maximum, or two commands handing a word from one to the
 * other, depend on each other's order, so the changes are tried in turns:
 * one refused because of another change in this save is tried again after
 * it. Every change commits together or none does.
 */
export async function saveConfig(
  tx: Tx,
  actorId: string,
  input: ConfigSaveInput,
  now: Date,
  afterCommit: AfterCommit,
): Promise<ConfigSaveResponse> {
  const changes: { key: ConfigKey; value: unknown }[] = []
  for (const change of input.changes) {
    if (!isConfigKey(change.key)) {
      throw new ApiError(400, 'unknown_setting', `There is no setting called ${change.key}.`, {
        key: change.key,
      })
    }
    const parsed = parseConfigValue(change.key, change.value)
    if (!parsed.ok) {
      throw new ApiError(400, 'invalid_config_value', parsed.error, { key: change.key })
    }
    changes.push({ key: change.key, value: configWireValue(parsed.value) })
  }

  // One save at a time, so two tabs cannot pass each other's checks.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('anzul:config'))`)
  const newest = await newestValues(
    tx,
    changes.map((c) => c.key),
  )
  let waiting = changes.filter((c) => !sameValue(c.value, newest[c.key]))

  const saved: { key: string; effectiveAt: string }[] = []
  const news: Outgoing[] = []
  while (waiting.length > 0) {
    const refused: { key: ConfigKey; value: unknown; error: ApiError }[] = []
    for (const change of waiting) {
      try {
        const done = await changeConfig(tx, {
          key: change.key,
          value: change.value,
          actorId,
          reason: input.reason,
          now,
        })
        saved.push({ key: change.key, effectiveAt: done.effectiveAt.toISOString() })
        news.push(...done.news)
      } catch (error) {
        // Only the checks against other settings can still refuse; they
        // read and never write, so the transaction carries on.
        if (!(error instanceof ApiError) || error.code !== 'invalid_config_value') throw error
        refused.push({ ...change, error })
      }
    }
    if (refused.length === 0) break
    const first = refused[0] as (typeof refused)[number]
    if (refused.length === waiting.length) {
      // No order works, such as two commands trading words.
      const trade = refused.length > 1 && first.error.message.includes('already belongs to')
      throw onKey(
        trade
          ? new ApiError(
              400,
              first.error.code,
              `${first.error.message} Commands cannot trade words in one save, so take it off the other command and save that first.`,
            )
          : first.error,
        first.key,
      )
    }
    waiting = refused
  }

  if (saved.length > 0) {
    // changeConfig wrote one audit row per change; read them back for the Audit page.
    const rows = await tx
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'config.changed'),
          eq(auditLog.actorId, actorId),
          inArray(
            auditLog.target,
            saved.map((s) => s.key),
          ),
          // Rows from this transaction: created_at defaults to its now().
          sql`${auditLog.createdAt} = now()`,
        ),
      )
      .orderBy(auditLog.id)
    const entries = await auditViews(tx, rows)
    const events = [...news, ...entries.map(auditEvent)]
    afterCommit(() => publish(events))
  }

  return { state: await configState(tx, now), saved }
}
