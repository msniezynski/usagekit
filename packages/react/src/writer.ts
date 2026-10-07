import type { Budget } from "@usagekit/core";

export type BudgetSaveResult =
  | { outcome: "saved"; budget: Budget }
  | { outcome: "conflict"; reason: string }
  | { outcome: "invalid"; field: string; reason: string }
  | { outcome: "forbidden" }
  | { outcome: "unavailable"; message: string; ambiguous: boolean };
export type BudgetReconciliation = BudgetSaveResult | { outcome: "not_saved" };
/** Host-owned administrative port. The host authenticates and authorizes every write independently. */
export type BudgetWriter = {
  save(budget: Budget): Promise<BudgetSaveResult>;
  /** Only return not_saved after authoritative proof; absence in a read is insufficient. */
  reconcile?(budget: Budget): Promise<BudgetReconciliation>;
};
