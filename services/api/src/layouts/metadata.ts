/**
 * Validation for the fields that describe a layout but are not part of
 * `layout.json` itself — title, description, tags. Shared by `submit.ts`
 * (`POST`) and `manage.ts` (`PATCH`), so the two can never drift on what
 * counts as a valid tag.
 */

import { SLUG_RE } from '@pixel-index/layout-core';

import { ApiError } from '../errors.js';

export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 24; // matches meta.schema.json's tag maxLength
export const MAX_TITLE_LENGTH = 60;
export const MAX_DESCRIPTION_LENGTH = 300;

/** The core check, shared by both input shapes below. */
export function validateTagNames(rawNames: string[]): string[] {
  const names = [...new Set(rawNames.map((t) => t.trim()).filter((t) => t.length > 0))];

  if (names.length > MAX_TAGS) {
    throw ApiError.validation(
      [{ code: 'meta.schema', path: '/tags', message: `at most ${MAX_TAGS} tags, got ${names.length}` }],
      'Too many tags.',
    );
  }
  const issues = names
    .filter((name) => !SLUG_RE.test(name) || name.length > MAX_TAG_LENGTH)
    .map((name) => ({
      code: 'meta.schema' as const,
      path: '/tags',
      message: `tag "${name}" must be lowercase kebab-case (a-z, 0-9, hyphen), max ${MAX_TAG_LENGTH} characters`,
    }));
  if (issues.length > 0) throw ApiError.validation(issues, 'One or more tags are invalid.');

  return names;
}

/** `submit.ts`'s shape: `tags=a,b,c` in a query string. */
export function parseAndValidateTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return validateTagNames(raw.split(','));
}

/** Postgres/PGlite unique-violation, optionally narrowed to one constraint. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as { code?: unknown; constraint?: unknown; cause?: unknown };
  const code = err.code ?? (err.cause as { code?: unknown } | undefined)?.code;
  if (code !== '23505') return false;
  if (!constraint) return true;
  const actualConstraint =
    err.constraint ?? (err.cause as { constraint?: unknown } | undefined)?.constraint;
  return actualConstraint === constraint;
}
