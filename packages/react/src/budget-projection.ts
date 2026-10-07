import { useMemo } from "react";
import { projectBudgetExhaustion } from "@usagekit/views";
import type { BudgetProjection, BudgetProjectionInput } from "@usagekit/views";
import { serialize } from "./keys.js";

/** Pure observed-pace forecast; it never probes a provider or treats a request quote as spend. */
export function useBudgetProjection(input: BudgetProjectionInput | null): BudgetProjection {
  const key = serialize(input);
  return useMemo(
    () =>
      input
        ? projectBudgetExhaustion(input)
        : {
            kind: "unavailable",
            reason: "No observed budget period",
          },
    [key],
  );
}
