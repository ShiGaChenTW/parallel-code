import { describe, expect, it } from 'vitest';

import {
  protoFields,
  protoPath,
  protoString,
  protoSubMessage,
  protoVarints,
} from './protobuf-scan.js';

// --------------------------------------------------------------------------
// Encoders, test-side only.
//
// Deliberately written out rather than imported from the reader: a test that
// encodes with the same code it decodes with proves only that the function is
// its own inverse. These follow the published wire format directly.
// --------------------------------------------------------------------------

function varint(value: number): number[] {
  const out: number[] = [];
  let remaining = value;
  do {
    const byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    out.push(remaining > 0 ? byte | 0x80 : byte);
  } while (remaining > 0);
  return out;
}

function tag(field: number, wire: number): number[] {
  return varint(field * 8 + wire);
}

function varintField(field: number, value: number): number[] {
  return [...tag(field, 0), ...varint(value)];
}

function bytesField(field: number, payload: readonly number[]): number[] {
  return [...tag(field, 2), ...varint(payload.length), ...payload];
}

function stringField(field: number, text: string): number[] {
  return bytesField(field, [...Buffer.from(text, 'utf8')]);
}

function buf(...parts: readonly number[][]): Uint8Array {
  return Uint8Array.from(parts.flat());
}

describe('protoVarints', () => {
  it('reads varint fields by number', () => {
    const message = buf(varintField(2, 18026), varintField(3, 125), varintField(5, 0));
    const values = protoVarints(message);
    expect(values.get(2)).toBe(18026);
    expect(values.get(3)).toBe(125);
    expect(values.get(5)).toBe(0);
  });

  it('distinguishes a zero field from an absent one', () => {
    // The drift check depends on this: a row that reports a breakdown of zero
    // is checkable, a row that reports none is not.
    const values = protoVarints(buf(varintField(9, 0)));
    expect(values.get(9)).toBe(0);
    expect(values.has(10)).toBe(false);
  });

  it('reads multi-byte varints correctly', () => {
    for (const value of [127, 128, 300, 16383, 16384, 1_000_000, 2_147_483_648, 1e12]) {
      expect(protoVarints(buf(varintField(1, value))).get(1)).toBe(value);
    }
  });

  it('does not wrap values above the 32-bit boundary', () => {
    // A `<<`-based reader silently truncates here, which would be invisible in
    // a token total until it was wildly wrong.
    const big = 4_294_967_296 + 12345;
    expect(protoVarints(buf(varintField(1, big))).get(1)).toBe(big);
  });

  it('rejects a varint too large to represent exactly', () => {
    // Ten 0xFF-ish bytes: larger than Number.MAX_SAFE_INTEGER, so returning a
    // rounded value would be a wrong number that looks plausible.
    const oversized = [0x08, ...Array<number>(9).fill(0xff), 0x7f];
    expect(protoVarints(Uint8Array.from(oversized)).has(1)).toBe(false);
  });

  it('ignores length-delimited fields', () => {
    const values = protoVarints(buf(varintField(1, 7), stringField(2, 'hello')));
    expect([...values.keys()]).toEqual([1]);
  });
});

describe('protoSubMessage and protoPath', () => {
  it('extracts a nested message', () => {
    const inner = varintField(3, 42);
    const message = buf(bytesField(1, inner));
    const got = protoSubMessage(message, 1);
    expect(got).not.toBeNull();
    expect(protoVarints(got as Uint8Array).get(3)).toBe(42);
  });

  it('follows a chain of fields', () => {
    // The shape Antigravity uses: gen_metadata.data -> 1 -> 4 -> stats.
    const stats = varintField(2, 500);
    const message = buf(bytesField(1, bytesField(4, stats)));
    const got = protoPath(message, 1, 4);
    expect(protoVarints(got as Uint8Array).get(2)).toBe(500);
  });

  it('returns null when any step of the path is missing', () => {
    const message = buf(bytesField(1, varintField(9, 1)));
    expect(protoPath(message, 1, 4)).toBeNull();
    expect(protoPath(message, 7)).toBeNull();
  });

  it('lets the last occurrence win, as protobuf specifies', () => {
    const message = buf(bytesField(1, varintField(2, 1)), bytesField(1, varintField(2, 2)));
    expect(protoVarints(protoSubMessage(message, 1) as Uint8Array).get(2)).toBe(2);
  });
});

describe('protoString', () => {
  it('decodes UTF-8, including non-ASCII', () => {
    const message = buf(stringField(7, 'file:///Users/scottchen/專案/工作區'));
    expect(protoString(message, 7)).toBe('file:///Users/scottchen/專案/工作區');
  });

  it('returns null for an absent or empty field', () => {
    expect(protoString(buf(stringField(7, '')), 7)).toBeNull();
    expect(protoString(buf(stringField(7, 'x')), 8)).toBeNull();
  });
});

describe('malformed input', () => {
  it('yields nothing for an empty buffer', () => {
    expect([...protoFields(new Uint8Array(0))]).toEqual([]);
  });

  it('stops at a truncated varint instead of throwing', () => {
    // Continuation bit set on the final byte: there is no next byte.
    expect(() => [...protoFields(Uint8Array.from([0x08, 0xff]))]).not.toThrow();
    expect([...protoFields(Uint8Array.from([0x08, 0xff]))]).toEqual([]);
  });

  it('stops when a length-delimited field runs past the buffer', () => {
    // Field 1, wire 2, claims 50 bytes but only 2 follow.
    const truncated = Uint8Array.from([0x0a, 50, 1, 2]);
    expect([...protoFields(truncated)]).toEqual([]);
    expect(protoSubMessage(truncated, 1)).toBeNull();
  });

  it('keeps the fields it read before hitting damage', () => {
    // A whole good field, then a length that overruns. Partial data beats none.
    const partial = Uint8Array.from([...varintField(2, 99), 0x1a, 40, 7]);
    expect(protoVarints(partial).get(2)).toBe(99);
  });

  it('stops on field number zero rather than looping', () => {
    expect([...protoFields(Uint8Array.from([0x00, 0x01]))]).toEqual([]);
  });

  it('stops on a group wire type', () => {
    expect([...protoFields(Uint8Array.from([0x0b, 0x08, 0x01]))]).toEqual([]);
  });

  it('skips fixed-width fields without misreading what follows', () => {
    const message = buf(
      [...tag(4, 5), 1, 2, 3, 4],
      [...tag(5, 1), 1, 2, 3, 4, 5, 6, 7, 8],
      varintField(6, 77),
    );
    expect(protoVarints(message).get(6)).toBe(77);
  });

  it('does not throw on arbitrary bytes', () => {
    for (let seed = 0; seed < 200; seed++) {
      const bytes = Uint8Array.from({ length: 32 }, (_, i) => (seed * 31 + i * 17) % 256);
      expect(() => {
        protoVarints(bytes);
        protoSubMessage(bytes, 1);
        protoPath(bytes, 1, 4);
        protoString(bytes, 7);
      }).not.toThrow();
    }
  });
});
