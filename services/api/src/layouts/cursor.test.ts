import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor } from './cursor.js';

describe('cursor round-trip', () => {
  it('encodes and decodes back to the same value', () => {
    const cursor = { sort: 'newest' as const, value: '2026-01-01T00:00:00.000Z', id: 'abc-123' };
    expect(decodeCursor(encodeCursor(cursor), 'newest')).toEqual(cursor);
  });

  it('round-trips a numeric sort value too', () => {
    const cursor = { sort: 'furniture' as const, value: 42, id: 'abc-123' };
    expect(decodeCursor(encodeCursor(cursor), 'furniture')).toEqual(cursor);
  });

  it('is opaque — not a bare base64 of JSON a client is meant to read', () => {
    // Not a hard requirement, just documents intent: the cursor should not be
    // something a client is expected to construct or parse themselves.
    const encoded = encodeCursor({ sort: 'newest', value: 'x', id: 'y' });
    expect(encoded).not.toContain('{');
  });
});

describe('decodeCursor — rejecting a mismatched or malformed cursor', () => {
  it('rejects a cursor minted for a different sort', () => {
    // Mixing cursors across sort orders would silently produce nonsense
    // pagination — comparing a furniture-count cursor value against a title
    // column, for instance.
    const cursor = encodeCursor({ sort: 'newest', value: 'x', id: 'y' });
    expect(decodeCursor(cursor, 'furniture')).toBeNull();
  });

  it('rejects garbage that is not valid base64url JSON', () => {
    expect(decodeCursor('not-a-cursor!!!', 'newest')).toBeNull();
  });

  it('rejects valid JSON missing a required field', () => {
    const bad = Buffer.from(JSON.stringify({ sort: 'newest', value: 'x' }), 'utf-8').toString(
      'base64url',
    );
    expect(decodeCursor(bad, 'newest')).toBeNull();
  });

  it('rejects a value that is neither string nor number', () => {
    const bad = Buffer.from(
      JSON.stringify({ sort: 'newest', value: { nested: true }, id: 'y' }),
      'utf-8',
    ).toString('base64url');
    expect(decodeCursor(bad, 'newest')).toBeNull();
  });

  it('rejects a non-object payload', () => {
    const bad = Buffer.from(JSON.stringify('just a string'), 'utf-8').toString('base64url');
    expect(decodeCursor(bad, 'newest')).toBeNull();
  });
});
