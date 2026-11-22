import { describe, expect, it } from 'vitest'

import { type DeployInfo, isUnpublishedProduction } from '../../../server/lib/deploy.ts'
import { isMissingSchema } from '../../../server/lib/pg-errors.ts'

describe('isUnpublishedProduction', () => {
  it('is only a production deploy that Netlify says is not the published one', () => {
    expect(isUnpublishedProduction({ context: 'production', id: 'main', published: false })).toBe(
      true,
    )

    expect(isUnpublishedProduction({ context: 'production', id: 'live', published: true })).toBe(
      false,
    )
    for (const context of ['deploy-preview', 'branch-deploy', 'dev']) {
      expect(isUnpublishedProduction({ context, id: 'x', published: false }), context).toBe(false)
    }
    // Unknown or missing: treated as the live site.
    expect(isUnpublishedProduction(undefined)).toBe(false)
    expect(isUnpublishedProduction(null)).toBe(false)
    expect(isUnpublishedProduction({ context: 'production', id: 'p' } as DeployInfo)).toBe(false)
  })
})

describe('isMissingSchema', () => {
  it('knows a missing table, column, type, function or schema, wrapped or not', () => {
    for (const code of ['42P01', '42703', '42704', '42883', '3F000']) {
      expect(isMissingSchema({ code }), code).toBe(true)
      // As Drizzle throws it: the driver's error as the cause.
      expect(isMissingSchema(Object.assign(new Error('Failed query'), { cause: { code } }))).toBe(
        true,
      )
    }
  })

  it('is not any other error', () => {
    for (const error of [
      { code: '23505' },
      { code: '40001' },
      { code: '57P01' },
      new Error('connection terminated'),
      undefined,
      'relation "users" does not exist',
    ]) {
      expect(isMissingSchema(error), JSON.stringify(error)).toBe(false)
    }
  })
})
