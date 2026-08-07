/**
 * Keyset (cursor) pagination, not OFFSET.
 *
 * OFFSET silently skips or repeats rows when the underlying set changes
 * between page requests — a layout published while someone is browsing page 2
 * shifts everything after it. A cursor pins to a row, not a position:
 * `WHERE (sortColumn, id) < (cursorValue, cursorId)` is stable regardless of
 * what gets inserted elsewhere, because `id` makes the ordering total even
 * when two rows tie on the sort column itself (two layouts published in the
 * same second, two layouts with the same furniture count, …).
 */

export type SortKey = 'newest' | 'furniture' | 'largest' | 'title';

export interface Cursor {
  sort: SortKey;
  /** The sort column's value on the last row of the previous page. */
  value: string | number;
  /** Tiebreaker — the last row's id. */
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf-8').toString('base64url');
}

/** Returns `null` for anything malformed, or a cursor whose `sort` does not match. */
export function decodeCursor(raw: string, expectedSort: SortKey): Cursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('sort' in parsed) ||
    !('value' in parsed) ||
    !('id' in parsed)
  ) {
    return null;
  }
  const candidate = parsed as Cursor;
  if (candidate.sort !== expectedSort) return null;
  if (typeof candidate.value !== 'string' && typeof candidate.value !== 'number') return null;
  if (typeof candidate.id !== 'string') return null;
  return candidate;
}
