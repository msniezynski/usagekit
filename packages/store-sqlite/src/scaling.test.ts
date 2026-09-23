import { runStoreScalingConformance } from "@usagekit/store/conformance";
import { expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManualClock } from "@usagekit/store";
import type { ReserveInput, Budget } from "@usagekit/core";
import { createSqliteStore } from "./index.js";
const input = (id: string): ReserveInput => ({
  operationId: id,
  scope: { namespace: "test", principal: "u", connection: "c" },
  fundingSource: "byok",
  costOwner: "u",
  surface: "app",
  source: "app",
  provider: "example",
  operation: "search",
  estimate: [{ unit: "requests", value: 1n, scale: 0 }],
});
const budget: Budget = {
  id: "b",
  version: 1,
  scope: { kind: "principal", namespace: "test", principal: "u" },
  surface: "any",
  unit: "requests",
  limit: null,
  window: { kind: "calendar_month", timezone: "UTC" },
  onExceed: "block",
};
runStoreScalingConformance(async () => {
  const s = createSqliteStore({
    path: ":memory:",
    clock: createManualClock(),
    budgets: [{ ...budget, scope: { kind: "principal", namespace: "test", principal: "u1" } }],
  });
  await s.reserve({
    ...input("warmup"),
    scope: { namespace: "test", principal: "u1", connection: "c1" },
  });
  let rowsRead = 0;
  const counter = s.database.prepare("SELECT total_changes() AS n"),
    original = s.database.prepare.bind(s.database);
  const spy = vi.spyOn(s.database, "prepare").mockImplementation((sql) => {
    if (/FROM operations\s*$/i.test(sql)) throw new Error("Unbounded operation scan in command");
    const statement = original(sql);
    return new Proxy(statement, {
      get(target, name) {
        const method = Reflect.get(target, name);
        if (typeof method !== "function") return method;
        if (name === "get" || name === "all")
          return (...args: unknown[]) => {
            const result = Reflect.apply(method, target, args);
            rowsRead +=
              name === "all" ? (result as unknown[]).length : result === undefined ? 0 : 1;
            return result;
          };
        if (name === "iterate")
          return function* (...args: unknown[]) {
            for (const row of Reflect.apply(method, target, args) as Iterable<unknown>) {
              rowsRead++;
              yield row;
            }
          };
        return method.bind(target);
      },
    });
  });
  return {
    store: s,
    snapshot: () => ({
      statements: spy.mock.calls.length,
      rowsRead,
      changes: (counter.get() as { n: bigint }).n,
    }),
    readOnly: async (fn) => {
      s.database.pragma("query_only = ON");
      try {
        await fn();
      } finally {
        s.database.pragma("query_only = OFF");
      }
    },
    close: async () => {
      spy.mockRestore();
      s.close();
    },
  };
});
test("budget version comparison is atomic across independent handles", () => {
  const dir = mkdtempSync(join(tmpdir(), "usagekit-budget-cas-")),
    path = join(dir, "usage.db"),
    clock = createManualClock();
  const a = createSqliteStore({ path, clock }),
    b = createSqliteStore({ path, clock });
  try {
    expect(a.putBudget(budget)).toMatchObject({ outcome: "saved" });
    expect(
      b.putBudget({ ...budget, limit: { value: 0n, unit: "requests", scale: 0 } }),
    ).toMatchObject({ outcome: "conflict" });
    expect(a.listBudgets()[0]!.limit).toBeNull();
  } finally {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
