import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Layout, layoutSchema, withFormats } from '@pixel-index/layout-core';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  SHARE_EVENT_SCHEMA_VERSION,
  SHARE_EVENT_TYPE,
  type ShareEventV1,
  shareEventV1Schema,
} from './schema.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

const layout: Layout = {
  version: 1,
  layoutRevision: 1,
  cols: 2,
  rows: 2,
  tiles: [0, 0, 0, 0],
  furniture: [],
};

const publishedEvent: ShareEventV1 = {
  eventId: 'a75fc4d8-d0f7-4b26-9c6d-3329f9fc2834',
  eventType: SHARE_EVENT_TYPE,
  schemaVersion: SHARE_EVENT_SCHEMA_VERSION,
  occurredAt: '2026-08-15T12:34:56.000Z',
  subscriptionId: '46fe73a0-8c49-438f-a6df-bb5d3290551a',
  data: {
    sharerDiscordId: '1528094749993599038',
    owner: {
      discordId: '77488778255540224',
      username: 'layout-owner',
      displayName: 'Layout Owner',
    },
    layout,
    publication: {
      published: true,
      url: 'https://api.example.com/api/v1/layouts/four-rooms',
    },
  },
};

const ajv = withFormats(new Ajv2020({ allErrors: true, strict: false }));
ajv.addSchema(layoutSchema);
const validate = ajv.compile(shareEventV1Schema);

function candidate(): Record<string, unknown> {
  return structuredClone(publishedEvent) as unknown as Record<string, unknown>;
}

function child(object: Record<string, unknown>, property: string): Record<string, unknown> {
  const value = object[property];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${property} is not an object in the test fixture`);
  }
  return value as Record<string, unknown>;
}

function expectValid(value: unknown): void {
  const valid = validate(value);
  expect(validate.errors).toBeNull();
  expect(valid).toBe(true);
}

describe('share-event-v1 JSON Schema', () => {
  it('uses the repository id and compiles with the referenced layout schema', () => {
    expect(shareEventV1Schema.$id).toBe(
      'https://github.com/pixel-agents-hq/index/services/api/schema/share-event-v1.schema.json',
    );
    expect(validate.schema).toBe(shareEventV1Schema);
  });

  it('accepts a published event', () => {
    expectValid(publishedEvent);
  });

  it('accepts an unpublished event and an unlinked legacy owner without null placeholders', () => {
    const value = candidate();
    const data = child(value, 'data');
    data.publication = { published: false };
    Reflect.deleteProperty(child(data, 'owner'), 'discordId');

    expectValid(value);
  });

  it.each([
    [
      'a missing envelope field',
      () => {
        const value = candidate();
        Reflect.deleteProperty(value, 'eventId');
        return value;
      },
    ],
    [
      'an invalid event UUID',
      () => {
        const value = candidate();
        value.eventId = 'not-a-uuid';
        return value;
      },
    ],
    [
      'an invalid timestamp',
      () => {
        const value = candidate();
        value.occurredAt = 'yesterday';
        return value;
      },
    ],
    [
      'an unknown envelope field',
      () => {
        const value = candidate();
        value.deliverySecret = 'must-never-be-delivered';
        return value;
      },
    ],
    [
      'an invalid sharer Discord id',
      () => {
        const value = candidate();
        child(value, 'data').sharerDiscordId = 'pablodelucca';
        return value;
      },
    ],
    [
      'an unknown event-data field',
      () => {
        const value = candidate();
        child(value, 'data').secret = 'must-never-be-delivered';
        return value;
      },
    ],
    [
      'a null owner Discord id instead of omission',
      () => {
        const value = candidate();
        child(child(value, 'data'), 'owner').discordId = null;
        return value;
      },
    ],
    [
      'published without a URL',
      () => {
        const value = candidate();
        child(value, 'data').publication = { published: true };
        return value;
      },
    ],
    [
      'unpublished with a URL',
      () => {
        const value = candidate();
        child(value, 'data').publication = {
          published: false,
          url: 'https://api.example.com/api/v1/layouts/four-rooms',
        };
        return value;
      },
    ],
    [
      'an unpublished null URL',
      () => {
        const value = candidate();
        child(value, 'data').publication = { published: false, url: null };
        return value;
      },
    ],
    [
      'an invalid inline layout',
      () => {
        const value = candidate();
        const data = child(value, 'data');
        data.layout = { ...child(data, 'layout'), version: 2 };
        return value;
      },
    ],
  ])('rejects %s', (_label, makeCandidate) => {
    expect(validate(makeCandidate())).toBe(false);
    expect(validate.errors).not.toBeNull();
  });

  it('keeps the documentation example conformant with the source-of-truth schema', () => {
    const markdown = fs.readFileSync(path.join(REPO_ROOT, 'docs/webhooks.md'), 'utf-8');
    const match = /<!-- share-event-example:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- share-event-example:end -->/.exec(markdown);
    if (!match?.[1]) throw new Error('docs/webhooks.md is missing its marked JSON example');

    expectValid(JSON.parse(match[1]) as unknown);
  });
});
