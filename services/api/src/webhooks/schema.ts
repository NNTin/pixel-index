/**
 * The versioned contract delivered to webhook subscribers.
 *
 * The JSON Schema is the runtime and external authority. These TypeScript
 * types give #91's event construction and delivery code a checked shape while
 * keeping the schema usable by receivers that do not use TypeScript.
 *
 * The schema lives outside `src/` for the same reason layout-core's schemas do:
 * it is a contract artifact, not generated build output. The relative path is
 * identical from `src/webhooks` under vitest and `dist/webhooks` after `tsc`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Layout } from '@pixel-index/layout-core';

export const SHARE_EVENT_TYPE = 'layout.shared' as const;
export const SHARE_EVENT_SCHEMA_VERSION = 1 as const;

export interface ShareEventOwner {
  /** Absent only for a legacy credited layout with no linked Discord account. */
  discordId?: string;
  username: string;
  displayName: string;
}

export type ShareEventPublication =
  | { published: true; url: string }
  | { published: false };

export interface ShareEventDataV1 {
  sharerDiscordId: string;
  owner: ShareEventOwner;
  /** The full layout.json snapshot, never a slug or fetch reference. */
  layout: Layout;
  publication: ShareEventPublication;
}

export interface ShareEventV1 {
  eventId: string;
  eventType: typeof SHARE_EVENT_TYPE;
  schemaVersion: typeof SHARE_EVENT_SCHEMA_VERSION;
  occurredAt: string;
  subscriptionId: string;
  data: ShareEventDataV1;
}

const API_SCHEMA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../schema',
);

export const SHARE_EVENT_V1_SCHEMA_PATH = path.join(
  API_SCHEMA_DIR,
  'share-event-v1.schema.json',
);

export const shareEventV1Schema = JSON.parse(
  fs.readFileSync(SHARE_EVENT_V1_SCHEMA_PATH, 'utf-8'),
) as Record<string, unknown>;
