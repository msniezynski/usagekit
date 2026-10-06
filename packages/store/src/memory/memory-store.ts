import { aggregate, definedBudgets, applicableBudgets, listOperations } from "./reads.js";
import type { Budget } from "@usagekit/core";
import type { Store } from "../index.js";
import type { Clock } from "../clock.js";
import { copy, find } from "./state.js";
import type { State } from "./state.js";
import { countRequest, requestCounts } from "./counters.js";
import { reserve, intent, renew, settle, release, claim, expireReservations } from "./commands.js";
import {
  billingFamilyId,
  prepareBillingImport,
  readBillingImports,
  validateBillingImportInput,
  validateBillingImportsQuery,
} from "../billing.js";
import { reachedBySettlement, recordAlerts } from "./admission.js";
import { InvalidInput, key, semantics } from "./state.js";
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
    importBilling: async (i) => {
      const invalid = validateBillingImportInput(i);
      if (invalid) return invalid;
      const family = billingFamilyId(i),
        imports = (state.billingImports ??= new Map()),
        families = (state.billingFamilies ??= new Map());
      const preparation = prepareBillingImport(
        i,
        {
          operations: [...state.operations.values()],
          imports: [...imports.values()].filter(
            (x) =>
              billingFamilyId({
                ...i,
                scope: x.record.scope,
                provider: x.record.provider,
                window: x.record.window,
              }) === family,
          ),
          latestImportId: families.get(family) ?? null,
        },
        clock.now(),
      );
      if (preparation.stored) {
        const staged = {
          ...state,
          operations: new Map(state.operations),
          alerts: new Set(state.alerts),
        };
        for (const change of preparation.changes) {
          const op = copy(change.after),
            pk = key(op.scope.namespace, op.operationId);
          staged.operations.set(pk, op);
        }
        preparation.stored.record.alerts = preparation.changes.flatMap((change) =>
          recordAlerts(staged, i.scope.namespace, reachedBySettlement(staged, change.after)),
        );
        state.operations = staged.operations;
        state.alerts = staged.alerts;
        for (const change of preparation.changes) {
          if (!change.before)
            state.identities.set(
              key(change.after.scope.namespace, change.after.operationId),
              semantics(change.after),
            );
          if (change.before?.lease) state.leaseKinds.delete(change.before.lease.leaseId);
        }
        imports.set(preparation.stored.record.id, copy(preparation.stored));
        families.set(family, preparation.stored.record.id);
      }
      return copy(preparation.result);
    },
    billingImports: async (q) => {
      const invalid = validateBillingImportsQuery(q);
      if (invalid) throw new InvalidInput(invalid.field, invalid.reason);
      return readBillingImports(
        [...(state.billingImports?.values() ?? [])].map((x) => x.record),
        q,
        clock.now(),
      );
    },
    expireReservations: async (i) => expireReservations(state, i),
    reserve: async (i, policy) => reserve(state, i, policy),
    getOperation: async (ref) => copy(find(state, ref)),
    markDispatchIntent: async (i) => intent(state, i),
    renewLease: async (i) => renew(state, i),
    claimForRecovery: async (i) => claim(state, i),
    settle: async (i) => settle(state, i),
    correct: async (i) => settle(state, i, true),
    releaseUndispatched: async (i) => release(state, i),
    countRequest: async (i) => countRequest(state, i),
    requestCounts: async (q) => requestCounts(state, q),
    aggregate: async (q) => aggregate(state, q),
    listOperations: async (q) => listOperations(state, q),
    definedBudgets: async (q) => definedBudgets(state, q),
    applicableBudgets: async (q) => applicableBudgets(state, q),
  };
}
