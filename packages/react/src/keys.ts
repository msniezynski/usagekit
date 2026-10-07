const identities = new WeakMap<object, number>();
const symbols = new Map<symbol, number>();
let next = 1;
export function identity(value: object): number {
  let id = identities.get(value);
  if (!id) {
    id = next++;
    identities.set(value, id);
  }
  return id;
}

/** Retain read data without copying opaque service ports or evaluating their getters. */
export function retainReadInput<T>(value: T): T {
  const copies = new WeakMap<object, object>();
  function copy(v: unknown): unknown {
    if (!v || typeof v !== "object") return v;
    const proto = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) return v;
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (Object.values(descriptors).some((d) => d.get || d.set || typeof d.value === "function"))
      return v;
    const retained = copies.get(v);
    if (retained) return retained;
    const result: Record<string, unknown> | unknown[] = Array.isArray(v)
      ? []
      : Object.create(proto);
    copies.set(v, result);
    for (const key of Object.keys(v))
      Object.defineProperty(result, key, {
        value: copy(descriptors[key]?.value),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    return Object.freeze(result);
  }
  return copy(value) as T;
}

/** Canonical structural keys for data; opaque ports and cyclic objects keep their identity. */
export function serialize(value: unknown): string {
  const seen = new Set<object>();
  function encode(v: unknown): unknown {
    if (typeof v === "bigint") return ["bigint", v.toString()];
    if (typeof v === "undefined") return ["undefined"];
    if (typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0)))
      return ["number", String(v)];
    if (typeof v === "symbol") {
      if (!symbols.has(v)) symbols.set(v, next++);
      return ["symbol", symbols.get(v)];
    }
    if (typeof v === "function") return ["identity", identity(v)];
    if (!v || typeof v !== "object") return v;
    const proto = Object.getPrototypeOf(v);
    if (seen.has(v) || (!Array.isArray(v) && proto !== Object.prototype && proto !== null))
      return ["identity", identity(v)];
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (Object.values(descriptors).some((d) => d.get || d.set || typeof d.value === "function"))
      return ["identity", identity(v)];
    seen.add(v);
    const result = Array.isArray(v)
      ? ["array", v.map(encode)]
      : [
          "object",
          Object.keys(v)
            .sort()
            .map((key) => [key, encode(descriptors[key]?.value)]),
        ];
    seen.delete(v);
    return result;
  }
  return JSON.stringify(encode(value));
}
