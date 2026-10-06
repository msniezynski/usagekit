import { beforeEach, afterEach, describe, expect, test } from "vitest";
import type {
  BillingImportInput,
  BillingImportRecord,
  Operation,
  Receipt,
  ReserveInput,
} from "@usagekit/core";
import type { StoreFactory, StoreFixture, StoreCapabilities } from "./factory.js";
import { input, receipt, command, ref, quantity, budget } from "./helpers.js";

export function billingTests(factory: StoreFactory, capabilities: StoreCapabilities) {
  describe("billing import guarantees", () => {
    let f: StoreFixture;
    beforeEach(async () => {
      f = await factory();
    });
    afterEach(async () => f.close());
    const window = { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" };
    const bill = (overrides: Partial<BillingImportInput> = {}): BillingImportInput => ({
      scope: { namespace: "test", principal: "u1", connection: "c1" },
      provider: "search",
      fileHash: "a".repeat(64),
      window,
      expectedPreviousImportId: null,
      attribution: { fundingSource: "byok", costOwner: "u1" },
      lines: [
        {
          providerRequestId: "request-a",
          operation: "search",
          occurredAt: "2026-09-23T12:00:00.000Z",
          cost: { units: 100n, currency: "USD" },
        },
      ],
      ...overrides,
    });
    const read = (history = false) =>
      f.store.billingImports({
        scope: { namespace: "test", principal: "u1" },
        connection: "c1",
        ...window,
        history,
      });
    const imported = async (i = bill()): Promise<BillingImportRecord> => {
      const result = await f.store.importBilling(i);
      if (result.outcome !== "imported") throw new Error("Import fixture: " + result.outcome);
      return result.record;
    };
    const observed = async (
      id = "request-a",
      r: Receipt = receipt(),
      overrides: Partial<ReserveInput> = {},
    ): Promise<Operation> => {
      const i = input(overrides),
        reservation = await f.store.reserve(i);
      if (reservation.outcome !== "reserved") throw new Error("Reservation fixture");
      const grant = await f.store.markDispatchIntent({
        ...command(reservation.operation),
        holder: "h",
        leaseTtlMs: 1000,
      });
      if (!("granted" in grant) || !grant.granted) throw new Error("Dispatch fixture");
      const result = await f.store.settle({
        ...command(grant.operation),
        authority: { kind: "lease", leaseId: grant.lease.leaseId },
        receipt: { ...r, providerRequestId: id },
      });
      if (result.outcome !== "settled") throw new Error("Settlement fixture");
      return result.operation;
    };

    test("exact correction preserves frozen funding, customer price and quantity certainty", async () => {
      const before = await observed(
        "request-a",
        receipt({
          measurements: [
            { unit: "requests", quantity: quantity(3n), certainty: "estimated" },
            {
              unit: "customer_cents",
              quantity: quantity(900n, "customer_cents", 4),
              certainty: "measured",
            },
          ],
        }),
        {
          fundingSource: "platform",
          costOwner: "platform",
          creditAccountRef: "original-wallet",
          customerPriceVersion: "tariff-v1",
          providerPriceVersion: "provider-v1",
          platformPools: ["original-pool"],
          scope: {
            namespace: "test",
            principal: "u1",
            connection: "c1",
            providerCredentialVersion: "key-v1",
            accessCredential: { kind: "api_key", id: "caller-v1" },
          },
        },
      );
      const record = await imported(
        bill({
          attribution: {
            fundingSource: "byok",
            costOwner: "new-owner",
            customerPriceVersion: "tariff-v2",
          },
          lines: [{ ...bill().lines[0]!, cost: { units: 9007199254740993n, currency: "USD" } }],
        }),
      );
      const after = (await f.store.getOperation(ref(before)))!;
      expect(after).toMatchObject({
        fundingSource: "platform",
        costOwner: "platform",
        creditAccountRef: "original-wallet",
        customerPriceVersion: "tariff-v1",
        providerPriceVersion: "provider-v1",
        platformPools: ["original-pool"],
        scope: before.scope,
        budgetEpochs: before.budgetEpochs,
      });
      expect(after.receipts).toHaveLength(2);
      expect(after.receipts[0]).toEqual(before.receipts[0]);
      expect(after.receipts[1]).toMatchObject({
        source: "import",
        supersedes: before.receipts[0]!.id,
        evidenceRef: record.id,
        cost: { certainty: "measured", money: { units: 9007199254740993n, currency: "USD" } },
        measurements: before.receipts[0]!.measurements,
      });
      expect(after.version).toBe(before.version + 1);
    });

    test("identical replay survives new commands and does not reapply any receipt", async () => {
      const before = await observed(),
        first = await imported(),
        after = await f.store.getOperation(ref(before));
      const replay = await f.store.importBilling(bill());
      expect(replay).toEqual({ outcome: "imported", replayed: true, record: first });
      expect(await f.store.getOperation(ref(before))).toEqual(after);
      expect((await read(true)).records).toHaveLength(1);
      expect(
        await f.store.importBilling(
          bill({ lines: [{ ...bill().lines[0]!, cost: { units: 101n, currency: "USD" } }] }),
        ),
      ).toMatchObject({ outcome: "rejected", reason: "payload_conflict" });
      expect(await f.store.getOperation(ref(before))).toEqual(after);
    });

    test("revisions supersede journal evidence; replay of an older file cannot restore old costs", async () => {
      const op = await observed(),
        first = await imported();
      const second = await imported(
        bill({
          fileHash: "b".repeat(64),
          expectedPreviousImportId: first.id,
          lines: [{ ...bill().lines[0]!, cost: { units: 200n, currency: "USD" } }],
        }),
      );
      expect(second.supersedes).toBe(first.id);
      expect((await read()).records.map((r) => r.id)).toEqual([second.id]);
      const history = (await read(true)).records;
      expect(history).toHaveLength(2);
      expect(history.find((r) => r.id === first.id)?.supersededBy).toBe(second.id);
      await f.store.importBilling(bill());
      expect((await f.store.getOperation(ref(op)))!.receipts.at(-1)!.cost.money?.units).toBe(200n);
      expect(
        await f.store.importBilling(
          bill({ fileHash: "c".repeat(64), expectedPreviousImportId: first.id }),
        ),
      ).toMatchObject({
        outcome: "rejected",
        reason: "previous_import_conflict",
        latestImportId: second.id,
      });
    });

    test("concurrent same-file replays and competing first imports each write once", async () => {
      await observed();
      const results = await Promise.all([
        f.store.importBilling(bill()),
        f.store.importBilling(bill()),
      ]);
      expect(results.filter((r) => r.outcome === "imported" && !r.replayed)).toHaveLength(1);
      expect(results.filter((r) => r.outcome === "imported" && r.replayed)).toHaveLength(1);
      const first = (await read()).records[0]!;
      const revisions = await Promise.all(
        ["b", "c"].map((h) =>
          f.store.importBilling(
            bill({ fileHash: h.repeat(64), expectedPreviousImportId: first.id }),
          ),
        ),
      );
      expect(revisions.filter((r) => r.outcome === "imported")).toHaveLength(1);
      expect(
        revisions.filter(
          (r) => r.outcome === "rejected" && r.reason === "previous_import_conflict",
        ),
      ).toHaveLength(1);
    });

    test.each<Partial<ReserveInput>>([
      { scope: { namespace: "test", principal: "u2", connection: "c1" } },
      { scope: { namespace: "test", principal: "u1", connection: "c2" } },
      { provider: "other-provider" },
      { scope: { namespace: "other", principal: "u1", connection: "c1" } },
    ])(
      "request ids are scoped independently to owner, connection, provider and namespace",
      async (foreignScope) => {
        const own = await observed(
          "request-a",
          receipt({ cost: { certainty: "estimated", money: { units: 20n, currency: "USD" } } }),
        );
        const foreign = await observed("request-a", receipt(), foreignScope);
        const record = await imported();
        expect(record.matchedOperationIds).toEqual([own.operationId]);
        expect(await f.store.getOperation(ref(foreign))).toEqual(foreign);
        expect(
          (
            await f.store.billingImports({
              scope: { namespace: "test", principal: "u2" },
              connection: "c1",
              ...window,
            })
          ).records,
        ).toEqual([]);
      },
    );

    test("ambiguous matching rejects the complete batch before any accounting mutation", async () => {
      const good = await observed("good"),
        a = await observed("duplicate"),
        b = await observed("duplicate");
      const result = await f.store.importBilling(
        bill({
          lines: [
            { ...bill().lines[0]!, providerRequestId: "good" },
            { ...bill().lines[0]!, providerRequestId: "duplicate" },
          ],
        }),
      );
      expect(result).toMatchObject({ outcome: "rejected", reason: "ambiguous_request", line: 1 });
      for (const op of [good, a, b]) expect(await f.store.getOperation(ref(op))).toEqual(op);
      expect((await read(true)).records).toEqual([]);
    });

    test("aggregate lines report exact signed differences without allocating cost to operations", async () => {
      const a = await observed(
        "a",
        receipt({ cost: { certainty: "measured", money: { units: 700n, currency: "USD" } } }),
      );
      const b = await observed(
        "b",
        receipt({ cost: { certainty: "estimated", money: { units: 300n, currency: "USD" } } }),
      );
      const record = await imported(
        bill({
          lines: [{ occurredAt: window.from, window, cost: { units: 900n, currency: "USD" } }],
        }),
      );
      expect(record.reconciliations.find((e) => e.kind === "aggregate")).toMatchObject({
        ledgerTotal: { certainty: "estimated", money: { units: 1000n } },
        evidenceTotal: { units: 900n },
        differenceUnits: -100n,
        unknownOperations: 0n,
      });
      expect(record.matchedOperationIds).toEqual([]);
      expect(record.unobservedOperationIds).toEqual([]);
      expect(await f.store.getOperation(ref(a))).toEqual(a);
      expect(await f.store.getOperation(ref(b))).toEqual(b);
    });

    test("two historical request ids cannot apply competing corrections to one operation", async () => {
      const original = await observed("old-id");
      const corrected = await f.store.correct({
        ...command(original),
        replacesReceiptId: original.receipts[0]!.id,
        reason: "corrected provider identity",
        authority: { kind: "late_evidence", source: "provider correction" },
        receipt: receipt({ providerRequestId: "new-id" }),
      });
      if (corrected.outcome !== "settled") throw new Error("Correction fixture");
      const result = await f.store.importBilling(
        bill({
          lines: [
            { ...bill().lines[0]!, providerRequestId: "old-id" },
            { ...bill().lines[0]!, providerRequestId: "new-id" },
          ],
        }),
      );
      expect(result).toMatchObject({ outcome: "rejected", reason: "ambiguous_request", line: 1 });
      expect(await f.store.getOperation(ref(corrected.operation))).toEqual(corrected.operation);
      expect((await read(true)).records).toEqual([]);
    });

    test("operation-specific aggregate comparisons exclude other operations and allow disjoint categories", async () => {
      const search = await observed(
        "search-a",
        receipt({ cost: { certainty: "measured", money: { units: 700n, currency: "USD" } } }),
      );
      const images = await observed(
        "images-a",
        receipt({ cost: { certainty: "measured", money: { units: 300n, currency: "USD" } } }),
        { operation: "images" },
      );
      const record = await imported(
        bill({
          lines: [
            {
              occurredAt: window.from,
              window,
              operation: "search",
              cost: { units: 600n, currency: "USD" },
            },
            {
              occurredAt: window.from,
              window,
              operation: "images",
              cost: { units: 350n, currency: "USD" },
            },
          ],
        }),
      );
      expect(record.reconciliations.filter((e) => e.kind === "aggregate")).toMatchObject([
        { operation: "search", ledgerTotal: { money: { units: 700n } }, differenceUnits: -100n },
        { operation: "images", ledgerTotal: { money: { units: 300n } }, differenceUnits: 50n },
      ]);
      expect(await f.store.getOperation(ref(search))).toEqual(search);
      expect(await f.store.getOperation(ref(images))).toEqual(images);
    });

    test("unknown ledger costs remain unknown and an omitted revised line does not manufacture zero", async () => {
      const a = await observed("a", receipt({ cost: { certainty: "unknown", money: null } }));
      const record = await imported(
        bill({
          lines: [{ occurredAt: window.from, window, cost: { units: 900n, currency: "USD" } }],
        }),
      );
      expect(record.reconciliations[0]).toMatchObject({
        ledgerTotal: { certainty: "unknown", money: null },
        differenceUnits: null,
        unknownOperations: 1n,
      });
      expect(await f.store.getOperation(ref(a))).toEqual(a);
      const revision = await imported(
        bill({ fileHash: "b".repeat(64), expectedPreviousImportId: record.id, lines: [] }),
      );
      expect(revision.reconciliations[0]).toMatchObject({
        evidenceTotal: { units: 0n },
        ledgerTotal: { certainty: "unknown", money: null },
        differenceUnits: null,
      });
      expect(await f.store.getOperation(ref(a))).toEqual(a);
    });

    test("unobserved calls retain unknown quantity, never gain dispatch and revise without duplicate operations", async () => {
      const first = await imported(),
        id = first.unobservedOperationIds[0]!;
      const op = (await f.store.getOperation({
        namespace: "test",
        principal: "u1",
        operationId: id,
      }))!;
      expect(op).toMatchObject({
        source: "import",
        surface: "programmatic",
        state: "pending",
        budgetEpochs: [],
        estimate: [],
        lease: null,
      });
      expect(op.receipts[0]).toMatchObject({
        source: "import",
        cost: { certainty: "measured" },
        measurements: [{ unit: "requests", certainty: "unknown", quantity: null }],
      });
      expect(
        await f.store.markDispatchIntent({ ...command(op), holder: "h", leaseTtlMs: 1000 }),
      ).toMatchObject({ granted: false });
      const second = await imported(
        bill({ fileHash: "b".repeat(64), expectedPreviousImportId: first.id }),
      );
      expect(second.unobservedOperationIds).toEqual([]);
      expect(second.matchedOperationIds).toEqual([id]);
      expect((await f.store.getOperation(ref(op)))!.receipts).toHaveLength(2);
    });

    test("known invoice cost does not release unresolved quantities or original customer exposure", async () => {
      const before = await observed(
        "request-a",
        receipt({
          measurements: [
            { unit: "requests", certainty: "unknown", quantity: null },
            {
              unit: "customer_cents",
              certainty: "measured",
              quantity: quantity(99n, "customer_cents"),
            },
          ],
          cost: { certainty: "unknown", money: null },
        }),
      );
      const record = await imported(),
        after = (await f.store.getOperation(ref(before)))!;
      expect(after.state).toBe("pending");
      expect(after.receipts.at(-1)).toMatchObject({
        measurements: before.receipts[0]!.measurements,
        cost: { certainty: "measured", money: { units: 100n } },
        evidenceRef: record.id,
      });
      expect(after.budgetEpochs).toEqual(before.budgetEpochs);
    });

    test("cost import updates existing budget exposure and reports threshold crossings once", async () => {
      f.budgets.push(
        budget({
          unit: "cents",
          limit: quantity(20n, "cents"),
          onExceed: "allow",
          alerts: [{ at: { percent: 50 } }, { at: { percent: 100 } }],
        }),
      );
      const before = await observed(
        "request-a",
        receipt({
          cost: { certainty: "measured", money: { units: 100000n, currency: "USD" } },
          measurements: [
            { unit: "requests", certainty: "measured", quantity: quantity() },
            { unit: "cents", certainty: "measured", quantity: quantity(10n, "cents") },
          ],
        }),
        { estimate: [quantity(), quantity(5n, "cents")] },
      );
      const i = bill({
          lines: [{ ...bill().lines[0]!, cost: { units: 300000n, currency: "USD" } }],
        }),
        first = await imported(i);
      expect(first.alerts).toHaveLength(1);
      expect(first.alerts[0]!.at).toEqual({ percent: 100 });
      const [status] = await f.store.applicableBudgets({
        scope: before.scope,
        surface: before.surface,
        source: before.source,
        units: ["cents"],
      });
      expect(status!.used).toEqual(quantity(300000n, "cents", 4));
      expect(await f.store.importBilling(i)).toMatchObject({
        outcome: "imported",
        replayed: true,
        record: { alerts: first.alerts },
      });
      const second = await imported({
        ...i,
        fileHash: "b".repeat(64),
        expectedPreviousImportId: first.id,
      });
      expect(second.alerts).toEqual([]);
    });

    test.skipIf(!capabilities.durable)(
      "durable import and revision survive runtime recreation",
      async () => {
        const before = await observed(),
          first = await imported();
        if (!f.restart) throw new Error("Durable billing adapter must provide restart");
        f.store = await f.restart();
        expect(await f.store.importBilling(bill())).toEqual({
          outcome: "imported",
          replayed: true,
          record: first,
        });
        expect((await f.store.getOperation(ref(before)))!.receipts).toHaveLength(2);
        const second = await imported(
          bill({ fileHash: "b".repeat(64), expectedPreviousImportId: first.id }),
        );
        f.store = await f.restart();
        expect((await read()).records[0]!.id).toBe(second.id);
        expect((await f.store.getOperation(ref(before)))!.receipts).toHaveLength(3);
      },
    );
  });
}
