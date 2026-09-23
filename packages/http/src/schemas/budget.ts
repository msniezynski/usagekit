import * as v from "valibot";
import type { Budget as BudgetDto } from "@usagekit/core";
import { Budget } from "./index.js";
import { decodeWire } from "../wire.js";
export function parseBudget(input: unknown): BudgetDto | null {
  const parsed = v.safeParse(Budget, input);
  return parsed.success ? (decodeWire(JSON.stringify(parsed.output)) as BudgetDto) : null;
}
