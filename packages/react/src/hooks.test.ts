import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { createManualClock, createMemoryStore } from "@usagekit/store";
import { createMeter } from "@usagekit/meter";
import type {
  AccessContext,
  Budget,
  BudgetAlertCrossed,
  Meter,
  ReadResult,
  ReserveInput,
  UsagePage,
  UsageQuery,
} from "@usagekit/core";
import {
  MeterProvider,
  useBudgetsView,
  useCoverageView,
  useExceptionsView,
  useHeaderStatus,
  useUsageView,
} from "./index.js";

afterEach(cleanup);
const access: AccessContext = {
  namespace: "test",
  readablePrincipals: ["u1"],
  readableGroups: [],
  readablePools: [],
  canReadBillingDetail: true,
  canManageBudgets: false,
};
const scope = { namespace: "test", principal: "u1", connection: "c1" };
const month = { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" };
const usageQuery: UsageQuery = {
  scope: { kind: "principal", namespace: "test", principal: "u1" },
  ...month,
  units: ["requests"],
  groupBy: ["provider"],
};
const cap: Budget = {
  id: "cap",
  version: 1,
  scope: { kind: "principal", namespace: "test", principal: "u1" },
  surface: "any",
  unit: "requests",
  limit: { value: 10n, scale: 0, unit: "requests" },
  window: { kind: "calendar_month", timezone: "UTC" },
  onExceed: "block",
  alerts: [{ at: { percent: 50 } }],
};

function fixture(budgets: Budget[] = []) {
  const clock = createManualClock(),
    store = createMemoryStore({ clock, budgets }),
    meter = createMeter({ store, clock });
  const settle = async (overrides: Partial<ReserveInput> = {}) => {
    const r = await store.reserve({
      operationId: crypto.randomUUID(),
      scope,
      fundingSource: "byok",
      costOwner: "u1",
      surface: "app",
      source: "app",
      provider: "search",
      operation: "search",
      estimate: [{ value: 1n, scale: 0, unit: "requests" }],
      ...overrides,
    });
    if (r.outcome !== "reserved") throw new Error("fixture");
    const ref = { namespace: "test", principal: "u1", operationId: r.operation.operationId };
    const g = await store.markDispatchIntent({
      ...ref,
      commandId: crypto.randomUUID(),
      expectedVersion: r.operation.version,
      holder: "h",
      leaseTtlMs: 60000,
    });
    if (!("granted" in g) || !g.granted) throw new Error("fixture");
    await store.settle({
      ...ref,
      commandId: crypto.randomUUID(),
      expectedVersion: g.operation.version,
      authority: { kind: "lease", leaseId: g.lease.leaseId },
      receipt: {
        id: crypto.randomUUID(),
        measurements: [
          {
            unit: "requests",
            quantity: { value: 1n, scale: 0, unit: "requests" },
            certainty: "measured",
          },
        ],
        cost: { certainty: "measured", money: { units: 100n, currency: "USD" } },
        occurredAt: "2026-09-23T12:00:00.000Z",
        recordedAt: "2026-09-23T12:00:00.000Z",
        cached: false,
        failed: false,
      },
    });
  };
  return { clock, store, meter, settle };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useUsageView", () => {
  test("loading, then success, then refresh", async () => {
    const f = fixture();
    await f.settle();
    const { result } = renderHook(() => useUsageView({ meter: f.meter, access, ...usageQuery }));
    expect(result.current).toMatchObject({ state: "loading", data: null, error: null });
    await waitFor(() => expect(result.current.state).toBe("ok"));
    expect(result.current.data?.rows[0]?.units.requests).toEqual({
      text: "1",
      unit: "requests",
      certainty: "measured",
    });
    await f.settle({ provider: "maps" });
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.data?.rows).toHaveLength(2));
    expect(result.current.state).toBe("ok");
  });
  test("forbidden and unavailable surface as states with the problem as error", async () => {
    const f = fixture();
    const forbidden = renderHook(() =>
      useUsageView({
        meter: f.meter,
        access,
        ...usageQuery,
        scope: { kind: "namespace", namespace: "test" },
      }),
    );
    await waitFor(() => expect(forbidden.result.current.state).toBe("forbidden"));
    expect(forbidden.result.current.error).toBeNull();
    const broken = { usage: async () => Promise.reject(new Error("down")) } as unknown as Meter;
    const down = renderHook(() => useUsageView({ meter: broken, access, ...usageQuery }));
    await waitFor(() => expect(down.result.current.state).toBe("unavailable"));
    expect(down.result.current.error).toEqual({ kind: "error", message: "down" });
  });
  test("a stale response never replaces the newer one", async () => {
    const pending = new Map<string, ReturnType<typeof deferred<ReadResult<UsagePage>>>>();
    const meter = {
      usage: vi.fn((_access: AccessContext, q: UsageQuery) => {
        const d = deferred<ReadResult<UsagePage>>();
        pending.set(q.groupBy.join(","), d);
        return d.promise;
      }),
    } as unknown as Meter;
    const page = (provider: string): ReadResult<UsagePage> => ({
      outcome: "ok",
      value: {
        rows: [
          {
            dimensions: { provider },
            measurements: [],
            cost: { certainty: "unknown", money: null },
            fundingSource: "byok",
            costOwner: "u1",
            unknownOperations: 0n,
          },
        ],
        asOf: "2026-09-23T12:00:00.000Z",
        watermark: "w",
      },
    });
    const { result, rerender } = renderHook(
      (groupBy: UsageQuery["groupBy"]) => useUsageView({ meter, access, ...usageQuery, groupBy }),
      { initialProps: ["provider"] as UsageQuery["groupBy"] },
    );
    rerender(["operation"]);
    await waitFor(() => expect(pending.size).toBe(2));
    await act(async () => pending.get("operation")!.resolve(page("new")));
    await waitFor(() => expect(result.current.state).toBe("ok"));
    await act(async () => pending.get("provider")!.resolve(page("old")));
    expect(result.current.data?.rows[0]?.dimensions).toEqual({ provider: "new" });
  });
  test("re-runs only when the serialized inputs change", async () => {
    const f = fixture();
    const spy = vi.spyOn(f.meter, "usage");
    const { rerender, result } = renderHook(
      (q: UsageQuery) => useUsageView({ meter: f.meter, access: { ...access }, ...q }),
      { initialProps: { ...usageQuery } },
    );
    await waitFor(() => expect(result.current.state).toBe("empty"));
    rerender({ ...usageQuery });
    rerender({ ...usageQuery, units: ["requests"] });
    await waitFor(() => expect(result.current.state).toBe("empty"));
    expect(spy).toHaveBeenCalledTimes(1);
    rerender({ ...usageQuery, limit: 5 });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });
});

describe("MeterProvider", () => {
  test("hooks fall back to the provider and explicit options win", async () => {
    const f = fixture(),
      other = fixture();
    await f.settle();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(MeterProvider, { meter: f.meter, access }, children);
    const fromProvider = renderHook(() => useUsageView(usageQuery), { wrapper });
    await waitFor(() => expect(fromProvider.result.current.state).toBe("ok"));
    const explicit = renderHook(() => useUsageView({ ...usageQuery, meter: other.meter }), {
      wrapper,
    });
    await waitFor(() => expect(explicit.result.current.state).toBe("empty"));
  });
  test("without a provider or options the view is unavailable", async () => {
    const { result } = renderHook(() => useUsageView(usageQuery));
    await waitFor(() => expect(result.current.state).toBe("unavailable"));
    expect(result.current.error).toMatchObject({ kind: "error" });
  });
});

describe("other hooks", () => {
  const budgetInput = { scope, surface: "app" as const, units: ["requests"] };
  test("useBudgetsView and useHeaderStatus load the same bounds", async () => {
    const f = fixture([cap]);
    const budgets = renderHook(() => useBudgetsView({ meter: f.meter, access, ...budgetInput }));
    await waitFor(() => expect(budgets.result.current.state).toBe("ok"));
    expect(budgets.result.current.data?.rows[0]?.id).toBe("cap");
    const header = renderHook(() => useHeaderStatus({ meter: f.meter, access, ...budgetInput }));
    await waitFor(() => expect(header.result.current.state).toBe("ok"));
    expect(header.result.current.data?.bounds[0]?.level).toBe("ok");
  });
  test("useHeaderStatus merges crossings without a refetch", async () => {
    const f = fixture([cap]);
    const spy = vi.spyOn(f.meter, "applicableBudgets");
    const crossing: BudgetAlertCrossed = {
      budgetId: "cap",
      budgetVersion: 1,
      epoch: "2026-09",
      at: { percent: 50 },
      used: { value: 5n, scale: 0, unit: "requests" },
      reserved: { value: 0n, scale: 0, unit: "requests" },
    };
    const { result, rerender } = renderHook(
      (crossings: BudgetAlertCrossed[]) =>
        useHeaderStatus({ meter: f.meter, access, ...budgetInput, crossings }),
      { initialProps: [] as BudgetAlertCrossed[] },
    );
    await waitFor(() => expect(result.current.state).toBe("ok"));
    expect(result.current.data?.level).toBe("ok");
    rerender([crossing]);
    expect(result.current.data?.level).toBe("warning");
    expect(result.current.data?.bounds[0]?.warningAt).toEqual({ percent: 50 });
    expect(spy).toHaveBeenCalledTimes(1);
  });
  test("useCoverageView and useExceptionsView", async () => {
    const f = fixture();
    await f.settle();
    const coverage = renderHook(() =>
      useCoverageView({ meter: f.meter, access, scope: usageQuery.scope, ...month }),
    );
    await waitFor(() => expect(coverage.result.current.state).toBe("ok"));
    expect(coverage.result.current.data?.entries[0]).toMatchObject({ count: "1" });
    const exceptions = renderHook(() =>
      useExceptionsView({ meter: f.meter, access, scope: usageQuery.scope, ...month }),
    );
    await waitFor(() => expect(exceptions.result.current.state).toBe("empty"));
  });
});
