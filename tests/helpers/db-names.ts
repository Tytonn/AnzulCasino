import { databaseName, withDatabase } from '../../scripts/db/local.ts'

export function templateUrl(testUrl: string): string {
  return withDatabase(testUrl, `${databaseName(testUrl)}_template`)
}
