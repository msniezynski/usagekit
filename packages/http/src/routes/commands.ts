import type {
  Meter,
  ExpireReservationsInput,
  ReserveInput,
  DispatchIntentInput,
  LeaseRenewalInput,
  RecoveryClaimInput,
  SettleInput,
  CorrectionInput,
  ReleaseInput,
} from "@usagekit/core";
import type { RouteName } from "../schemas/index.js";
export function dispatchCommand(meter: Meter, name: RouteName, input: Record<string, unknown>) {
  switch (name) {
    case "expire": {
      const { commandId: _, ...data } = input;
      return meter.expireReservations(data as ExpireReservationsInput);
    }
    case "reserve": {
      const { commandId: _, ...data } = input;
      return meter.reserve(data as ReserveInput);
    }
    case "intent":
      return meter.markDispatchIntent(input as DispatchIntentInput);
    case "renew": {
      const { commandId: _, ...data } = input;
      return meter.renewLease(data as LeaseRenewalInput);
    }
    case "claim": {
      const { commandId: _, ...data } = input;
      return meter.claimForRecovery(data as RecoveryClaimInput);
    }
    case "settle":
      return meter.settle(input as SettleInput);
    case "correct":
      return meter.correct(input as CorrectionInput);
    case "release":
      return meter.releaseUndispatched(input as ReleaseInput);
    default:
      throw new Error("Unknown command");
  }
}
