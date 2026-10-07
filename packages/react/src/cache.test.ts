import { createElement } from "react";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { AccessContext, Meter, ReadResult, UsagePage, UsageQuery } from "@usagekit/core";
import {
  MeterProvider,
  useUsageView,
  useUsageSummary,
  useCoverageView,
  createMeterQueryClient,
  serialize,
} from "./index.js";
import type { CoverageSource } from "@usagekit/views";

afterEach(cleanup);
const access: AccessContext = {
  namespace: "test",
  readablePrincipals: ["a"],
  readableGroups: [],
  readablePools: [],
  canReadBillingDetail: true,
  canManageBudgets: false,
};
const query: UsageQuery = {
  scope: { kind: "principal", namespace: "test", principal: "a" },
  from: "2026-09-01T00:00:00.000Z",
  to: "2026-10-01T00:00:00.000Z",
  units: ["requests"],
  groupBy: ["provider"],
};
function page(provider: string): ReadResult<UsagePage> {
  return {
    outcome: "ok",
    value: {
      rows: [
        {
          dimensions: { provider },
          measurements: [],
          cost: { certainty: "unknown", money: null },
          fundingSource: "byok",
          costOwner: "a",
          unknownOperations: 0n,
        },
      ],
      asOf: query.to,
      watermark: "w",
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("access changes immediately hide the previous principal before a forbidden reply", async () => {
  const pending = deferred<ReadResult<UsagePage>>();
  const meter = {
    usage: vi.fn().mockResolvedValueOnce(page("private-a")).mockReturnValue(pending.promise),
  } as unknown as Meter;
  const { result, rerender } = renderHook(
    (a: AccessContext) => useUsageView({ meter, access: a, ...query }),
    { initialProps: access },
  );
  await waitFor(() => expect(result.current.state).toBe("ok"));
  rerender({ ...access, readablePrincipals: [] });
  expect(result.current.data).toBeNull();
  expect(result.current.state).toBe("loading");
  await act(async () => pending.resolve({ outcome: "forbidden" }));
  await waitFor(() => expect(result.current.state).toBe("forbidden"));
  expect(result.current.data?.rows).toEqual([]);
});

test("a new Meter never displays the previous transport's values while loading", async () => {
  const first = { usage: vi.fn().mockResolvedValue(page("first-token")) } as unknown as Meter;
  const pending = deferred<ReadResult<UsagePage>>();
  const second = { usage: vi.fn().mockReturnValue(pending.promise) } as unknown as Meter;
  const { result, rerender } = renderHook(
    (meter: Meter) => useUsageView({ meter, access, ...query }),
    { initialProps: first },
  );
  await waitFor(() => expect(result.current.state).toBe("ok"));
  rerender(second);
  expect(result.current.data).toBeNull();
  await act(async () => pending.resolve(page("second-token")));
  await waitFor(() =>
    expect(result.current.data?.rows[0]?.dimensions.provider).toBe("second-token"),
  );
});

test("one Provider deduplicates identical queries across simultaneous hooks", async () => {
  const pending = deferred<ReadResult<UsagePage>>();
  const usage = vi.fn().mockReturnValue(pending.promise);
  const meter = { usage } as unknown as Meter;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MeterProvider, { meter, access }, children);
  const { result } = renderHook(() => [useUsageView(query), useUsageView({ ...query })], {
    wrapper,
  });
  await waitFor(() => expect(usage).toHaveBeenCalledTimes(1));
  await act(async () => pending.resolve(page("shared")));
  await waitFor(() => expect(result.current.every((r) => r.state === "ok")).toBe(true));
});

test("active subscribers cannot evict a new shared entry at the cache bound", async () => {
  const usage = vi.fn().mockResolvedValue(page("shared"));
  const meter = { usage } as unknown as Meter;
  const queryClient = createMeterQueryClient({ maxEntries: 1 });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MeterProvider, { meter, access, queryClient }, children);
  const first = renderHook(() => useUsageView(query), { wrapper });
  await waitFor(() => expect(first.result.current.state).toBe("ok"));
  const other = { ...query, groupBy: ["operation"] as const };
  const second = renderHook(() => [useUsageView(other), useUsageView(other)], { wrapper });
  await waitFor(() => expect(second.result.current.every((r) => r.state === "ok")).toBe(true));
  expect(usage).toHaveBeenCalledTimes(2);
});

test("refresh reaches every subscriber and fences a superseded inflight read", async () => {
  const old = deferred<ReadResult<UsagePage>>();
  const fresh = deferred<ReadResult<UsagePage>>();
  const usage = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const meter = { usage } as unknown as Meter;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MeterProvider, { meter, access }, children);
  const { result } = renderHook(() => [useUsageView(query), useUsageView(query)], { wrapper });
  await waitFor(() => expect(usage).toHaveBeenCalledTimes(1));
  act(() => result.current[0]!.refresh());
  await waitFor(() => expect(usage).toHaveBeenCalledTimes(2));
  await act(async () => fresh.resolve(page("fresh")));
  await waitFor(() => expect(result.current[1]?.data?.rows[0]?.dimensions.provider).toBe("fresh"));
  await act(async () => old.resolve(page("stale")));
  expect(result.current[0]?.data?.rows[0]?.dimensions.provider).toBe("fresh");
});

test("canonical keys distinguish bigint from text and avoid evaluating opaque getters", () => {
  expect(serialize({ b: 1n, a: 2 })).toBe(serialize({ a: 2, b: 1n }));
  expect(serialize(1n)).not.toBe(serialize("1n"));
  const read = vi.fn(() => {
    throw new Error("must not evaluate a port getter");
  });
  const port = Object.defineProperty({}, "counts", { get: read });
  expect(serialize(port)).toBe(serialize(port));
  expect(read).not.toHaveBeenCalled();
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(() => serialize(cyclic)).not.toThrow();
});

test("different nonserializable coverage ports never share their cached counts", async () => {
  const meter = { usage: vi.fn().mockResolvedValue(page("provider")) } as unknown as Meter;
  const counts = function (this: { value: bigint }) {
    return Promise.resolve({
      metered: this.value,
      passthrough: 0n,
      unpriced: 0n,
      cached: 0n,
      rate_limited: 0n,
    });
  };
  const first: CoverageSource & { value: bigint } = { counts, value: 1n };
  const second: CoverageSource & { value: bigint } = { counts, value: 2n };
  const { result, rerender } = renderHook(
    (source: CoverageSource) =>
      useCoverageView({
        meter,
        access,
        scope: query.scope,
        from: query.from,
        to: query.to,
        source,
      }),
    { initialProps: first },
  );
  await waitFor(() => expect(result.current.data?.total).toBe("1"));
  rerender(second);
  expect(result.current.data).toBeNull();
  await waitFor(() => expect(result.current.data?.total).toBe("2"));
});

test("retained cache requests never adopt later mutations of access or query objects", async () => {
  const queryClient = createMeterQueryClient();
  const meter = {} as Meter;
  const a = structuredClone(access);
  const input = { principal: "a" };
  const entry = queryClient.entry(
    meter,
    a,
    async (_meter, allowed, scope) => ({
      principal: allowed.readablePrincipals[0],
      scope: scope.principal,
    }),
    input,
  );
  a.readablePrincipals = ["b"];
  input.principal = "b";
  queryClient.ensure(entry);
  await waitFor(() => expect(entry.snapshot.data).toEqual({ principal: "a", scope: "a" }));
});

test("shared summary hooks finish the bounded snapshot and never expose a first-page total", async () => {
  const row = (fundingSource: "byok" | "platform", value: bigint) => ({
    dimensions: {},
    fundingSource,
    costOwner: fundingSource,
    measurements: [
      {
        unit: "requests",
        certainty: "measured" as const,
        quantity: { value, scale: 0, unit: "requests" },
      },
    ],
    cost: { certainty: "unknown" as const, money: null },
    unknownOperations: 0n,
  });
  const usage = vi.fn(
    async (_access: AccessContext, q: UsageQuery): Promise<ReadResult<UsagePage>> => ({
      outcome: "ok",
      value: {
        rows: [q.cursor ? row("platform", 2n) : row("byok", 1n)],
        asOf: query.to,
        watermark: "summary",
        ...(q.cursor ? {} : { nextCursor: "second" }),
      },
    }),
  );
  const meter = { usage } as unknown as Meter;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MeterProvider, { meter, access }, children);
  const { groupBy: _groupBy, ...summary } = query;
  const { result, rerender } = renderHook(
    (maxPages: number) => [
      useUsageSummary({ ...summary, limit: 1, maxPages }),
      useUsageSummary({ ...summary, limit: 1, maxPages }),
    ],
    { wrapper, initialProps: 2 },
  );
  await waitFor(() => expect(result.current[0]?.data?.complete).toBe(true));
  expect(result.current[1]?.data?.measurements.requests).toMatchObject({
    text: "3",
    certainty: "measured",
  });
  expect(usage).toHaveBeenCalledTimes(2);
  expect(usage.mock.calls.every(([, q]) => q.groupBy.length === 0)).toBe(true);
  rerender(1);
  expect(result.current[0]?.data).toBeNull();
  await waitFor(() => expect(result.current[0]?.state).toBe("unavailable"));
  expect(result.current[0]?.data).toMatchObject({
    complete: false,
    measurements: { requests: "unavailable" },
  });
  expect(usage).toHaveBeenCalledTimes(3);
});
