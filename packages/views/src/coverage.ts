import { formatQuantity } from "@usagekit/core";
import type { AccessContext, Meter, Quantity, UsagePage, UsageScope } from "@usagekit/core";
import { attempt, failure, plus, share } from "./amount.js";
import type { Problem, ViewState } from "./amount.js";

export const coverageStates = [
  "metered",
  "passthrough",
  "unpriced",
  "cached",
  "rate_limited",
] as const;
export type CoverageState = (typeof coverageStates)[number];
/**
 * Optional host-supplied counts. Without this port, coverage combines Meter usage and
 * its persistent non-operation request counters. Counter windows use whole UTC days.
 */
export type CoverageSource = {
  counts(scope: UsageScope, from: string, to: string): Promise<Record<CoverageState, bigint>>;
};
export type CoverageEntry = {
  state: CoverageState;
  count: string | "unavailable";
  /** Percent of the total, truncated to two fractional digits; null without a total. */
  share: string | null;
};
export type CoverageView = {
  state: ViewState;
  /** Where the counts came from: a CoverageSource, or the meter's usage and persistent counters. */
  origin: "source" | "meter";
  entries: readonly CoverageEntry[];
  total: string | null;
  /** True when some requests were not metered, so cost excludes them; null when unknown. */
  costExcludesUntracked: boolean | null;
  problem: Problem | null;
};
export type CoverageInput = {
  scope: UsageScope;
  from: string;
  to: string;
  source?: CoverageSource;
};

/** In-memory CoverageSource for tests and demos. */
export function createMemoryCoverageSource() {
  const entries: {
    namespace: string;
    principal: string;
    group?: string;
    platformPools?: readonly string[];
    state: CoverageState;
    at: string;
    count: bigint;
  }[] = [];
  return {
    add(entry: {
      namespace: string;
      principal: string;
      group?: string;
      platformPools?: readonly string[];
      state: CoverageState;
      at: string;
      count?: bigint;
    }) {
      entries.push({ ...entry, count: entry.count ?? 1n });
    },
    async counts(scope: UsageScope, from: string, to: string) {
      const totals = Object.fromEntries(coverageStates.map((s) => [s, 0n])) as Record<
        CoverageState,
        bigint
      >;
      for (const e of entries) {
        const at = Date.parse(e.at);
        if (e.namespace !== scope.namespace || at < Date.parse(from) || at >= Date.parse(to))
          continue;
        if (scope.kind === "principal" && e.principal !== scope.principal) continue;
        if (scope.kind === "group" && e.group !== scope.group) continue;
        if (scope.kind === "platform_pool" && !e.platformPools?.includes(scope.poolId)) continue;
        totals[e.state] += e.count;
      }
      return totals;
    },
  } satisfies CoverageSource & { add(entry: unknown): void };
}

/** Partition operation usage from unpriced paths without double counting. Unknown stays unavailable. */
async function meteredRequests(
  meter: Meter,
  access: AccessContext,
  input: CoverageInput,
  first: UsagePage,
): Promise<{ total: Quantity | null; unpriced: Quantity | null; rows: number } | Problem> {
  let page = first,
    total: Quantity | null = { value: 0n, scale: 0, unit: "requests" },
    unpriced: Quantity | null = { value: 0n, scale: 0, unit: "requests" },
    rows = 0;
  for (;;) {
    for (const row of page.rows) {
      rows++;
      const m = row.measurements.find((x) => x.unit === "requests");
      if (row.dimensions.operation === "unknown") {
        if (m?.certainty === "unknown") unpriced = null;
        else if (m && unpriced) unpriced = plus(unpriced, m.quantity);
      } else if (m?.certainty === "unknown") total = null;
      else if (m && total) total = plus(total, m.quantity);
    }
    if (!page.nextCursor) return { total, unpriced, rows };
    const cursor = page.nextCursor;
    const next = await attempt(() => meter.usage(access, { ...query(input), cursor }));
    if (next.outcome !== "ok")
      return next.outcome === "forbidden"
        ? { kind: "error", message: "forbidden while paging" }
        : next.problem;
    page = next.value;
  }
}
const query = (input: CoverageInput) => ({
  scope: input.scope,
  from: input.from,
  to: input.to,
  units: ["requests"],
  groupBy: ["operation"] as const,
  limit: 1000,
});

/**
 * Coverage of one scope and window. The meter read always runs first: it authorizes the scope
 * and, without a source, supplies the metered request count.
 */
export async function loadCoverageView(
  meter: Meter,
  access: AccessContext,
  input: CoverageInput,
): Promise<CoverageView> {
  const origin = input.source ? "source" : "meter";
  const blank = { origin, entries: [], total: null, costExcludesUntracked: null } as const;
  const first = await attempt(() => meter.usage(access, query(input)));
  if (first.outcome === "forbidden") return { ...blank, state: "forbidden", problem: null };
  if (first.outcome === "unavailable")
    return { ...blank, state: "unavailable", problem: first.problem };
  if (!input.source) {
    const metered = await meteredRequests(meter, access, input, first.value);
    if ("kind" in metered) return { ...blank, state: "unavailable", problem: metered };
    const counted = await attempt(() =>
      meter.requestCounts(access, {
        scope: input.scope,
        from: input.from,
        to: input.to,
        groupBy: [],
      }),
    );
    if (counted.outcome === "forbidden") return { ...blank, state: "forbidden", problem: null };
    if (counted.outcome === "unavailable")
      return { ...blank, state: "unavailable", problem: counted.problem };
    if (counted.value.truncated)
      return {
        ...blank,
        state: "unavailable",
        problem: { kind: "error", message: "Truncated request counts" },
      };
    const extra = Object.fromEntries(coverageStates.slice(1).map((state) => [state, 0n]));
    for (const row of counted.value.rows) extra[row.state] = (extra[row.state] ?? 0n) + row.count;
    const scale = Math.max(metered.total?.scale ?? 0, metered.unpriced?.scale ?? 0),
      factor = 10n ** BigInt(scale);
    const unpriced = metered.unpriced
      ? metered.unpriced.value * 10n ** BigInt(scale - metered.unpriced.scale)
      : 0n;
    const values = [
      metered.total ? metered.total.value * 10n ** BigInt(scale - metered.total.scale) : 0n,
      ...coverageStates
        .slice(1)
        .map((state) => (extra[state] ?? 0n) * factor + (state === "unpriced" ? unpriced : 0n)),
    ];
    const total = values.reduce((sum, value) => sum + value, 0n),
      known = metered.total !== null && metered.unpriced !== null;
    return {
      ...blank,
      state: total > 0n || metered.rows > 0 ? "ok" : "empty",
      entries: coverageStates.map((state, index) => ({
        state,
        count:
          (state === "metered" && metered.total === null) ||
          (state === "unpriced" && metered.unpriced === null)
            ? "unavailable"
            : formatQuantity({ value: values[index]!, scale, unit: "requests" }),
        share: known ? share(values[index]!, total) : null,
      })),
      total: known ? formatQuantity({ value: total, scale, unit: "requests" }) : null,
      costExcludesUntracked: known ? total > values[0]! : null,
      problem: null,
    };
  }
  let counts: Record<CoverageState, bigint>;
  try {
    counts = await input.source.counts(input.scope, input.from, input.to);
  } catch (error) {
    return { ...blank, state: "unavailable", problem: failure(error) };
  }
  const values = coverageStates.map((state) => counts[state] ?? 0n);
  const total = values.reduce((a, b) => a + b, 0n);
  return {
    origin,
    state: total === 0n ? "empty" : "ok",
    entries: coverageStates.map((state, i) => ({
      state,
      count: values[i]!.toString(),
      share: share(values[i]!, total),
    })),
    total: total.toString(),
    costExcludesUntracked: total > values[0]!,
    problem: null,
  };
}
