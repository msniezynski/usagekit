import { beforeEach, afterEach, describe, expect, test } from "vitest";
import type { ReserveInput } from "@usagekit/core";
import type { StoreFactory, StoreFixture } from "./factory.js";
import { input, ref, quantity } from "./helpers.js";
export function reserveTests(factory: StoreFactory) {
  describe("reserve identity", () => {
    let f: StoreFixture;
    beforeEach(async () => {
      f = await factory();
    });
    afterEach(async () => f.close());
    test("first reserve and isolated replay snapshots", async () => {
      const i = input();
      const first = await f.store.reserve(i);
      if (first.outcome !== "reserved") throw new Error("fixture");
      expect(first).toMatchObject({
        outcome: "reserved",
        replayed: false,
        operation: { state: "reserved", version: 1, receipts: [], lease: null },
      });
      expect(await f.store.reserve(i)).toEqual({ ...first, replayed: true });
      i.scope.principal = "mutated";
      expect(await f.store.getOperation({ ...ref(i), principal: "u1" })).toMatchObject({
        scope: { principal: "u1" },
      });
    });
    const changes: Partial<ReserveInput>[] = [
      { scope: { namespace: "test", principal: "u2", connection: "c1" } },
      { fundingSource: "platform" },
      { costOwner: "other" },
      { creditAccountRef: "wallet" },
      { customerPriceVersion: "v2" },
      { surface: "programmatic", source: "api" },
      { source: "worker" },
      { provider: "other" },
      { operation: "other" },
      { estimate: [quantity(2n)] },
      { platformPools: ["pool"] },
      ...["actor", "group", "providerCredentialVersion"].map((key) => ({
        scope: { namespace: "test", principal: "u1", connection: "c1", [key]: "other" },
      })),
      { scope: { namespace: "test", principal: "u1", connection: "c2" } },
      {
        scope: {
          namespace: "test",
          principal: "u1",
          connection: "c1",
          accessCredential: { kind: "api_key", id: "k1" },
        },
      },
    ];
    test.each(changes)("semantic mismatch case", async (change) => {
      const i = input();
      const first = await f.store.reserve(i);
      if (first.outcome !== "reserved") throw new Error("fixture");
      expect(await f.store.reserve({ ...i, ...change })).toEqual({
        outcome: "conflict",
        reason: "semantic_mismatch",
        operation: first.operation,
      });
    });
    test("namespace isolates identities", async () => {
      const i = input();
      await f.store.reserve(i);
      expect(
        await f.store.reserve({ ...i, scope: { ...i.scope, namespace: "other" } }),
      ).toMatchObject({ replayed: false });
    });
    test("unit order, pool order and diagnostic ids are not semantic", async () => {
      const i = input({ estimate: [quantity(), quantity(2n, "units")], platformPools: ["a", "b"] });
      const first = await f.store.reserve(i);
      if (first.outcome !== "reserved") throw new Error("fixture");
      expect(
        await f.store.reserve({
          ...i,
          estimate: [...i.estimate].reverse(),
          platformPools: ["b", "a"],
          correlationId: "other",
          parentOperationId: "parent",
        }),
      ).toEqual({ ...first, replayed: true });
    });
    test("concurrent reserve creates exactly one record", async () => {
      const i = input();
      const results = await Promise.all(Array.from({ length: 20 }, () => f.store.reserve(i)));
      expect(results.filter((r) => r.outcome === "reserved" && !r.replayed)).toHaveLength(1);
    });
    test.each([
      { value: -1n, scale: 0, unit: "requests" },
      { value: 1.5, scale: 0, unit: "requests" },
      { value: 1n, scale: -1, unit: "requests" },
      { value: 1n, scale: 0, unit: "" },
    ])("rejects invalid quantity case", async (q) => {
      await expect(f.store.reserve(input({ estimate: [q as never] }))).rejects.toThrow(
        "InvalidInput",
      );
    });
  });
}
