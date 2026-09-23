import { describe, expect, test } from "vitest";
import type { StoreFactory, StoreCapabilities } from "./factory.js";
import { input, ref, command, budget, quantity } from "./helpers.js";
export function capabilityTests(factory: StoreFactory, caps: StoreCapabilities) {
  describe("capability guarantees", () => {
    const durable = caps.durable ? test : test.skip;
    durable("requires durable", async () => {
      const f = await factory();
      try {
        const r = await f.store.reserve(input());
        if (r.outcome !== "reserved") throw new Error("fixture");
        const g = await f.store.markDispatchIntent({
          ...command(r.operation),
          holder: "process1",
          leaseTtlMs: 1000,
        });
        expect(g).toMatchObject({ granted: true });
        if (!f.restart) throw new Error("durable factory requires restart");
        const restarted = await f.restart();
        f.clock.advance(1000);
        const op = await restarted.getOperation(ref(r.operation));
        expect(op?.state).toBe("dispatch_intended");
        const recovery = await restarted.claimForRecovery({
          ...ref(r.operation),
          holder: "process2",
          leaseTtlMs: 1000,
        });
        expect(recovery).toMatchObject({ claimed: true });
        expect(
          await restarted.markDispatchIntent({
            ...command(op!),
            holder: "process2",
            leaseTtlMs: 1000,
          }),
        ).toMatchObject({ granted: false });
      } finally {
        await f.close();
      }
    });
    const rolling = caps.rollingWindows ? test : test.skip;
    rolling("requires rollingWindows", async () => {
      const f = await factory();
      try {
        f.budgets.push(budget({ limit: quantity(1n), window: { kind: "rolling", days: 1 } }));
        expect(await f.store.reserve(input())).toMatchObject({ outcome: "reserved" });
        f.clock.advance(86400000 - 1);
        expect(await f.store.reserve(input())).toMatchObject({ outcome: "exceeded" });
        f.clock.advance(1);
        expect(await f.store.reserve(input())).toMatchObject({ outcome: "reserved" });
      } finally {
        await f.close();
      }
    });
    test("quantity precision obeys advertised capability", async () => {
      const f = await factory();
      try {
        expect(
          await f.store.reserve(
            input({ estimate: [quantity(1n, "units", caps.maxQuantityScale)] }),
          ),
        ).toMatchObject({ outcome: "reserved" });
        await expect(
          f.store.reserve(input({ estimate: [quantity(1n, "units", caps.maxQuantityScale + 1)] })),
        ).rejects.toThrow("InvalidInput");
      } finally {
        await f.close();
      }
    });
  });
}
