// Astro-parity island prop serialization.
//
// Props travel to the browser in the `props` attribute of <deshi-island> as a
// JSON object whose *values* are typed tuples `[type, payload]`. The encoding
// matches Astro's runtime/server/serialize.ts exactly, so Date, RegExp, Map,
// Set, BigInt, URL, typed arrays, ±Infinity and undefined survive the HTML
// round-trip instead of degrading through plain JSON.stringify.
//
// `reviveProps` is the client half. It is self-contained on purpose: the island
// prescript inlines this function's source with toString(), so it must not
// reference anything from module scope.

const PROP_TYPE = {
  Value: 0,
  JSON: 1, // arrays
  RegExp: 2,
  Date: 3,
  Map: 4,
  Set: 5,
  BigInt: 6,
  URL: 7,
  Uint8Array: 8,
  Uint16Array: 9,
  Uint32Array: 10,
  Infinity: 11,
} as const;

export interface SerializeMetadata {
  /** component display name, for the cycle error message (Astro parity) */
  displayName?: string;
  /** hydration directive, for the cycle error message (Astro parity) */
  hydrate?: string;
}

function cycleError(metadata: SerializeMetadata): Error {
  return new Error(
    `Cyclic reference detected while serializing props for <${metadata.displayName} client:${metadata.hydrate}>!\n\n` +
      'Cyclic references cannot be safely serialized for client-side usage. Please remove the cyclic reference.',
  );
}

function serializeArray(
  value: unknown[],
  metadata: SerializeMetadata,
  parents: WeakSet<object>,
): unknown[] {
  if (parents.has(value)) throw cycleError(metadata);
  parents.add(value);
  const serialized = value.map((v) => convertToSerializedForm(v, metadata, parents));
  parents.delete(value);
  return serialized;
}

function serializeObject(
  value: object,
  metadata: SerializeMetadata,
  parents: WeakSet<object>,
): Record<string, unknown> {
  if (parents.has(value)) throw cycleError(metadata);
  parents.add(value);
  const serialized = Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, convertToSerializedForm(v, metadata, parents)]),
  );
  parents.delete(value);
  return serialized;
}

function convertToSerializedForm(
  value: unknown,
  metadata: SerializeMetadata,
  parents: WeakSet<object>,
): [number] | [number, unknown] {
  const tag = Object.prototype.toString.call(value);
  switch (tag) {
    case '[object Date]':
      return [PROP_TYPE.Date, (value as Date).toISOString()];
    case '[object RegExp]':
      return [PROP_TYPE.RegExp, (value as RegExp).source];
    case '[object Map]':
      return [PROP_TYPE.Map, serializeArray(Array.from(value as Map<unknown, unknown>), metadata, parents)];
    case '[object Set]':
      return [PROP_TYPE.Set, serializeArray(Array.from(value as Set<unknown>), metadata, parents)];
    case '[object BigInt]':
      return [PROP_TYPE.BigInt, (value as bigint).toString()];
    case '[object URL]':
      return [PROP_TYPE.URL, (value as URL).toString()];
    case '[object Array]':
      return [PROP_TYPE.JSON, serializeArray(value as unknown[], metadata, parents)];
    case '[object Uint8Array]':
      return [PROP_TYPE.Uint8Array, Array.from(value as Uint8Array)];
    case '[object Uint16Array]':
      return [PROP_TYPE.Uint16Array, Array.from(value as Uint16Array)];
    case '[object Uint32Array]':
      return [PROP_TYPE.Uint32Array, Array.from(value as Uint32Array)];
    default: {
      if (value !== null && typeof value === 'object') {
        return [PROP_TYPE.Value, serializeObject(value, metadata, parents)];
      }
      if (value === Number.POSITIVE_INFINITY) return [PROP_TYPE.Infinity, 1];
      if (value === Number.NEGATIVE_INFINITY) return [PROP_TYPE.Infinity, -1];
      if (value === undefined) return [PROP_TYPE.Value];
      return [PROP_TYPE.Value, value];
    }
  }
}

/** Serialize a props object for the `props` attribute of <deshi-island>. */
export function serializeProps(props: Record<string, unknown>, metadata: SerializeMetadata = {}): string {
  return JSON.stringify(serializeObject(props, metadata, new WeakSet()));
}

/** Revive `props` serialized by {@link serializeProps} — Astro's top-down revive
 * (JSON.parse revivers are bottom-up, which loses type information). */
export function reviveProps(raw: unknown): Record<string, unknown> {
  const propTypes: Record<string, (value: unknown) => unknown> = {
    0: (value) => reviveObject(value),
    1: (value) => reviveArray(value),
    2: (value) => new RegExp(String(value)),
    3: (value) => new Date(String(value)),
    4: (value) => new Map(reviveArray(value) as Array<[unknown, unknown]>),
    5: (value) => new Set(reviveArray(value)),
    6: (value) => BigInt(String(value)),
    7: (value) => new URL(String(value)),
    8: (value) => new Uint8Array(value as number[]),
    9: (value) => new Uint16Array(value as number[]),
    10: (value) => new Uint32Array(value as number[]),
    11: (value) => Number.POSITIVE_INFINITY * (value as number),
  };
  const reviveTuple = (tuple: unknown): unknown => {
    const [type, value] = tuple as [string, unknown];
    return type in propTypes ? propTypes[type](value) : undefined;
  };
  const reviveArray = (value: unknown): unknown[] => (value as unknown[]).map(reviveTuple);
  const reviveObject = (value: unknown): unknown => {
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, reviveTuple(val)]));
  };
  return reviveObject(raw) as Record<string, unknown>;
}
