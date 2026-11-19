/**
 * Dropping old news (spec: Live events > Recovery). Every event carries the
 * version of the thing it describes, and fetched state carries the same
 * version, so a late event never undoes a newer fetch:
 *
 *   useLiveEvent(userChannel(me), 'wallet.updated', (wallet, { version }) => {
 *     queryClient.setQueryData(['season'], (old) =>
 *       old && isNewer(version, old.wallet?.version) ? { ...old, wallet: { ...wallet, version } } : old,
 *     )
 *   })
 */
export function isNewer(version: number, known: number | null | undefined): boolean {
  return known === null || known === undefined || version > known
}
