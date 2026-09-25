import { describe, expect, test } from "vitest";
import type { Budget, BudgetAlertCrossed, BudgetStatus, Quantity } from "@usagekit/core";
import {
  budgetsViewFromStatuses,
  connectionRows,
  headerStatusFromBudgets,
  withCrossings,
} from "./index.js";

const n = (value: bigint, scale = 0): Quantity => ({ value, scale, unit: "requests" });
const status = (budget: Partial<Budget>, used: bigint, reserved = 0n): BudgetStatus => {
  const b: Budget = {
    id: "b",
    version: 1,
    scope: { kind: "principal", namespace: "test", principal: "u1" },
    surface: "any",
    unit: "requests",
    limit: n(10n),
    window: { kind: "calendar_month", timezone: "UTC" },
    onExceed: "block",
    ...budget,
  };
  return {
    budget: b,
    epoch: { epoch: "2026-09", startsAt: "2026-09-01T00:00:00.000Z", endsAt: null },
    used: n(used),
    reserved: n(reserved),
    remaining: b.limit ? { ...b.limit, value: b.limit.value - used - reserved } : null,
  };
};
const level = (s: BudgetStatus, crossings: BudgetAlertCrossed[] = []) =>
  headerStatusFromBudgets(budgetsViewFromStatuses([s], crossings)).bounds[0]?.level;

describe("header level thresholds", () => {
  test("without alerts warning starts at 80 percent and exceeded at the limit", () => {
    expect(level(status({}, 7n))).toBe("ok");
    expect(level(status({}, 7n, 1n))).toBe("warning");
    expect(level(status({}, 8n))).toBe("warning");
    expect(level(status({}, 9n, 1n))).toBe("exceeded");
    expect(level(status({}, 12n))).toBe("exceeded");
    expect(level(status({ limit: n(0n) }, 0n))).toBe("exceeded");
  });
  test("defined alerts replace the 80 percent default", () => {
    const alerts = [{ at: { percent: 50 } }, { at: n(9n) }];
    expect(level(status({ alerts }, 4n))).toBe("ok");
    expect(level(status({ alerts }, 8n))).toBe("warning");
    const bound = headerStatusFromBudgets(budgetsViewFromStatuses([status({ alerts }, 9n)]))
      .bounds[0]!;
    expect(bound.warningAt).toEqual({ text: "9", unit: "requests", certainty: "measured" });
    expect(level(status({ alerts: [{ at: { percent: 90 } }] }, 8n))).toBe("ok");
  });
  test("soft budgets warn past the limit and exceed at the hard limit", () => {
    const soft = { onExceed: "allow" as const, hardLimit: n(15n) };
    expect(level(status(soft, 7n))).toBe("ok");
    expect(level(status(soft, 11n))).toBe("warning");
    expect(level(status(soft, 15n))).toBe("exceeded");
    expect(level(status({ onExceed: "allow" }, 10n))).toBe("exceeded");
  });
  test("fractional scales compare exactly", () => {
    const s = status({ limit: n(1000n, 2) }, 0n);
    const at = { ...s, used: n(79999n, 4) };
    expect(level(at)).toBe("ok");
    expect(level({ ...s, used: n(8n) })).toBe("warning");
  });
  test("overall level is the worst bound and unlimited budgets are not bounds", () => {
    const view = budgetsViewFromStatuses([
      status({ id: "a" }, 1n),
      status({ id: "b" }, 10n),
      status({ id: "c", limit: null }, 3n),
    ]);
    const header = headerStatusFromBudgets(view);
    expect(header.state).toBe("ok");
    expect(header.level).toBe("exceeded");
    expect(header.bounds.map((b) => b.budgetId)).toEqual(["a", "b"]);
    expect(header.bounds[1]!.remaining).toEqual({
      text: "0",
      unit: "requests",
      certainty: "measured",
    });
  });
  test("withCrossings raises matching bounds without figures", () => {
    const header = headerStatusFromBudgets(
      budgetsViewFromStatuses([status({ id: "a", alerts: [{ at: { percent: 20 } }] }, 1n)]),
    );
    expect(header.level).toBe("ok");
    const crossing: BudgetAlertCrossed = {
      budgetId: "a",
      budgetVersion: 1,
      epoch: "2026-09",
      at: { percent: 20 },
      used: n(2n),
      reserved: n(0n),
    };
    const raised = withCrossings(header, [crossing, { ...crossing, budgetId: "z" }]);
    expect(raised.level).toBe("warning");
    expect(raised.bounds[0]).toMatchObject({ level: "warning", warningAt: { percent: 20 } });
    expect(withCrossings(header, [{ ...crossing, epoch: "2026-08" }]).level).toBe("ok");
    expect(withCrossings(header, [])).toBe(header);
  });
});

describe("connection rows", () => {
  test("labels fall back to the id, tags sort, plan is explicit", () => {
    expect(
      connectionRows([
        { id: "c2", provider: "maps", fundingSource: "platform", tags: ["prod", "eu"] },
        { id: "c1", provider: "search", label: "Search key", fundingSource: "byok", plan: "dev" },
      ]),
    ).toEqual([
      {
        id: "c2",
        provider: "maps",
        label: "c2",
        funding: "platform",
        tags: ["eu", "prod"],
        plan: null,
      },
      { id: "c1", provider: "search", label: "Search key", funding: "byok", tags: [], plan: "dev" },
    ]);
  });
});

describe("budget bar geometry", () => {
  const bar = (s: BudgetStatus) => budgetsViewFromStatuses([s]).rows[0]!.bar;
  test("positions are exact percent text of the bar extent", () => {
    expect(bar(status({ alerts: [{ at: { percent: 50 } }] }, 5n, 1n))).toEqual({
      used: "50",
      reserved: "10",
      limit: "100",
      hardLimit: null,
      alerts: ["50"],
    });
    expect(
      bar(
        status(
          {
            onExceed: "allow",
            limit: n(20n),
            hardLimit: n(30n),
            alerts: [{ at: n(25n) }],
          },
          6n,
        ),
      ),
    ).toEqual({ used: "20", reserved: "0", limit: "66.66", hardLimit: "100", alerts: ["83.33"] });
    expect(bar(status({}, 12n))).toMatchObject({ used: "100", limit: "83.33" });
  });
  test("unlimited, zero-extent and redacted budgets have no bar", () => {
    expect(bar(status({ limit: null }, 3n))).toBeNull();
    expect(bar(status({ limit: n(0n) }, 0n))).toBeNull();
    expect(
      bar({ ...status({}, 1n), used: null, reserved: null, remaining: null, redacted: true }),
    ).toBeNull();
  });
});
