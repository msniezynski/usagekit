import { createMemoryStore, createManualClock } from "../src/index.js";
import type { Budget } from "@usagekit/core";
import { runStoreConformance } from "./index.js";
runStoreConformance(
  async () => {
    const clock = createManualClock();
    const budgets: Budget[] = [];
    return { store: createMemoryStore({ clock, budgets }), clock, budgets, close: async () => {} };
  },
  { durable: false, rollingWindows: false, maxMoneyUnits: 2n ** 63n - 1n, maxQuantityScale: 18 },
);
