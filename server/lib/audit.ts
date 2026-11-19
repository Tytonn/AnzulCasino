/**
 * The public audit log (spec: Admin and trust). Every admin action that
 * touches chips, config, seasons or someone's account writes a row here, in
 * the same transaction as the action, and every player can read it.
 */
import { auditLog } from '../../db/schema/core.ts'
import type { Executor } from './db.ts'

export interface AuditEntry {
  actorId: string | null
  /** Such as season.created, config.changed, chips.adjusted, reset_code.created */
  action: string
  target?: string
  before?: unknown
  after?: unknown
  reason?: string
  seasonId?: number
}

export async function writeAudit(executor: Executor, entry: AuditEntry): Promise<void> {
  await executor.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    target: entry.target ?? null,
    before:
      entry.before === undefined ? null : JSON.parse(JSON.stringify(entry.before, bigintReplacer)),
    after:
      entry.after === undefined ? null : JSON.parse(JSON.stringify(entry.after, bigintReplacer)),
    reason: entry.reason ?? null,
    seasonId: entry.seasonId ?? null,
  })
}

function bigintReplacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value
}
