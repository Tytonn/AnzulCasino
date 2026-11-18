/**
 * Invite and reset codes (spec: Accounts). Only an admin creates them. A
 * reset code lets one player choose a new password; creating one is written
 * to the public audit log, because it would let the admin into that account.
 */
import { desc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { inviteCodes, users } from '../../db/schema/core.ts'
import type { CreateInviteInput, InviteCodeView } from '../../shared/accounts.ts'
import { writeAudit } from '../lib/audit.ts'
import { db } from '../lib/db.ts'
import { notFound } from '../lib/errors.ts'
import { randomCode } from '../lib/rng.ts'

export async function createCode(
  actorId: string,
  input: CreateInviteInput,
): Promise<InviteCodeView> {
  return db().transaction(async (tx) => {
    let target: { id: string; username: string } | null = null
    if (input.kind === 'reset') {
      const [found] = await tx
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(sql`lower(${users.username}) = ${input.username.toLowerCase()}`)
      if (!found) throw notFound(`There is no player called ${input.username}.`)
      target = found
    }

    const code = randomCode()
    const [row] = await tx
      .insert(inviteCodes)
      .values({ code, kind: input.kind, targetUserId: target?.id ?? null, createdBy: actorId })
      .returning()
    if (target) {
      await writeAudit(tx, { actorId, action: 'reset_code.created', target: target.username })
    }
    return {
      code,
      kind: input.kind,
      forUsername: target?.username ?? null,
      createdAt: (row?.createdAt ?? new Date()).toISOString(),
      usedBy: null,
      usedAt: null,
    }
  })
}

export async function listCodes(): Promise<InviteCodeView[]> {
  const usedBy = alias(users, 'used_by_user')
  const target = alias(users, 'target_user')
  const rows = await db()
    .select({
      code: inviteCodes.code,
      kind: inviteCodes.kind,
      createdAt: inviteCodes.createdAt,
      usedAt: inviteCodes.usedAt,
      usedBy: usedBy.username,
      forUsername: target.username,
    })
    .from(inviteCodes)
    .leftJoin(usedBy, eq(usedBy.id, inviteCodes.usedBy))
    .leftJoin(target, eq(target.id, inviteCodes.targetUserId))
    .orderBy(desc(inviteCodes.createdAt))
    .limit(100)
  return rows.map((r) => ({
    code: r.code,
    kind: r.kind,
    forUsername: r.forUsername,
    createdAt: r.createdAt.toISOString(),
    usedBy: r.usedBy,
    usedAt: r.usedAt?.toISOString() ?? null,
  }))
}
