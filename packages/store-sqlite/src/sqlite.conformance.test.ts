import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManualClock } from "@usagekit/store";
import { runStoreConformance } from "@usagekit/store/conformance";
import type { Budget } from "@usagekit/core";
import { insertBudget } from "./budgets.js";
import { encode } from "./serialize.js";
import { createSqliteStore } from "./index.js";
runStoreConformance(
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "usagekit-sqlite-")),
      path = join(dir, "usage.db"),
      clock = createManualClock(),
      budgets: Budget[] = [];
    let store = createSqliteStore({ path, clock });
    const seen = new Map<string, string>();
    const wrapped = new Proxy(store, {
      get(_target, name) {
        const value = store[name as keyof typeof store];
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          for (const b of budgets) {
            const k = b.scope.namespace + ":" + b.id + ":" + b.version,
              v = encode(b);
            if (seen.get(k) !== v) {
              store.database.transaction(() => insertBudget(store.database, b, true)).immediate();
              seen.set(k, v);
            }
          }
          return Reflect.apply(value, store, args);
        };
      },
    });
    return {
      store: wrapped,
      clock,
      budgets,
      restart: async () => {
        store.close();
        store = createSqliteStore({ path, clock });
        return wrapped;
      },
      close: async () => {
        store.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  },
  { durable: true, rollingWindows: false, maxMoneyUnits: 2n ** 63n - 1n, maxQuantityScale: 18 },
);
