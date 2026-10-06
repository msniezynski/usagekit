/** Structural subset of DurableObjectStorage: no Node imports or compatibility flags. */
export interface DurableSqlStorage {
  sql: {
    exec(
      query: string,
      ...bindings: (string | number | null)[]
    ): {
      toArray(): Record<string, unknown>[];
      readonly rowsRead: number;
      readonly rowsWritten: number;
    };
  };
  transactionSync<T>(callback: () => T): T;
}
export type SqlMetrics = {
  statements: number;
  changes: bigint;
  rowsRead: number;
  storageRowsRead: number;
  storageRowsWritten: number;
};
const exactColumns = new Set([
  "cost_units",
  "value",
  "limit_value",
  "settled_value",
  "outstanding_value",
]);
/**
 * A synchronous SQL port. Exact amounts have TEXT affinity: workerd exposes SQL INTEGERs
 * as JS numbers and would round amounts above 2^53. Convert only amount columns to bigint.
 * Transactions never await: the whole command either commits or rolls back in DO storage.
 */
export class Database {
  readonly metrics: SqlMetrics = {
    statements: 0,
    changes: 0n,
    rowsRead: 0,
    storageRowsRead: 0,
    storageRowsWritten: 0,
  };
  readOnly = false;
  constructor(private readonly storage: DurableSqlStorage) {}
  private execute(sql: string, args: unknown[]) {
    if (this.readOnly && !/^\s*SELECT\b/i.test(sql))
      throw new Error("Write during read-only check");
    const bindings = args.map((a) => {
      if (typeof a === "bigint") return a.toString();
      if (typeof a === "string" || a === null) return a;
      if (typeof a === "number" && Number.isSafeInteger(a)) return a;
      throw new Error("Unsupported or inexact SQL binding");
    });
    this.metrics.statements++;
    const cursor = this.storage.sql.exec(sql, ...bindings);
    const rows = cursor.toArray();
    this.metrics.rowsRead += rows.length;
    this.metrics.storageRowsRead += cursor.rowsRead;
    this.metrics.storageRowsWritten += cursor.rowsWritten;
    return rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => {
          if (exactColumns.has(key) && (key !== "value" || "unit" in row) && value !== null) {
            if (typeof value !== "string") throw new Error("Exact amount must be stored as TEXT");
            return [key, BigInt(value)];
          }
          if (typeof value === "number" && !Number.isSafeInteger(value))
            throw new Error("Inexact SQL integer");
          return [key, value];
        }),
      ),
    );
  }
  prepare(sql: string) {
    const all = (...args: unknown[]) => this.execute(sql, args);
    return {
      all,
      get: (...args: unknown[]) => all(...args)[0],
      iterate: (...args: unknown[]) => all(...args),
      run: (...args: unknown[]) => {
        all(...args);
        const changes = Number(this.execute("SELECT changes() AS n", [])[0]!.n);
        this.metrics.changes += BigInt(changes);
        return { changes };
      },
    };
  }
  exec(sql: string): void {
    this.execute(sql, []);
  }
  transaction<T>(fn: () => T) {
    const run = () => this.storage.transactionSync(fn);
    return { immediate: run, deferred: run };
  }
}
