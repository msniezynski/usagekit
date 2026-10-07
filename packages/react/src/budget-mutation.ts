import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { Budget, BudgetScope } from "@usagekit/core";
import { useMeterBinding } from "./context.js";
import { useCallbackFence } from "./callback-fence.js";
import { identity, retainReadInput, serialize } from "./keys.js";
import { bindingKey, createMeterQueryClient, defaultMeterQueryClient } from "./query-client.js";
import { idleMutation, mutationEntry, publishMutation, retainBudget } from "./mutation-state.js";
import type { BudgetMutationState } from "./mutation-state.js";
import type { Binding } from "./use-view.js";
import type { BudgetWriter, BudgetSaveResult, BudgetReconciliation } from "./writer.js";

export type BudgetMutationOptions = Binding & {
  scope: BudgetScope;
  budgetId: string;
  baseVersion?: number;
  budgetWriter?: BudgetWriter | null;
};
export type BudgetMutation = {
  state: BudgetMutationState;
  result: BudgetSaveResult | null;
  canWrite: boolean;
  pending: boolean;
  ambiguous: boolean;
  submittedBudget: Budget | null;
  save: (budget: Budget) => Promise<BudgetSaveResult>;
  reconcile: () => Promise<BudgetReconciliation>;
  reset: () => void;
};
const unavailable = (message: string): BudgetSaveResult => ({
  outcome: "unavailable",
  message,
  ambiguous: true,
});
const forbidden = (): BudgetSaveResult => ({ outcome: "forbidden" });

/** Administrative writes use the host port once. An unknown result remains fenced across editor remounts. */
export function useBudgetMutation(options: BudgetMutationOptions): BudgetMutation {
  const binding = useMeterBinding();
  const meter = options.meter ?? binding?.meter;
  const access = retainReadInput(options.access ?? binding?.access);
  const writer = options.budgetWriter === undefined ? binding?.budgetWriter : options.budgetWriter;
  const local = useRef<ReturnType<typeof createMeterQueryClient> | null>(null);
  if (!local.current) local.current = createMeterQueryClient();
  const client =
    options.queryClient ??
    binding?.queryClient ??
    (meter ? defaultMeterQueryClient(meter) : local.current);
  const scopeKey = serialize(options.scope);
  const gateKey =
    meter && access ? `${bindingKey(meter, access)}:${scopeKey}:${options.budgetId}` : "readonly";
  const key = `${identity(client)}:${gateKey}:${writer ? identity(writer) : "readonly"}`;
  const isCurrent = useCallbackFence(key);
  const entry = useMemo(
    () => (gateKey === "readonly" ? null : mutationEntry(client, gateKey)),
    [client, gateKey],
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!entry) return () => {};
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    [entry],
  );
  const snapshot = useCallback(() => entry?.snapshot ?? idleMutation, [entry]);
  const result = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (
      entry?.candidate &&
      !entry.snapshot.pending &&
      !entry.snapshot.ambiguous &&
      options.baseVersion !== undefined &&
      options.baseVersion >= entry.candidate.version
    ) {
      entry.candidate = null;
      publishMutation(entry, idleMutation);
    }
  }, [entry, options.baseVersion, result.state, result.ambiguous]);
  const canWrite =
    !!meter &&
    !!writer &&
    !!access?.canManageBudgets &&
    access.namespace === options.scope.namespace;
  const allowed = () => isCurrent() && canWrite;

  const finish = (answer: BudgetSaveResult, resolving = false) => {
    if (!entry) return;
    const ambiguous = resolving
      ? answer.outcome !== "saved" && answer.outcome !== "conflict"
      : answer.outcome === "unavailable" && answer.ambiguous;
    publishMutation(entry, { state: answer.outcome, result: answer, pending: false, ambiguous });
    if (meter && access && (answer.outcome === "saved" || answer.outcome === "conflict"))
      client.invalidate(meter, access);
  };
  const save = async (budget: Budget): Promise<BudgetSaveResult> => {
    if (!allowed() || !entry || !writer) return forbidden();
    if (budget.id !== options.budgetId || serialize(budget.scope) !== scopeKey)
      return { outcome: "invalid", field: "scope", reason: "Budget does not match this editor" };
    if (entry.snapshot.pending || entry.snapshot.ambiguous)
      return unavailable("Reconcile the previous budget write before submitting again");
    let candidate: Budget;
    try {
      candidate = retainBudget(budget);
    } catch {
      return { outcome: "invalid", field: "budget", reason: "Budget must be immutable data" };
    }
    entry.candidate = candidate;
    publishMutation(entry, { state: "pending", result: null, ambiguous: false, pending: true });
    let answer: BudgetSaveResult;
    try {
      answer = await writer.save(candidate);
      if (answer.outcome === "saved" && serialize(answer.budget) !== serialize(candidate))
        answer = unavailable("The saved budget does not match the submitted version");
      else if (answer.outcome === "saved") answer = { outcome: "saved", budget: candidate };
    } catch (error) {
      answer = unavailable(error instanceof Error ? error.message : String(error));
    }
    finish(
      allowed()
        ? answer
        : unavailable("The budget binding changed; reconcile the original request"),
    );
    return allowed() ? answer : forbidden();
  };
  const reconcile = async (): Promise<BudgetReconciliation> => {
    if (!allowed() || !entry || !writer || !meter || !access) return forbidden();
    if (entry.snapshot.pending) return unavailable("The original budget request is still pending");
    if (!entry.snapshot.ambiguous || !entry.candidate)
      return entry.snapshot.result ?? { outcome: "not_saved" };
    const candidate = entry.candidate;
    publishMutation(entry, { ...entry.snapshot, state: "pending", pending: true });
    let answer: BudgetReconciliation;
    try {
      if (writer.reconcile) answer = await writer.reconcile(candidate);
      else {
        const read = await meter.definedBudgets(access, { scope: candidate.scope });
        if (read.outcome !== "ok")
          answer =
            read.outcome === "forbidden"
              ? forbidden()
              : unavailable("Budget reconciliation is unavailable");
        else {
          const latest = read.value.find((b) => b.id === candidate.id);
          answer =
            latest && serialize(latest) === serialize(candidate)
              ? { outcome: "saved", budget: latest }
              : latest && latest.version >= candidate.version
                ? { outcome: "conflict", reason: "budget_version" }
                : unavailable("The read cannot prove whether the original request committed");
        }
      }
      if (answer.outcome === "saved" && serialize(answer.budget) !== serialize(candidate))
        answer = unavailable("The reconciled budget does not match the submitted version");
      else if (answer.outcome === "saved") answer = { outcome: "saved", budget: candidate };
    } catch (error) {
      answer = unavailable(error instanceof Error ? error.message : String(error));
    }
    if (!allowed()) {
      finish(unavailable("The budget binding changed; reconcile the original request"), true);
      return forbidden();
    }
    if (answer.outcome === "not_saved") {
      entry.candidate = null;
      publishMutation(entry, idleMutation);
    } else finish(answer, true);
    return allowed() ? answer : forbidden();
  };
  const reset = () => {
    if (isCurrent() && entry && !entry.snapshot.pending && !entry.snapshot.ambiguous) {
      entry.candidate = null;
      publishMutation(entry, idleMutation);
    }
  };
  return { ...result, submittedBudget: entry?.candidate ?? null, canWrite, save, reconcile, reset };
}
