import { expect, test } from "vitest";
import type { BillingImportInput } from "@usagekit/core";
import { createManualClock, createMemoryStore } from "./index.js";

const bill = (): BillingImportInput => ({
  scope: { namespace: "test", principal: "owner-a", connection: "shared-id" },
  provider: "search",
  fileHash: "a".repeat(64),
  window: { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" },
  expectedPreviousImportId: null,
  attribution: { fundingSource: "byok", costOwner: "owner-a" },
  lines: [
    {
      providerRequestId: "request-a",
      occurredAt: "2026-09-23T12:00:00.000Z",
      cost: { units: 100n, currency: "USD" },
    },
  ],
});

test("a billing family cannot transfer ownership through a revised file", async () => {
  const store = createMemoryStore({ clock: createManualClock(), budgets: [] }),
    i = bill();
  const first = await store.importBilling(i);
  if (first.outcome !== "imported") throw new Error("First import fixture");
  const result = await store.importBilling({
    ...i,
    fileHash: "b".repeat(64),
    expectedPreviousImportId: first.record.id,
    scope: { ...i.scope, principal: "owner-b" },
    attribution: { fundingSource: "byok", costOwner: "owner-b" },
  });
  expect(result).toMatchObject({ outcome: "rejected", reason: "evidence_conflict" });
  expect(
    (
      await store.billingImports({
        scope: { namespace: "test", principal: "owner-a" },
        connection: i.scope.connection,
        ...i.window,
      })
    ).records,
  ).toEqual([first.record]);
  expect(
    (
      await store.billingImports({
        scope: { namespace: "test", principal: "owner-b" },
        connection: i.scope.connection,
        ...i.window,
      })
    ).records,
  ).toEqual([]);
});

test.each([
  { scope: { ...bill().scope, group: 12 } },
  { scope: { ...bill().scope, actor: [] } },
  { scope: { ...bill().scope, providerCredentialVersion: false } },
  { scope: { ...bill().scope, accessCredential: { kind: "api_key", id: 12 } } },
  { attribution: { ...bill().attribution, creditAccountRef: {} } },
  { attribution: { ...bill().attribution, customerPriceVersion: [] } },
  { attribution: { ...bill().attribution, providerPriceVersion: 12 } },
])(
  "malformed historical attribution is rejected before it can corrupt stored operations",
  async (bad) => {
    const store = createMemoryStore({ clock: createManualClock(), budgets: [] });
    expect(
      await store.importBilling({ ...bill(), ...bad } as unknown as BillingImportInput),
    ).toMatchObject({ outcome: "invalid" });
    expect(
      (
        await store.billingImports({
          scope: { namespace: "test", principal: "owner-a" },
          connection: "shared-id",
          ...bill().window,
        })
      ).records,
    ).toEqual([]);
  },
);
