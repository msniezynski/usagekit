import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Budget } from "@usagekit/core";
import { budgetDraftFromBudget, emptyBudgetDraft, buildBudgetFromDraft } from "@usagekit/views";
import type { BudgetDraft, BudgetTemplate } from "@usagekit/views";
import { identity, serialize } from "./keys.js";
import { useMeterBinding } from "./context.js";
import { useCallbackFence } from "./callback-fence.js";
import { useBudgetMutation } from "./budget-mutation.js";
import type { BudgetMutation, BudgetMutationOptions } from "./budget-mutation.js";
import type { BudgetSaveResult } from "./writer.js";

export type BudgetEditorOptions = Omit<BudgetMutationOptions, "scope" | "budgetId"> & {
  budget: Budget | BudgetTemplate;
  initialDraft?: BudgetDraft;
};
export type BudgetEditorError = { field: string; reason: string };
export type BudgetEditor = Omit<BudgetMutation, "save"> & {
  draft: BudgetDraft;
  setDraft: Dispatch<SetStateAction<BudgetDraft>>;
  dirty: boolean;
  errors: BudgetEditorError | null;
  save: () => Promise<BudgetSaveResult>;
};

/** Scope, unit and window come from the host template. Draft fields are exact decimal strings. */
export function useBudgetEditor({
  budget,
  initialDraft,
  ...options
}: BudgetEditorOptions): BudgetEditor {
  const binding = useMeterBinding();
  const meter = options.meter ?? binding?.meter;
  const access = options.access ?? binding?.access;
  const authority = serialize([
    budget.id,
    budget.scope,
    budget.unit,
    budget.surface,
    budget.window,
    access,
    meter ? identity(meter) : null,
  ]);
  const [adopted, setAdopted] = useState<{ authority: string; budget: Budget } | null>(null);
  const base =
    adopted?.authority === authority && adopted.budget.version > budget.version
      ? adopted.budget
      : budget;
  const mutation = useBudgetMutation({
    ...options,
    scope: base.scope,
    budgetId: base.id,
    baseVersion: budget.version,
  });
  const original =
    base !== budget
      ? budgetDraftFromBudget(base as Budget)
      : (initialDraft ?? ("limit" in budget ? budgetDraftFromBudget(budget) : emptyBudgetDraft()));
  const key = serialize([base, original, authority]);
  const isCurrent = useCallbackFence(key);
  const seed = serialize(initialDraft);
  const [edited, setEdited] = useState<{
    key: string;
    authority: string;
    version: number;
    seed: string;
    draft: BudgetDraft;
  } | null>(null);
  const [error, setError] = useState<{ key: string; value: BudgetEditorError } | null>(null);
  const draft =
    (mutation.pending || mutation.ambiguous) && mutation.submittedBudget
      ? budgetDraftFromBudget(mutation.submittedBudget)
      : edited?.key === key ||
          (edited?.authority === authority && edited.seed === seed && base.version > edited.version)
        ? edited.draft
        : original;
  const setDraft: Dispatch<SetStateAction<BudgetDraft>> = (update) => {
    if (!isCurrent() || mutation.pending || mutation.ambiguous || !mutation.canWrite) return;
    setEdited((previous) => ({
      key,
      authority,
      version: base.version,
      seed,
      draft:
        typeof update === "function"
          ? update(previous?.key === key ? previous.draft : draft)
          : update,
    }));
    setError(null);
  };
  const save = async (): Promise<BudgetSaveResult> => {
    if (!isCurrent() || !mutation.canWrite) return { outcome: "forbidden" };
    if (mutation.pending || mutation.ambiguous)
      return {
        outcome: "unavailable",
        message: "Reconcile the previous budget write before submitting again",
        ambiguous: true,
      };
    const built = buildBudgetFromDraft(base, draft);
    if (built.outcome === "invalid") {
      setError({ key, value: { field: built.field, reason: built.reason } });
      return built;
    }
    setError(null);
    const answer = await mutation.save(built.budget);
    if (isCurrent() && answer.outcome === "saved") {
      setAdopted({ authority, budget: answer.budget });
      setEdited(null);
    }
    return answer;
  };
  const reconcile = async () => {
    const answer = await mutation.reconcile();
    if (isCurrent() && answer.outcome === "saved") {
      setAdopted({ authority, budget: answer.budget });
      setEdited(null);
      setError(null);
    }
    return answer;
  };
  const reset = () => {
    if (!isCurrent() || mutation.pending || mutation.ambiguous) return;
    setEdited(null);
    setError(null);
    mutation.reset();
  };
  const invalid =
    mutation.result?.outcome === "invalid"
      ? { field: mutation.result.field, reason: mutation.result.reason }
      : null;
  return {
    ...mutation,
    draft,
    setDraft,
    dirty: serialize(draft) !== serialize(original),
    errors: error?.key === key ? error.value : invalid,
    save,
    reconcile,
    reset,
  };
}
