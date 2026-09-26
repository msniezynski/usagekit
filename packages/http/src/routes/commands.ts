import type {
  Meter,
  ExpireReservationsInput,
  MeterReserveInput,
  DispatchIntentInput,
  LeaseRenewalInput,
  RecoveryClaimInput,
  SettleInput,
  CorrectionInput,
  ReleaseInput,
  CountRequestInput,
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
      return meter.reserve(data as MeterReserveInput);
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
    case "count":
      return meter.countRequest(input as CountRequestInput);
    default:
      throw new Error("Unknown command");
  }
}
