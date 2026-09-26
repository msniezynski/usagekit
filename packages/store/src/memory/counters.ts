import { requestStates } from "@usagekit/core";
import type {
  CountRequestInput,
  CountRequestResult,
  RequestCountRow,
  RequestCountsPage,
  RequestCountsQuery,
} from "@usagekit/core";
import { canonical, copy, InvalidInput, key } from "./state.js";
import type { State } from "./state.js";

/** Dimensions a request count can be grouped by. */
export const requestCountDimensions = ["provider", "operation", "connection", "source", "day"];
const dayMs = 86400000;

/** Throws InvalidInput for a malformed count; every adapter calls it before writing. */
export function validateCountRequest(i: CountRequestInput): void {
  for (const [field, value] of [
    ["commandId", i.commandId],
    ["scope.namespace", i.scope?.namespace],
    ["scope.principal", i.scope?.principal],
    ["scope.connection", i.scope?.connection],
    ["provider", i.provider],
    ["operation", i.operation],
  ] as const)
    if (typeof value !== "string" || !value.trim()) throw new InvalidInput(field, "empty string");
  if (!requestStates.includes(i.state)) throw new InvalidInput("state", "unknown request state");
}

/** Replay identity of a count: the whole input, pools sorted. */
export const countIdentity = (i: CountRequestInput) =>
  canonical({ ...i, platformPools: [...(i.platformPools ?? [])].sort() });

/**
 * Counts are daily UTC buckets, so a window must start and end at UTC midnight; a narrower
 * window would silently widen to whole days.
 */
export function validateRequestCountsQuery(q: RequestCountsQuery): void {
  const from = Date.parse(q.from),
    to = Date.parse(q.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to)
    throw new InvalidInput("window", "invalid time interval");
  if (from % dayMs !== 0 || to % dayMs !== 0)
    throw new InvalidInput("window", "request counts use whole UTC days");
  if (q.limit !== undefined && (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 1000))
    throw new InvalidInput("limit", "must be between 1 and 1000");
  if (q.groupBy.some((d) => !requestCountDimensions.includes(d)))
    throw new InvalidInput("groupBy", "unknown request count dimension");
}

/** One stored bucket: the counted fields and the UTC day. */
export type CountBucket = {
  namespace: string;
  principal: string;
  group: string;
  connection: string;
  pools: readonly string[];
  day: string;
  provider: string;
  operation: string;
  source: string;
  state: CountRequestInput["state"];
  count: bigint;
};

export const bucketOf = (i: CountRequestInput, now: Date): Omit<CountBucket, "count"> => ({
  namespace: i.scope.namespace,
  principal: i.scope.principal,
  group: i.scope.group ?? "",
  connection: i.scope.connection,
  pools: [...(i.platformPools ?? [])].sort(),
  day: now.toISOString().slice(0, 10),
  provider: i.provider,
  operation: i.operation,
  source: i.source,
  state: i.state,
});

export function bucketInScope(b: Omit<CountBucket, "count">, q: RequestCountsQuery): boolean {
  if (b.namespace !== q.scope.namespace || (q.connection && b.connection !== q.connection))
    return false;
  const day = Date.parse(`${b.day}T00:00:00.000Z`);
  if (day < Date.parse(q.from) || day >= Date.parse(q.to)) return false;
  switch (q.scope.kind) {
    case "namespace":
      return true;
    case "principal":
      return b.principal === q.scope.principal;
    case "group":
      return b.group === q.scope.group;
    case "platform_pool":
      return b.pools.includes(q.scope.poolId);
  }
}

/** Groups buckets into rows ordered by dimension values in groupBy order, then state. */
export function countRows(
  buckets: Iterable<CountBucket>,
  q: RequestCountsQuery,
  asOf: string,
): RequestCountsPage {
  const map = new Map<string, RequestCountRow & { order: string[] }>();
  for (const b of buckets) {
    if (!bucketInScope(b, q)) continue;
    const dimensions: Record<string, string> = {};
    for (const d of q.groupBy) dimensions[d] = b[d as keyof CountBucket] as string;
    const order = [...q.groupBy.map((d) => dimensions[d]!), b.state],
      k = canonical(order),
      prev = map.get(k);
    map.set(k, { dimensions, state: b.state, count: (prev?.count ?? 0n) + b.count, order });
  }
  const sorted = [...map.values()].sort((a, b) => compare(a.order, b.order)),
    limit = q.limit ?? 1000;
  return {
    rows: sorted.slice(0, limit).map(({ dimensions, state, count }) => ({
      dimensions,
      state,
      count,
    })),
    asOf,
    truncated: sorted.length > limit,
  };
}
function compare(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  return 0;
}

export function countRequest(s: State, i: CountRequestInput): CountRequestResult {
  validateCountRequest(i);
  const commandKey = key(i.scope.namespace, i.commandId),
    identity = countIdentity(i),
    commands = (s.requestCommands ??= new Map()),
    previous = commands.get(commandKey);
  if (previous !== undefined)
    return previous === identity
      ? { outcome: "counted", replayed: true }
      : { outcome: "conflict", reason: "command_mismatch" };
  if (s.operations.has(commandKey)) return { outcome: "conflict", reason: "command_mismatch" };
  const bucket = bucketOf(i, s.clock.now()),
    buckets = (s.requestBuckets ??= new Map()),
    bucketKey = canonical(bucket);
  buckets.set(bucketKey, { ...bucket, count: (buckets.get(bucketKey)?.count ?? 0n) + 1n });
  commands.set(commandKey, identity);
  return { outcome: "counted", replayed: false };
}

export function requestCounts(s: State, q: RequestCountsQuery): RequestCountsPage {
  validateRequestCountsQuery(q);
  return copy(countRows(s.requestBuckets?.values() ?? [], q, s.clock.now().toISOString()));
}
