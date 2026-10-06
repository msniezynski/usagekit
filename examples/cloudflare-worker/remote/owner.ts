import { DurableObject } from "cloudflare:workers";
import { createDurableObjectStore } from "@usagekit/store-d1";
import { createManualClock, InvalidInput } from "@usagekit/store";
import type { Store } from "@usagekit/store";
import type { Budget } from "@usagekit/core";
export { UsageLedger } from "../worker.js";

export const methods = [
  "reserve",
  "markDispatchIntent",
  "settle",
  "correct",
  "releaseUndispatched",
  "renewLease",
  "claimForRecovery",
  "expireReservations",
  "countRequest",
  "requestCounts",
  "getOperation",
  "aggregate",
  "listOperations",
  "definedBudgets",
  "applicableBudgets",
  "putBudget",
] as const;
export type RemoteCommand = {
  run: string;
  method: (typeof methods)[number] | "inspect";
  input?: unknown;
  now: string;
  failBeforeCommit?: boolean;
};
/** Authenticated integration fixture only. Each run owns its namespace and object. */
export class RemoteLedger extends DurableObject<Env> {
  private clock = createManualClock();
  private failBeforeCommit = false;
  private instance = crypto.randomUUID();
  private store = createDurableObjectStore({
    clock: this.clock,
    storage: {
      sql: this.ctx.storage.sql,
      transactionSync: (callback) =>
        this.ctx.storage.transactionSync(() => {
          const result = callback();
          // Execute ALL writes first, including the command journal, then fail the transaction.
          if (this.failBeforeCommit) throw new Error("injected before commit");
          return result;
        }),
    },
  });
  async execute(command: RemoteCommand) {
    if (!/^p7-[a-z0-9-]{1,80}$/.test(command.run) || !Number.isFinite(Date.parse(command.now)))
      throw new Error("Invalid test envelope");
    const identity = this.ctx.storage.sql
      .exec<{ namespace: string }>("SELECT namespace FROM remote_identity")
      .toArray()[0];
    if (identity && identity.namespace !== command.run) throw new Error("Wrong object namespace");
    if (!identity) this.ctx.storage.sql.exec("INSERT INTO remote_identity VALUES(?)", command.run);
    this.clock.set(command.now);
    if (command.method === "inspect")
      return {
        instance: this.instance,
        revision: this.env.REVISION,
        metrics: this.store.database.metrics,
      };
    if (!methods.includes(command.method)) throw new Error("Unknown command");
    const input = command.input as { namespace?: string; scope?: { namespace?: string } };
    if ((input?.scope?.namespace ?? input?.namespace) !== command.run)
      throw new Error("Wrong command namespace");
    try {
      this.failBeforeCommit = command.failBeforeCommit === true;
      let pending: unknown;
      try {
        if (command.method === "putBudget") pending = this.store.putBudget(command.input as Budget);
        else {
          const method = this.store[command.method as keyof Store];
          pending = Reflect.apply(method, this.store, [command.input]);
        }
      } finally {
        this.failBeforeCommit = false;
      }
      return {
        result: await pending,
        instance: this.instance,
        revision: this.env.REVISION,
        metrics: this.store.database.metrics,
      };
    } catch (error) {
      return {
        error: {
          message: String(error),
          ...(error instanceof InvalidInput ? { field: error.field, reason: error.reason } : {}),
        },
        instance: this.instance,
        revision: this.env.REVISION,
        metrics: this.store.database.metrics,
      };
    }
  }
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS remote_identity(namespace TEXT PRIMARY KEY)");
  }
}
export default {
  fetch() {
    return new Response("Not found", { status: 404 });
  },
};
