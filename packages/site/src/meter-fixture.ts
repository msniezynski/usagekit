import { createManualClock, createMemoryStore } from "@usagekit/store";
import { createMeter } from "@usagekit/meter";
import { createMeterQueryClient } from "@usagekit/react";
import { formatMoney } from "@usagekit/core";
import type { AccessContext, Budget, Measurement, Meter, Receipt, Scope } from "@usagekit/core";

const namespace = "site-showcase";
const principal = "demo-workspace";
export const fixtureAccess: AccessContext = {
  namespace,
  readablePrincipals: [principal],
  readableGroups: [],
  readablePools: ["workspace-pool"],
  canReadBillingDetail: true,
  canManageBudgets: false,
};
export const owner = { kind: "principal", namespace, principal } as const;
export const fixturePeriod = { from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" };
export const budgetQuery = {
  scope: { namespace, principal, connection: "language-key" },
  surface: "app" as const,
  units: ["cents"],
};
export const summaryQuery = { scope: owner, ...fixturePeriod, units: ["requests", "cents"] };
export const usageQuery = {
  scope: owner,
  ...fixturePeriod,
  units: ["requests", "tokens", "cents"],
  groupBy: ["provider"] as const,
  limit: 10,
};
export const coverageQuery = { scope: owner, ...fixturePeriod };
export const exceptionsQuery = { scope: owner, ...fixturePeriod, limit: 5 };

export const providers = {
  search: {
    label: "Search API",
    connection: "search-key",
    fundingSource: "byok",
    costOwner: principal,
    operation: "lookup",
    platformPools: [],
  },
  language: {
    label: "Language model",
    connection: "language-key",
    fundingSource: "platform",
    costOwner: "platform",
    operation: "complete",
    platformPools: ["workspace-pool"],
  },
} as const;
export type ProviderName = keyof typeof providers;

/** A monthly $25.00 spend budget that blocks at the limit and alerts at 80%. */
export const spendBudget: Budget = {
  id: "monthly-spend",
  version: 1,
  scope: owner,
  surface: "any",
  unit: "cents",
  limit: { value: 2500n, scale: 0, unit: "cents" },
  onExceed: "block",
  alerts: [{ at: { percent: 80 } }],
  window: { kind: "calendar_month", timezone: "UTC" },
};
/** Every request reserves $1.50 before dispatch; receipts settle the exact provider cost. */
export const requestEstimate = 1_500_000n;
/** Whole-cent October history ($18.12): sub-cent digits appear only when a receipt brings them. */
const seedCosts: readonly [ProviderName, bigint][] = [
  ["search", 840_000n],
  ["language", 1_610_000n],
  ["search", 1_270_000n],
  ["language", 2_050_000n],
  ["search", 970_000n],
  ["language", 1_890_000n],
  ["search", 1_430_000n],
  ["language", 2_320_000n],
  ["search", 1_120_000n],
  ["language", 1_760_000n],
  ["language", 2_860_000n],
];
/** Settled costs for the sample's later requests and late evidence, in order. */
const requestCosts = [
  1_187_400n,
  941_200n,
  1_336_800n,
  1_052_600n,
  1_229_100n,
  887_300n,
  1_410_200n,
  995_600n,
] as const;
const coverageCounts = [
  ["cached", 3],
  ["passthrough", 1],
  ["rate_limited", 1],
] as const;

export type SiteEvent = {
  id: string;
  at: string;
  provider: ProviderName;
  status: "reserved" | "settled" | "pending" | "evidence" | "blocked";
  /** Exact cents text with four fractional digits. */
  estimate: string;
  actual: string | null;
};

const cents = (units: bigint) => ({ value: units, scale: 4, unit: "cents" });
/** Every Meter call waits for the seed, so no hook ever reads a half-seeded month. */
const gated = (meter: Meter, ready: () => Promise<void>): Meter =>
  new Proxy(meter, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      return typeof value === "function"
        ? async (...args: unknown[]) => {
            await ready();
            return value.apply(target, args);
          }
        : value;
    },
  });

/**
 * In-memory accounting for the website only: a real Store and Meter on a manual clock.
 * It never contacts a provider and never receives application credentials.
 */
export function createSiteMeterFixture() {
  const clock = createManualClock("2026-10-07T12:00:00.000Z");
  const store = createMemoryStore({ clock, budgets: [spendBudget] });
  const direct = createMeter({ store, clock });
  const meter = gated(direct, () => seed());
  const queryClient = createMeterQueryClient();
  let sequence = 0;
  let spent = 0;
  const now = () => clock.now().toISOString();
  const nextCost = () => requestCosts[spent++ % requestCosts.length] ?? requestEstimate;
  const ref = (operationId: string) => ({ namespace, principal, operationId });
  const receipt = (id: string, provider: ProviderName, units: bigint | null): Receipt => {
    const measurements: Measurement[] = [
      {
        unit: "requests",
        quantity: { value: 1n, scale: 0, unit: "requests" },
        certainty: "measured",
      },
      units === null
        ? { unit: "cents", quantity: null, certainty: "unknown" }
        : { unit: "cents", quantity: cents(units), certainty: "measured" },
    ];
    if (provider === "language" && units !== null)
      measurements.push({
        unit: "tokens",
        quantity: { value: units / 1_000n, scale: 0, unit: "tokens" },
        certainty: "estimated",
      });
    return {
      id,
      measurements,
      cost:
        units === null
          ? { certainty: "unknown", money: null }
          : { certainty: "measured", money: { units, currency: "USD" } },
      occurredAt: now(),
      recordedAt: now(),
      cached: false,
      failed: false,
    };
  };
  const reserve = async (provider: ProviderName, estimate: bigint) => {
    const id = `op_${String(++sequence).padStart(4, "0")}`;
    const p = providers[provider];
    const scope: Scope = { namespace, principal, connection: p.connection };
    const reserved = await store.reserve({
      operationId: id,
      scope,
      fundingSource: p.fundingSource,
      costOwner: p.costOwner,
      surface: "app",
      source: "app",
      provider,
      operation: p.operation,
      platformPools: [...p.platformPools],
      estimate: [cents(estimate), { value: 1n, scale: 0, unit: "requests" }],
    });
    return { id, reserved };
  };
  const dispatch = async (id: string, version: number) => {
    const grant = await store.markDispatchIntent({
      ...ref(id),
      commandId: `intent-${id}`,
      expectedVersion: version,
      holder: "site-fixture",
      leaseTtlMs: 60_000,
    });
    if (!("granted" in grant) || !grant.granted)
      throw Error("The sample dispatch was not granted.");
    return grant;
  };
  const settle = async (
    id: string,
    provider: ProviderName,
    grant: Awaited<ReturnType<typeof dispatch>>,
    units: bigint | null,
  ) => {
    const settled = await store.settle({
      ...ref(id),
      commandId: `settle-${id}`,
      expectedVersion: grant.operation.version,
      authority: { kind: "lease", leaseId: grant.lease.leaseId },
      receipt: receipt(`rcpt-${id}`, provider, units),
    });
    if (settled.outcome !== "settled") throw Error("The sample receipt could not be settled.");
    return settled.operation;
  };
  const invalidate = () => queryClient.invalidate(meter, fixtureAccess);

  let seeded: Promise<void> | null = null;
  /** Seeds October with settled requests and non-metered request counts, once per fixture. */
  const seed = () => (seeded ??= seedOnce());
  const seedOnce = async () => {
    for (const [provider, units] of seedCosts) {
      const { id, reserved } = await reserve(provider, units + 500_000n);
      if (reserved.outcome !== "reserved") throw Error("The sample seed was blocked.");
      await settle(id, provider, await dispatch(id, reserved.operation.version), units);
      clock.advance(37_000);
    }
    for (const [state, count] of coverageCounts)
      for (let index = 0; index < count; index++)
        await direct.countRequest({
          commandId: `count-${state}-${index}`,
          scope: { namespace, principal, connection: providers.search.connection },
          surface: "app",
          source: "app",
          provider: "search",
          operation: providers.search.operation,
          state,
        });
    invalidate();
  };

  type Started =
    | { kind: "blocked"; event: SiteEvent }
    | { kind: "dispatched"; event: SiteEvent; grant: Awaited<ReturnType<typeof dispatch>> };
  /** Reserves the estimate and takes the single dispatch grant, or reports the block. */
  const start = async (provider: ProviderName): Promise<Started> => {
    clock.advance(4_000);
    const { id, reserved } = await reserve(provider, requestEstimate);
    const event: SiteEvent = {
      id,
      at: now(),
      provider,
      status: "reserved",
      estimate: formatMoney({ units: requestEstimate, currency: "USD" }),
      actual: null,
    };
    if (reserved.outcome !== "reserved")
      return { kind: "blocked", event: { ...event, status: "blocked" } };
    const grant = await dispatch(id, reserved.operation.version);
    invalidate();
    return { kind: "dispatched", event, grant };
  };
  /** Settles a dispatched request from its receipt; unknown cost leaves it pending. */
  const finish = async (
    started: Extract<Started, { kind: "dispatched" }>,
    known: boolean,
  ): Promise<SiteEvent> => {
    clock.advance(1_000);
    const units = known ? nextCost() : null;
    await settle(started.event.id, started.event.provider, started.grant, units);
    invalidate();
    return {
      ...started.event,
      at: now(),
      status: known ? "settled" : "pending",
      actual: units === null ? null : formatMoney({ units, currency: "USD" }),
    };
  };
  /** Late provider evidence settles pending work without another dispatch. */
  const settleEvidence = async (event: SiteEvent): Promise<SiteEvent> => {
    clock.advance(9_000);
    const operation = await meter.getOperation(fixtureAccess, ref(event.id));
    if (operation.outcome !== "ok" || operation.value?.state !== "pending")
      throw Error("The sample operation is no longer pending.");
    const units = nextCost();
    const settled = await store.settle({
      ...ref(event.id),
      commandId: `evidence-${event.id}`,
      expectedVersion: operation.value.version,
      authority: { kind: "late_evidence", source: "provider-billing-export" },
      receipt: receipt(`evidence-${event.id}`, event.provider, units),
    });
    if (settled.outcome !== "settled") throw Error("The sample evidence could not be settled.");
    invalidate();
    return {
      ...event,
      at: now(),
      status: "evidence",
      actual: formatMoney({ units, currency: "USD" }),
    };
  };
  return { meter, queryClient, seed, start, finish, settleEvidence };
}

export type SiteMeterFixture = ReturnType<typeof createSiteMeterFixture>;
