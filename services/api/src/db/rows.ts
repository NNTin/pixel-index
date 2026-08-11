/**
 * Reading the single row a by-key write returns.
 *
 * Drizzle types `.returning()` as `Promise<T[]>` unconditionally — there is no
 * per-call "this one touches exactly one row" type, and there cannot be, since
 * the builder does not know the predicate. So an insert of one `values()` row,
 * or an update matched on a primary key, hands back an array of length one that
 * the type says might be empty.
 *
 * Every call site used to answer that with `rows[0]!` or `const [row] = …; row!`.
 * The assertion is *usually* right and says nothing when it is not: the failure
 * shows up several frames later as "cannot read properties of undefined", with
 * no clue which write returned nothing. This says it at the point it happened,
 * which is the only reason it is worth a function.
 */
export function one<T>(rows: readonly T[]): T {
  const [row, ...rest] = rows;
  if (row === undefined || rest.length > 0) {
    throw new Error(`expected exactly one row, got ${rows.length}`);
  }
  return row;
}
