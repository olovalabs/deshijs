import { describe, expect, it } from 'vitest';
import { reviveProps, serializeProps } from '../serialize';

const roundTrip = (value: unknown) => reviveProps(JSON.parse(serializeProps({ value }))).value;

describe('serializeProps — Astro typed-tuple format', () => {
  it('wraps primitives in [0, value] tuples', () => {
    expect(serializeProps({ a: 1, b: 'x', c: true, d: null })).toBe(
      '{"a":[0,1],"b":[0,"x"],"c":[0,true],"d":[0,null]}',
    );
  });

  it('preserves undefined as a one-element tuple', () => {
    expect(serializeProps({ a: undefined })).toBe('{"a":[0]}');
    expect(roundTrip(undefined)).toBeUndefined();
    expect('a' in reviveProps(JSON.parse(serializeProps({ a: undefined })))).toBe(true);
  });

  it('round-trips dates, regexps, maps, sets, bigints and URLs', () => {
    const date = new Date('2024-03-01T12:00:00.000Z');
    expect(roundTrip(date)).toEqual(date);
    const re = /ab+c/g;
    // Astro parity: only the source survives — flags are dropped.
    expect((roundTrip(re) as RegExp).source).toBe('ab+c');
    expect(roundTrip(new Map([['k', 1]]))).toEqual(new Map([['k', 1]]));
    expect(roundTrip(new Set([1, 2]))).toEqual(new Set([1, 2]));
    expect(roundTrip(BigInt('9007199254740993'))).toBe(BigInt('9007199254740993'));
    expect(roundTrip(new URL('https://example.com/x'))).toEqual(new URL('https://example.com/x'));
  });

  it('round-trips typed arrays', () => {
    expect(roundTrip(new Uint8Array([1, 2, 3]))).toEqual(new Uint8Array([1, 2, 3]));
    expect(roundTrip(new Uint16Array([4, 5]))).toEqual(new Uint16Array([4, 5]));
    expect(roundTrip(new Uint32Array([6]))).toEqual(new Uint32Array([6]));
  });

  it('round-trips ±Infinity and degrades NaN to null (Astro parity)', () => {
    expect(roundTrip(Infinity)).toBe(Infinity);
    expect(roundTrip(-Infinity)).toBe(-Infinity);
    expect(roundTrip(NaN)).toBeNull();
  });

  it('serializes nested objects and arrays', () => {
    const value = { list: [1, { deep: 'x' }], when: new Date('2020-01-01T00:00:00.000Z') };
    expect(roundTrip(value)).toEqual(value);
  });

  it('throws on cyclic references like Astro', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => serializeProps({ a }, { displayName: 'Box', hydrate: 'load' })).toThrow(
      /Cyclic reference detected while serializing props for <Box client:load>/,
    );
  });

  it('revives unknown markers to undefined (forward compatibility)', () => {
    expect(reviveProps({ a: [99, 'x'] })).toEqual({ a: undefined });
  });
});
