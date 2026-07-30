// A reader for the parts of the protobuf wire format this app actually needs.
//
// Antigravity stores its generation metadata as protobuf blobs inside SQLite,
// and protobuf on the wire carries field *numbers*, not field names — which is
// why `grep -i token` over those files finds nothing while the counters sit
// right there. Names for them were recovered from the getters in the `agy` Go
// binary; nothing here depends on those names, only on the numbers.
//
// No library is used because none would help. Google publishes no `.proto` for
// this format, so a descriptor-driven decoder such as `protobufjs` would have
// nothing to be driven by: the descriptors exist only inside that binary. What
// is needed is the wire format itself, which is small enough to read directly.
//
// Every function returns null (or stops iterating) on input it cannot make
// sense of rather than throwing. These blobs are an undocumented format that
// may change with any CLI release, and one unreadable record must never cost a
// whole database's worth of counts.

/** Wire types. Groups (3 and 4) were removed from proto3 and are not handled. */
const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

/** Varints are at most 10 bytes; anything longer is malformed. */
const MAX_VARINT_BYTES = 10;

interface Varint {
  value: number;
  next: number;
}

/**
 * Reads a base-128 varint.
 *
 * Accumulates by multiplication rather than by `<<`, because JavaScript's
 * bitwise operators coerce to 32 bits and would silently wrap a counter above
 * ~2.1 billion — the exact failure a token total is most likely to reach. A
 * value beyond `Number.MAX_SAFE_INTEGER` is rejected outright instead of being
 * rounded, since a rounded token count is a wrong number that looks right.
 */
function readVarint(buf: Uint8Array, pos: number): Varint | null {
  let value = 0;
  let multiplier = 1;
  for (let i = 0; i < MAX_VARINT_BYTES; i++) {
    if (pos >= buf.length) return null;
    const byte = buf[pos++];
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) {
      return Number.isSafeInteger(value) ? { value, next: pos } : null;
    }
    multiplier *= 128;
  }
  return null;
}

export interface ProtoField {
  field: number;
  wire: number;
  /** Set for varint and fixed-width fields. */
  value: number;
  /** Set for length-delimited fields (submessages, strings, bytes). */
  bytes: Uint8Array | null;
}

/**
 * Walks the top-level fields of one protobuf message.
 *
 * Stops silently at the first thing it cannot parse. A truncated or misread
 * buffer therefore yields the fields it did understand and then ends, which is
 * what lets a caller keep partial data instead of losing the record — the same
 * bias the JSONL readers take with a line they do not recognise.
 */
export function* protoFields(buf: Uint8Array): Generator<ProtoField> {
  let pos = 0;
  while (pos < buf.length) {
    const tag = readVarint(buf, pos);
    if (tag === null) return;
    pos = tag.next;

    const field = tag.value >>> 3;
    const wire = tag.value & 7;
    // Field number 0 is not legal and is the usual sign of reading past the end
    // of a message into unrelated bytes.
    if (field === 0) return;

    if (wire === WIRE_VARINT) {
      const v = readVarint(buf, pos);
      if (v === null) return;
      yield { field, wire, value: v.value, bytes: null };
      pos = v.next;
    } else if (wire === WIRE_LENGTH_DELIMITED) {
      const len = readVarint(buf, pos);
      if (len === null) return;
      const end = len.next + len.value;
      if (end > buf.length) return;
      yield { field, wire, value: 0, bytes: buf.subarray(len.next, end) };
      pos = end;
    } else if (wire === WIRE_FIXED64) {
      if (pos + 8 > buf.length) return;
      yield { field, wire, value: 0, bytes: null };
      pos += 8;
    } else if (wire === WIRE_FIXED32) {
      if (pos + 4 > buf.length) return;
      yield { field, wire, value: 0, bytes: null };
      pos += 4;
    } else {
      // Deprecated group wire types, or garbage. Either way, stop.
      return;
    }
  }
}

/**
 * The length-delimited payload of one field, or null when it is absent.
 *
 * The last occurrence wins, which is what protobuf itself specifies for a
 * repeated appearance of a non-repeated field.
 */
export function protoSubMessage(buf: Uint8Array, field: number): Uint8Array | null {
  let found: Uint8Array | null = null;
  for (const entry of protoFields(buf)) {
    if (entry.field === field && entry.bytes !== null) found = entry.bytes;
  }
  return found;
}

/** Follows a chain of nested submessages, e.g. `1` then `4`. */
export function protoPath(buf: Uint8Array, ...fields: readonly number[]): Uint8Array | null {
  let current: Uint8Array | null = buf;
  for (const field of fields) {
    if (current === null) return null;
    current = protoSubMessage(current, field);
  }
  return current;
}

/**
 * Every varint field in a message, keyed by field number.
 *
 * Returning the whole set rather than one field at a time means a record is
 * walked once no matter how many counters are read out of it, and it lets a
 * caller tell "the field was zero" from "the field was not there" — which is
 * what the drift check in `token-usage-parse` depends on.
 */
export function protoVarints(buf: Uint8Array): Map<number, number> {
  const values = new Map<number, number>();
  for (const entry of protoFields(buf)) {
    if (entry.wire === WIRE_VARINT) values.set(entry.field, entry.value);
  }
  return values;
}

/** A UTF-8 string field, or null when absent or empty. */
export function protoString(buf: Uint8Array, field: number): string | null {
  const bytes = protoSubMessage(buf, field);
  if (bytes === null || bytes.length === 0) return null;
  return Buffer.from(bytes).toString('utf8');
}
