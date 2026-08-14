/**
 * The synthetic user that owns seed layouts, created by migration 0002.
 *
 * Fixed rather than looked up so #18's seeder and any future tooling can
 * reference it without a query, and so it is identical on every install.
 */
export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';

/** Visibility states that are absent from every public read path. */
export const NON_PUBLIC_VISIBILITIES = ['hidden', 'deleted'] as const;
