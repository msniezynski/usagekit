import * as v from "valibot";
import type { Budget as BudgetDto } from "@usagekit/core";
import { Budget } from "./index.js";
import { decodeWire } from "../wire.js";
/** Parses a wire budget; the deprecated onExceed alias warn becomes allow. */
export function parseBudget(input: unknown): BudgetDto | null {
  const parsed = v.safeParse(Budget, input);
  if (!parsed.success) return null;
  const budget = decodeWire(JSON.stringify(parsed.output)) as BudgetDto;
  return (budget.onExceed as string) === "warn" ? { ...budget, onExceed: "allow" } : budget;
}
