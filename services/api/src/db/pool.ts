/**
 * The narrow slice of `pg.Pool` the rest of the service is allowed to depend
 * on directly, outside of Drizzle.
 *
 * The readiness check (server.ts) only ever needs `query`. Depending on the
 * full `Pool` type there would still work, but it would let a test's stub
 * silently drift from what a real Pool actually looks like versus what is
 * actually used — this keeps the contract exactly as small as the real usage.
 */
export interface Queryable {
  query: (text: string) => Promise<unknown>;
}
