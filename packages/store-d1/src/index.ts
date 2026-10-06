import { Database } from "./database.js";
import type { DurableSqlStorage } from "./database.js";
export type { DurableSqlStorage, SqlMetrics } from "./database.js";
import type { Budget } from "@usagekit/core";
import type { Store, Clock } from "@usagekit/store";
import { InvalidInput, validateBudget } from "@usagekit/store";
import { decode } from "./serialize.js";
import { migrate } from "./migrate.js";
import { canonical } from "./util.js";
import { find } from "./records.js";
import { commands } from "./commands.js";
import { currentBudgets, insertBudget, selected, status } from "./budgets.js";
import { usageReader } from "./reads.js";
import { operationsReader } from "./operations.js";
import { counters } from "./counters.js";
import { billing } from "./billing.js";
export type BudgetWriteResult =
  | { outcome: "saved"; budget: Budget }
  | { outcome: "conflict"; reason: "budget_version" }
  | { outcome: "invalid"; field: string; reason: string };
export type DurableObjectStore = Store & {
  database: Database;
  putBudget(budget: Budget): BudgetWriteResult;
  listBudgets(): Budget[];
};
export function createDurableObjectStore({
  storage,
  clock,
  budgets = [],
  cursorTtlMs = 300000,
  testHooks,
}: {
  storage: DurableSqlStorage;
  clock: Clock;
  budgets?: readonly Budget[];
  cursorTtlMs?: number;
  testHooks?: { afterOperationWrite?: () => void };
}): DurableObjectStore {
  const db = new Database(storage);
  migrate(db);
  const read = <T>(fn: () => T): T => db.transaction(fn).deferred();
  // Initial definitions can be supplied on every object activation. Never overwrite a version.
  db.transaction(() => {
    for (const b of budgets) {
      validateBudget(b);
      const previous = db
        .prepare("SELECT budget_json FROM budgets WHERE namespace=? AND budget_id=? AND version=?")
        .get(b.scope.namespace, b.id, b.version) as { budget_json: string } | undefined;
      if (previous) {
        if (canonical(decode(previous.budget_json)) !== canonical(b))
          throw new InvalidInput("budget.version", "an existing version is immutable");
      } else insertBudget(db, b);
    }
  }).immediate();
  const aggregate = usageReader(db, clock, cursorTtlMs),
    listOperations = operationsReader(db, clock, cursorTtlMs);
  return {
    ...commands(db, clock, testHooks?.afterOperationWrite),
    ...counters(db, clock),
    ...billing(db, clock, testHooks?.afterOperationWrite),
    database: db,
    putBudget: (b) =>
      db
        .transaction(() => {
          try {
            validateBudget(b);
          } catch (error) {
            if (error instanceof InvalidInput)
              return { outcome: "invalid", field: error.field, reason: error.reason } as const;
            throw error;
          }
          const current = db
            .prepare(
              "SELECT MAX(version) AS version FROM budgets WHERE namespace=? AND budget_id=?",
            )
            .get(b.scope.namespace, b.id) as { version: bigint | null };
          if (b.version !== Number(current.version ?? 0) + 1)
            return { outcome: "conflict", reason: "budget_version" } as const;
          insertBudget(db, b);
          return { outcome: "saved", budget: structuredClone(b) } as const;
        })
        .immediate(),
    listBudgets: () => read(() => currentBudgets(db)),
    getOperation: async (ref) => read(() => find(db, ref)?.op ?? null),
    aggregate: async (q) => aggregate(q),
    listOperations: async (q) => listOperations(q),
    definedBudgets: async (q) =>
      read(() => currentBudgets(db, q.scope.namespace, [canonical(q.scope)])),
    applicableBudgets: async (q) =>
      read(() => selected(db, q).map((b) => status(db, b, clock.now()))),
  };
}
