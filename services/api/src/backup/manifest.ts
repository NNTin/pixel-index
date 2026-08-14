/**
 * The zip-root `manifest.json` a backup export writes and an import reads
 * (#63) — same `schemaVersion`/`generatedAt` convention as `GET /api/v1/meta`
 * (`meta.ts`) and the list routes' response envelopes, so a backup is
 * self-describing the same way every other versioned shape in this API is.
 *
 * `seed/` itself deliberately carries no equivalent file (see #80's PR body):
 * it has no consumer for one — `seedIfEmpty()` globs directories rather than
 * reading an index, and it is git-tracked fixture data, not a generated
 * artifact. A backup zip is a different, freshly-generated thing each run,
 * which is exactly the case a manifest earns its keep for.
 */

export const BACKUP_SCHEMA_VERSION = 1;

export interface BackupManifest {
  schemaVersion: number;
  generatedAt: string;
  count: number;
}
