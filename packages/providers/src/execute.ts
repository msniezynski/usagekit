import type {
  DispatchGrant,
  Meter,
  MeterReserveInput,
  Operation,
  ReserveResult,
  SettleResult,
} from "@usagekit/core";
import type { Catalog } from "./catalog.js";
import type { ProviderRequest, ProviderResponse, ReceiptDraft } from "./types.js";

export type ProviderExecution =
  | {
      outcome: "completed";
      response: ProviderResponse;
      body: unknown;
      operation: Operation | null;
      accounting: "metered" | "passthrough";
    }
  | { outcome: "not_dispatched"; result: ReserveResult | DispatchGrant }
  | { outcome: "transport_failed"; operation: Operation | null }
  | { outcome: "accounting_failed"; result: SettleResult };
export type ProviderExecutionInput = {
  meter: Meter;
  catalog: Catalog;
  input: Omit<MeterReserveInput, "operation" | "options">;
  request: ProviderRequest;
  /** Reads the entire response before resolving. Inject credentials here, never in accounting. */
  dispatch(request: ProviderRequest): Promise<{ response: ProviderResponse; body: unknown }>;
  now?: () => Date;
  holder?: string;
  leaseTtlMs?: number;
};
/** Execute one provider request. A replay, rejected reserve or lost grant never calls dispatch.
 * Long transports must finish within leaseTtlMs; streaming/recovery workers are host-owned. */
export async function executeProviderRequest({
  meter,
  catalog,
  input,
  request,
  dispatch,
  now = () => new Date(),
  holder = "provider-wrapper",
  leaseTtlMs = 60000,
}: ProviderExecutionInput): Promise<ProviderExecution> {
  const matched = catalog.match(input.provider, request);
  const { estimate, ...base } = input;
  const reserved = await meter.reserve({
    ...base,
    operation: matched.operation === "unknown" ? "unknown" : matched.operation.id,
    ...(matched.operation === "unknown"
      ? {}
      : { ...(estimate === undefined ? {} : { estimate }), options: matched.options }),
  });
  if (matched.operation === "unknown") return { outcome: "not_dispatched", result: reserved };
  const ref = {
    namespace: input.scope.namespace,
    principal: input.scope.principal,
    operationId: input.operationId,
  };
  let grant: { version: number; leaseId: string } | undefined;
  if (reserved.outcome === "reserved" && !reserved.replayed) {
    const intent = await meter.markDispatchIntent({
      ...ref,
      commandId: input.operationId + ":intent",
      expectedVersion: reserved.operation.version,
      holder,
      leaseTtlMs,
    });
    if (!("granted" in intent) || !intent.granted)
      return { outcome: "not_dispatched", result: intent };
    grant = { version: intent.operation.version, leaseId: intent.lease.leaseId };
  } else if (reserved.outcome !== "passthrough" || reserved.replayed)
    return { outcome: "not_dispatched", result: reserved };
  const occurredAt = now().toISOString();
  const settle = (receipt: ReceiptDraft) =>
    grant
      ? meter.settle({
          ...ref,
          commandId: input.operationId + ":settle",
          expectedVersion: grant.version,
          authority: { kind: "lease", leaseId: grant.leaseId },
          receipt: {
            ...receipt,
            id: input.operationId + ":receipt",
            occurredAt,
            recordedAt: now().toISOString(),
          },
        })
      : undefined;
  let returned: { response: ProviderResponse; body: unknown }, receipt: ReceiptDraft;
  try {
    returned = await dispatch(request);
    receipt = catalog.extract(
      input.provider,
      matched.operation.id,
      request,
      returned.response,
      returned.body,
    );
  } catch {
    const settled = await settle({
      measurements: [
        {
          unit: "requests",
          quantity: { unit: "requests", value: 1n, scale: 0 },
          certainty: "measured",
        },
      ],
      cost: { certainty: "unknown", money: null },
      cached: false,
      failed: true,
    });
    if (settled && settled.outcome !== "settled")
      return { outcome: "accounting_failed", result: settled };
    return { outcome: "transport_failed", operation: settled?.operation ?? null };
  }
  const settled = await settle(receipt);
  if (settled && settled.outcome !== "settled")
    return { outcome: "accounting_failed", result: settled };
  return {
    outcome: "completed",
    ...returned,
    operation: settled?.operation ?? null,
    accounting: grant ? "metered" : "passthrough",
  };
}
