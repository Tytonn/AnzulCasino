/**
 * Which deploy is answering a request: Netlify's `context.deploy`, which
 * routes get as `ctx.deploy`.
 *
 * Every production deploy uses the live database, published or not. With
 * auto publishing locked, each build of `main` is a production deploy that
 * opens by its own link before anyone publishes it, and Netlify applies its
 * migrations to the live database only when it is published. Until then the
 * live database can lack the tables that deploy's code reads, and before the
 * first publish it has none at all.
 */
export interface DeployInfo {
  /** Such as `production`, `deploy-preview`, `branch-deploy` or `dev`. */
  context: string
  id: string
  /** Whether this is the deploy the live site serves. */
  published: boolean
}

/** A production deploy opened by its own link: not the live site, but on its database. */
export function isUnpublishedProduction(deploy: DeployInfo | null | undefined): boolean {
  return deploy?.context === 'production' && deploy.published === false
}
