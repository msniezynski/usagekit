import { aggregate, definedBudgets, applicableBudgets, listOperations } from "./reads.js";
import type { Budget } from "@usagekit/core";
import type { Store } from "../index.js";
import type { Clock } from "../clock.js";
import { copy, find } from "./state.js";
import type { State } from "./state.js";
import { reserve, intent, renew, settle, release, claim, expireReservations } from "./commands.js";
export function createMemoryStore({ clock, budgets }: { clock: Clock; budgets: Budget[] }): Store {
  const state: State = {
    clock,
    budgets,
    warnings: new Map(),
    reserveAlerts: new Map(),
    alerts: new Set(),
    leaseKinds: new Map(),
    commands: new Map(),
    cursors: new Map(),
    operations: new Map(),
    identities: new Map(),
  };
  return {
    expireReservations: async (i) => expireReservations(state, i),
    reserve: async (i, policy) => reserve(state, i, policy),
    getOperation: async (ref) => copy(find(state, ref)),
    markDispatchIntent: async (i) => intent(state, i),
    renewLease: async (i) => renew(state, i),
    claimForRecovery: async (i) => claim(state, i),
    settle: async (i) => settle(state, i),
    correct: async (i) => settle(state, i, true),
    releaseUndispatched: async (i) => release(state, i),
    aggregate: async (q) => aggregate(state, q),
    listOperations: async (q) => listOperations(state, q),
    definedBudgets: async (q) => definedBudgets(state, q),
    applicableBudgets: async (q) => applicableBudgets(state, q),
  };
}
