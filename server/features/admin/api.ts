/**
 * The admin lane's API (spec: Admin and trust). Served by
 * netlify/functions/admin-api.ts; tests call `adminApi` directly.
 *
 * Every route here is for the admin except the Audit page's, which every
 * player can read. Everything that changes something carries an
 * Idempotency-Key, so a double click or a retried request acts once.
 * Invite codes, reset codes, creating a season and deleting chat messages
 * are the foundation's routes; the panel calls them as they are.
 */
import { z } from 'zod'

import {
  AdjustInput,
  AuditListInput,
  ConfigSaveInput,
  EditSeasonInput,
  EndSeasonInput,
  GiveawayInput,
  PlayerStatusInput,
} from '../../../shared/features/admin.ts'
import { db } from '../../lib/db.ts'
import { badRequest, conflict } from '../../lib/errors.ts'
import { createApi, route } from '../../lib/http.ts'
import { chipTransaction } from '../../lib/idempotency.ts'
import { currentSeason, runningSeason, type Season } from '../../lib/seasons.ts'
import { auditPage } from './audit.ts'
import { type Actor, adjustChips, giveChips } from './chips.ts'
import { configState, saveConfig } from './config.ts'
import { adminPlayers, disablePlayer, enablePlayer } from './players.ts'
import { editSeason, endSeasonEarly } from './seasons.ts'

const NoInput = z.strictObject({})

/** A burst of admin work is fine; a runaway loop is not. */
const WRITE_LIMIT = { limit: 60, windowSeconds: 60 }

function actorOf(user: { id: string; displayName: string }): Actor {
  return { id: user.id, displayName: user.displayName }
}

function playerParam(params: Record<string, string>): string {
  const parsed = z.uuid().safeParse(params.id)
  if (!parsed.success) throw badRequest('That is not a player.', 'not_a_player')
  return parsed.data
}

function seasonParam(params: Record<string, string>): number {
  const id = Number(params.id)
  if (!Number.isSafeInteger(id) || id <= 0)
    throw badRequest('That is not a season.', 'not_a_season')
  return id
}

/** Chips only move inside a running season (spec: Accounts and seasons). */
async function seasonForChips(): Promise<Season> {
  const season = await runningSeason()
  if (!season) {
    throw conflict('No season is running, so there are no chips to move.', 'no_season')
  }
  return season
}

export const adminRoutes = [
  // ---------------------------------------------------------------- players
  route({
    method: 'GET',
    path: '/api/admin/players',
    auth: 'admin',
    input: NoInput,
    async run() {
      const season = await currentSeason()
      const seasonId = season?.id ?? null
      return { seasonId, players: await adminPlayers(db(), seasonId) }
    },
  }),
  route({
    method: 'POST',
    path: '/api/admin/players/:id/disable',
    auth: 'admin',
    idempotent: true,
    input: PlayerStatusInput,
    limit: WRITE_LIMIT,
    async run(ctx) {
      const userId = playerParam(ctx.params)
      const season = await currentSeason()
      return chipTransaction(ctx, async (tx, afterCommit) => {
        const change = {
          actorId: ctx.user.id,
          userId,
          reason: ctx.input.reason,
          seasonId: season?.id ?? null,
        }
        return { player: await disablePlayer(tx, change, afterCommit) }
      })
    },
  }),
  route({
    method: 'POST',
    path: '/api/admin/players/:id/enable',
    auth: 'admin',
    idempotent: true,
    input: PlayerStatusInput,
    limit: WRITE_LIMIT,
    async run(ctx) {
      const userId = playerParam(ctx.params)
      const season = await currentSeason()
      return chipTransaction(ctx, async (tx, afterCommit) => {
        const change = {
          actorId: ctx.user.id,
          userId,
          reason: ctx.input.reason,
          seasonId: season?.id ?? null,
        }
        return { player: await enablePlayer(tx, change, afterCommit) }
      })
    },
  }),

  // ---------------------------------------------------------------- chips
  route({
    method: 'POST',
    path: '/api/admin/chips',
    auth: 'admin',
    idempotent: true,
    input: AdjustInput,
    limit: WRITE_LIMIT,
    async run(ctx) {
      const season = await seasonForChips()
      return chipTransaction(ctx, (tx, afterCommit) =>
        adjustChips(tx, season, actorOf(ctx.user), ctx.input, afterCommit),
      )
    },
  }),
  route({
    method: 'POST',
    path: '/api/admin/giveaways',
    auth: 'admin',
    idempotent: true,
    input: GiveawayInput,
    limit: { limit: 20, windowSeconds: 60 },
    async run(ctx) {
      const season = await seasonForChips()
      return chipTransaction(ctx, (tx, afterCommit) =>
        giveChips(tx, season, actorOf(ctx.user), ctx.input, afterCommit),
      )
    },
  }),

  // ---------------------------------------------------------------- settings
  route({
    method: 'GET',
    path: '/api/admin/config',
    auth: 'admin',
    input: NoInput,
    async run({ now }) {
      return configState(db(), now)
    },
  }),
  route({
    method: 'POST',
    path: '/api/admin/config',
    auth: 'admin',
    idempotent: true,
    input: ConfigSaveInput,
    limit: { limit: 30, windowSeconds: 60 },
    async run(ctx) {
      return chipTransaction(ctx, (tx, afterCommit) =>
        saveConfig(tx, ctx.user.id, ctx.input, ctx.now, afterCommit),
      )
    },
  }),

  // ---------------------------------------------------------------- seasons
  route({
    method: 'POST',
    path: '/api/admin/seasons/:id/end',
    auth: 'admin',
    idempotent: true,
    input: EndSeasonInput,
    limit: { limit: 10, windowSeconds: 60 },
    async run(ctx) {
      const id = seasonParam(ctx.params)
      // A season whose start time has passed starts first, so it ends with its chips given out.
      await runningSeason()
      return chipTransaction(ctx, (tx, afterCommit) =>
        endSeasonEarly(tx, actorOf(ctx.user), id, ctx.input, afterCommit),
      )
    },
  }),
  route({
    method: 'PATCH',
    path: '/api/admin/seasons/:id',
    auth: 'admin',
    idempotent: true,
    input: EditSeasonInput,
    limit: WRITE_LIMIT,
    async run(ctx) {
      const id = seasonParam(ctx.params)
      return chipTransaction(ctx, async (tx, afterCommit) => ({
        season: await editSeason(tx, actorOf(ctx.user), id, ctx.input, afterCommit),
      }))
    },
  }),

  // ---------------------------------------------------------------- the audit page
  route({
    method: 'GET',
    path: '/api/admin/audit',
    // Every player reads it (spec: Admin and trust > The audit page).
    auth: 'user',
    input: AuditListInput,
    async run({ input, now }) {
      return auditPage(db(), input, now)
    },
  }),
]

export const adminApi = createApi(adminRoutes)
