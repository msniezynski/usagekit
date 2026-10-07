import { describe, expect, test, vi } from "vitest";
import type { AccessContext, Budget, Meter } from "@usagekit/core";
import { validateBudget } from "@usagekit/store";
import {
  budgetDraftFromBudget,
  buildBudgetFromDraft,
  emptyBudgetDraft,
  loadDefinedBudgetsView,
} from "./index.js";
import type { BudgetDraft } from "./index.js";

const base: Budget = {
  id: "stable",
  version: 3,
  scope: { kind: "connection", namespace: "test", connection: "private-connection" },
  surface: "api",
  unit: "cents",
  window: { kind: "since_reset", epoch: "original", startsAt: "2026-09-01T00:00:00.000Z" },
  limit: { unit: "cents", value: 9007199254740993123n, scale: 4 },
  onExceed: "allow",
  hardLimit: { unit: "cents", value: 9007199254741093123n, scale: 4 },
  alerts: [
    { at: { percent: 80 } },
    { at: { unit: "cents", value: 9007199254740993123n, scale: 4 } },
  ],
};
const draft = (overrides: Partial<BudgetDraft> = {}): BudgetDraft => ({
  ...emptyBudgetDraft(),
  limit: "10",
  ...overrides,
});

describe("budget editor models", () => {
  test("roundtrip huge exact decimals, preserve all host authority fields, increment version once", () => {
    const initial = budgetDraftFromBudget(base);
    expect(initial.limit).toBe("900719925474099.3123");
    const result = buildBudgetFromDraft(base, initial);
    expect(result.outcome).toBe("valid");
    if (result.outcome !== "valid") throw Error(result.reason);
    expect(result.budget).toEqual({ ...base, version: 4 });
    expect(() => validateBudget(result.budget)).not.toThrow();
    result.budget.scope.namespace = "mutated";
    expect(base.scope.namespace).toBe("test");
    expect(result.budget.window).not.toBe(base.window);
    expect(buildBudgetFromDraft(base, initial)).toMatchObject({
      outcome: "valid",
      budget: { version: 4 },
    });
  });

  test("new trusted template version0 creates1 and draft cannot smuggle scope or window", () => {
    const malicious = {
      ...draft(),
      scope: { kind: "namespace", namespace: "other" },
      id: "other",
      version: 99,
      unit: "tokens",
      window: { kind: "rolling", days: 1 },
    };
    const result = buildBudgetFromDraft({ ...base, version: 0 }, malicious);
    expect(result).toMatchObject({
      outcome: "valid",
      budget: {
        id: base.id,
        version: 1,
        scope: base.scope,
        unit: base.unit,
        surface: base.surface,
        window: base.window,
      },
    });
    expect(result.outcome === "valid" && result.budget.hardLimit).toBeUndefined();
  });

  test("zero cap differs from unlimited and unknown blank text", () => {
    expect(buildBudgetFromDraft(base, draft({ limit: "0" }))).toMatchObject({
      outcome: "valid",
      budget: { limit: { value: 0n, scale: 0, unit: "cents" } },
    });
    expect(buildBudgetFromDraft(base, draft({ unlimited: true, limit: "stale" }))).toMatchObject({
      outcome: "valid",
      budget: { limit: null },
    });
    expect(buildBudgetFromDraft(base, emptyBudgetDraft())).toMatchObject({
      outcome: "invalid",
      field: "limit",
    });
    const { hardLimit: _hardLimit, ...withoutHardLimit } = base;
    expect(budgetDraftFromBudget({ ...withoutHardLimit, limit: null, alerts: [] }).unlimited).toBe(
      true,
    );
  });

  test("preserves18 decimal places with exact BigInt, never floating point", () => {
    const result = buildBudgetFromDraft(base, draft({ limit: "0.123456789012345678" }));
    expect(result).toMatchObject({
      outcome: "valid",
      budget: { limit: { value: 123456789012345678n, scale: 18 } },
    });
  });
  test("cents limits, hard limits and absolute alerts respect the Store signed64 bound", () => {
    expect(buildBudgetFromDraft(base, draft({ limit: "922337203685477.5807" }))).toMatchObject({
      outcome: "valid",
    });
    expect(buildBudgetFromDraft(base, draft({ limit: "922337203685477.5808" }))).toMatchObject({
      outcome: "invalid",
      field: "limit",
    });
    expect(
      buildBudgetFromDraft(base, draft({ onExceed: "allow", hardLimit: "922337203685477.5808" })),
    ).toMatchObject({ outcome: "invalid", field: "hardLimit" });
    expect(
      buildBudgetFromDraft(
        base,
        draft({ alerts: [{ kind: "quantity", value: "922337203685477.5808" }] }),
      ),
    ).toMatchObject({ outcome: "invalid", field: "alerts.0.value" });
    expect(
      buildBudgetFromDraft(
        { ...base, unit: "tokens" },
        draft({ limit: "900719925474099312345.123456" }),
      ),
    ).toMatchObject({
      outcome: "valid",
      budget: { limit: { value: 900719925474099312345123456n, scale: 6 } },
    });
  });
  test.each([
    "",
    "-1",
    "-0",
    "1e4",
    "1,000",
    "Infinity",
    "1.",
    ".5",
    "0.1234567890123456789",
    "9".repeat(1025),
  ])("invalid exact decimal %s is rejected", (limit) => {
    expect(buildBudgetFromDraft(base, draft({ limit }))).toMatchObject({
      outcome: "invalid",
      field: "limit",
    });
  });

  test("hard limit requires allow, finite soft cap, strictly greater exact amount", () => {
    for (const change of [
      { onExceed: "block" as const, hardLimit: "11" },
      { unlimited: true, onExceed: "allow" as const, hardLimit: "11" },
      { onExceed: "allow" as const, hardLimit: "10.0000" },
      { onExceed: "allow" as const, hardLimit: "9.9999" },
      { onExceed: "allow" as const, hardLimit: "bad" },
    ])
      expect(buildBudgetFromDraft(base, draft(change))).toMatchObject({
        outcome: "invalid",
        field: "hardLimit",
      });
    const valid = buildBudgetFromDraft(
      base,
      draft({ onExceed: "allow", hardLimit: "10.000000000000000001" }),
    );
    expect(valid.outcome).toBe("valid");
    if (valid.outcome === "valid") expect(() => validateBudget(valid.budget)).not.toThrow();
  });

  test("mixed percent and absolute alerts must ascend by exact effective threshold", () => {
    const valid = buildBudgetFromDraft(
      base,
      draft({
        alerts: [
          { kind: "percent", value: "50" },
          { kind: "quantity", value: "5.000000000000000001" },
        ],
      }),
    );
    expect(valid.outcome).toBe("valid");
    if (valid.outcome === "valid") expect(() => validateBudget(valid.budget)).not.toThrow();
    for (const value of ["5", "4.999999999999999999"]) {
      expect(
        buildBudgetFromDraft(
          base,
          draft({
            alerts: [
              { kind: "percent", value: "50" },
              { kind: "quantity", value },
            ],
          }),
        ),
      ).toMatchObject({ outcome: "invalid", field: "alerts.1.value" });
    }
  });
  test.each(["0", "101", "-1", "1.5", "1e2", ""])('invalid alert percent "%s"', (value) => {
    expect(
      buildBudgetFromDraft(base, draft({ alerts: [{ kind: "percent", value }] })),
    ).toMatchObject({ outcome: "invalid", field: "alerts.0.value" });
  });
  test("unlimited permits absolute alerts but cannot invent percent thresholds", () => {
    expect(
      buildBudgetFromDraft(
        base,
        draft({ unlimited: true, alerts: [{ kind: "quantity", value: "20" }] }),
      ),
    ).toMatchObject({ outcome: "valid" });
    expect(
      buildBudgetFromDraft(
        base,
        draft({ unlimited: true, alerts: [{ kind: "percent", value: "80" }] }),
      ),
    ).toMatchObject({ outcome: "invalid", field: "alerts.0.value" });
  });
  test("no more than8 alerts, invalid kinds and bad absolute values", () => {
    expect(
      buildBudgetFromDraft(
        base,
        draft({
          alerts: Array.from({ length: 9 }, (_, i) => ({ kind: "quantity", value: String(i) })),
        }),
      ),
    ).toMatchObject({ outcome: "invalid", field: "alerts" });
    expect(
      buildBudgetFromDraft(
        base,
        draft({ alerts: [{ kind: "bad", value: "1" }] } as unknown as Partial<BudgetDraft>),
      ),
    ).toMatchObject({ outcome: "invalid", field: "alerts.0.value" });
    expect(
      buildBudgetFromDraft(base, draft({ alerts: [{ kind: "quantity", value: "-1" }] })),
    ).toMatchObject({ outcome: "invalid", field: "alerts.0.value" });
  });
  test.each([-1, 0.1, Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY])(
    "invalid current version %s cannot invent a new write",
    (version) => {
      expect(buildBudgetFromDraft({ ...base, version }, draft())).toMatchObject({
        outcome: "invalid",
        field: "version",
      });
    },
  );
});

describe("defined budget loader", () => {
  const access: AccessContext = {
    namespace: "test",
    readablePrincipals: ["owner"],
    readableGroups: [],
    readablePools: [],
    canReadBillingDetail: false,
    canManageBudgets: false,
  };
  test("lists exact definitions without pretending a status or granting write permission", async () => {
    const definedBudgets = vi.fn(async () => ({ outcome: "ok" as const, value: [base] }));
    const result = await loadDefinedBudgetsView({ definedBudgets } as unknown as Meter, access, {
      scope: base.scope,
    });
    expect(definedBudgets).toHaveBeenCalledWith(access, { scope: base.scope });
    expect(result).toEqual({ state: "ok", budgets: [base], problem: null });
    expect(access.canManageBudgets).toBe(false);
  });
  test("empty, forbidden, invalid and offline keep separate states", async () => {
    const outcomes = [
      [{ outcome: "ok", value: [] }, "empty"],
      [{ outcome: "ok", value: null }, "unavailable"],
      [{ outcome: "forbidden" }, "forbidden"],
      [{ outcome: "invalid", field: "scope", reason: "bad" }, "unavailable"],
    ] as const;
    for (const [result, state] of outcomes) {
      const meter = { definedBudgets: async () => result } as unknown as Meter;
      expect(await loadDefinedBudgetsView(meter, access, { scope: base.scope })).toMatchObject({
        state,
        budgets: [],
      });
    }
    const meter = {
      definedBudgets: async () => {
        throw Error("offline");
      },
    } as unknown as Meter;
    expect(await loadDefinedBudgetsView(meter, access, { scope: base.scope })).toMatchObject({
      state: "unavailable",
      budgets: [],
      problem: { kind: "error" },
    });
  });
});
