import Database from "better-sqlite3";
import { chmodSync, existsSync, openSync, closeSync } from "node:fs";
import type { Budget } from "@usagekit/core";
import type { Store, Clock } from "@usagekit/store";
import { InvalidInput, validateBudget } from "@usagekit/store";
import { migrate } from "./migrate.js";
import { canonical } from "./util.js";
import { find } from "./records.js";
import { commands } from "./commands.js";
import { currentBudgets, decodeBudget, insertBudget, selected, status } from "./budgets.js";
import { usageReader } from "./reads.js";
import { operationsReader } from "./operations.js";
import { counters } from "./counters.js";
import { billing } from "./billing.js";
export type BudgetWriteResult =
  | { outcome: "saved"; budget: Budget }
  | { outcome: "conflict"; reason: "budget_version" }
  | { outcome: "invalid"; field: string; reason: string };
export type SqliteStore = Store & {
  database: Database.Database;
  close(): void;
  putBudget(budget: Budget): BudgetWriteResult;
  listBudgets(): Budget[];
  /** Immutable version evidence for an administrative write; absence proves no outcome. */
  getBudgetVersion(namespace: string, id: string, version: number): Budget | null;
};
export function createSqliteStore({
  path,
  clock,
  budgets = [],
  cursorTtlMs = 300000,
  testHooks,
}: {
  path: string;
  clock: Clock;
  budgets?: readonly Budget[];
  cursorTtlMs?: number;
  testHooks?: { afterOperationWrite?: () => void };
}): SqliteStore {
  if (path !== ":memory:" && !existsSync(path)) closeSync(openSync(path, "wx", 0o600));
  const db = new Database(path, { timeout: 5000 });
  db.defaultSafeIntegers();
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  try {
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  if (path !== ":memory:")
    for (const file of [path, `${path}-wal`, `${path}-shm`])
      if (existsSync(file)) chmodSync(file, 0o600);
  const read = <T>(fn: () => T): T => db.transaction(fn).deferred();
  // Initial definitions only. Mutable test catalogs are synchronized by the conformance factory.
  db.transaction(() => {
    for (const b of budgets) insertBudget(db, b);
  }).immediate();
  const aggregate = usageReader(db, clock, cursorTtlMs),
    listOperations = operationsReader(db, clock, cursorTtlMs);
  return {
    ...commands(db, clock, testHooks?.afterOperationWrite),
    ...counters(db, clock),
    ...billing(db, clock, testHooks?.afterOperationWrite),
    database: db,
    close: () => {
      if (db.open) db.close();
    },
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
    getBudgetVersion: (namespace, id, version) =>
      read(() => {
        const row = db
          .prepare(
            "SELECT budget_json FROM budgets WHERE namespace=? AND budget_id=? AND version=?",
          )
          .get(namespace, id, version) as { budget_json: string } | undefined;
        return row ? decodeBudget(row.budget_json) : null;
      }),
    getOperation: async (ref) => read(() => find(db, ref)?.op ?? null),
    aggregate: async (q) => aggregate(q),
    listOperations: async (q) => listOperations(q),
    definedBudgets: async (q) =>
      read(() => currentBudgets(db, q.scope.namespace, [canonical(q.scope)])),
    applicableBudgets: async (q) =>
      read(() => selected(db, q).map((b) => status(db, b, clock.now()))),
  };
}
