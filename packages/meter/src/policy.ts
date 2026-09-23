import { defaultBudgetOrder } from "@usagekit/core";
import type { BudgetScope } from "@usagekit/core";
export type MeterPolicy = {
  budgetOrder: readonly BudgetScope["kind"][];
  requireEstimateForBoundedUnits: true;
};
export const defaultPolicy: MeterPolicy = {
  budgetOrder: defaultBudgetOrder,
  requireEstimateForBoundedUnits: true,
};
