import type { BudgetScope } from "./contracts.js";
export const defaultBudgetOrder: readonly BudgetScope["kind"][] = Object.freeze([
  "platform_pool",
  "principal",
  "group",
  "connection",
  "access_credential",
]);
