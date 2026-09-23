import type {
  Meter,
  AccessContext,
  OperationRef,
  UsageQuery,
  DefinedBudgetsQuery,
  ApplicableBudgetsQuery,
} from "@usagekit/core";
import type { RouteName } from "../schemas/index.js";
export function dispatchRead(meter: Meter, access: AccessContext, name: RouteName, input: unknown) {
  switch (name) {
    case "operation":
      return meter.getOperation(access, input as OperationRef);
    case "usage":
      return meter.usage(access, input as UsageQuery);
    case "defined":
      return meter.definedBudgets(access, input as DefinedBudgetsQuery);
    case "applicable":
      return meter.applicableBudgets(access, input as ApplicableBudgetsQuery);
    default:
      throw new Error("Unknown read");
  }
}
