// Test-only transport: never imported by worker.ts or deployed by wrangler.jsonc.
import { DurableObject } from "cloudflare:workers";
import { createDurableObjectStore } from "../../packages/store-d1/src/index.js";
import { insertBudget } from "../../packages/store-d1/src/budgets.js";
import { encode, decode } from "../../packages/store-d1/src/serialize.js";
import { createManualClock, InvalidInput } from "@usagekit/store";
import type { Budget } from "@usagekit/core";

export class TestLedger extends DurableObject {
  private clock = createManualClock();
  private failWrite = false;
  private store = createDurableObjectStore({
    storage: this.ctx.storage,
    clock: this.clock,
    testHooks: {
      afterOperationWrite: () => {
        if (this.failWrite) throw new Error("injected write failure");
      },
    },
  });
  async fetch(request: Request): Promise<Response> {
    const body = decode<{ method: string; args: unknown[]; now: string; budgets: Budget[] }>(
      await request.text(),
    );
    try {
      this.clock.set(body.now);
      for (const b of body.budgets)
        this.store.database
          .transaction(() => insertBudget(this.store.database, b, true))
          .immediate();
      let result: unknown;
      if (body.method === "$readOnly") this.store.database.readOnly = Boolean(body.args[0]);
      else if (body.method === "$failWrite") this.failWrite = Boolean(body.args[0]);
      else if (body.method === "$seedReopen")
        this.store = createDurableObjectStore({
          storage: this.ctx.storage,
          clock: this.clock,
          budgets: body.args[0] as Budget[],
        });
      else if (body.method === "$metrics") result = this.store.database.metrics;
      else {
        const method = this.store[body.method as keyof typeof this.store];
        if (typeof method !== "function") throw new Error("Unknown test method");
        result = await Reflect.apply(method, this.store, body.args);
      }
      return new Response(encode({ result, metrics: this.store.database.metrics }));
    } catch (error) {
      return new Response(
        encode({
          error: {
            message: String(error),
            ...(error instanceof InvalidInput ? { field: error.field, reason: error.reason } : {}),
          },
          metrics: this.store.database.metrics,
        }),
      );
    }
  }
}
export default {
  fetch() {
    return new Response("Test ledger");
  },
};
