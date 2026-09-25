import { fromDecimalString } from "@usagekit/core";
import type { Operation, SettleInput, ReleaseInput } from "@usagekit/core";
import { type Context, access, string, quantity, UsageError } from "../context.js";
import { journal } from "../journal.js";
import type { Connection } from "./provider.js";
export async function report(c: Context, command?: string) {
  const o = c.options,
    commandId = string(o, "command-id", crypto.randomUUID());
  if (command === "expire")
    return { result: await c.meter.expireReservations({ namespace: "local" }), refused: false };
  if (command === "reserve") {
    const leaseTtlMs = Number(string(o, "lease-ms", "60000"));
    if (!Number.isSafeInteger(leaseTtlMs) || leaseTtlMs <= 0) throw new UsageError();
    const connection = string(o, "connection");
    // Connection tags are snapshotted into the reservation; later relabeling never rewrites history.
    const tags = (await c.rest<Connection[]>("/providers/connections")).find(
      (e) => e.connectionId === connection,
    )?.tags;
    const i = {
      operationId: string(o, "operation", commandId),
      scope: {
        namespace: "local",
        principal: "local",
        connection,
        ...(tags?.length ? { tags } : {}),
      },
      fundingSource: "byok" as const,
      costOwner: "local",
      surface: "programmatic" as const,
      source: "cli" as const,
      provider: string(o, "provider"),
      operation: string(o, "feature", "request"),
      estimate: string(o, "estimate").split(",").map(quantity),
    };
    const r = await c.meter.reserve(i);
    if (r.outcome !== "reserved" || r.replayed) return { result: r, refused: true };
    const result = await c.meter.markDispatchIntent({
      namespace: "local",
      principal: "local",
      operationId: i.operationId,
      commandId: commandId + ":intent",
      expectedVersion: r.operation.version,
      holder: "cli:" + commandId,
      leaseTtlMs,
    });
    return { result, refused: !("granted" in result && result.granted) };
  }
  if (command !== "settle" && command !== "release") throw new UsageError();
  const ref = { namespace: "local", principal: "local", operationId: string(o, "operation") };
  const semantic = {
    command,
    ref,
    quantity: o.quantity,
    cost: o.cost,
    reason: o.reason,
    occurredAt: o["occurred-at"],
    failed: Boolean(o.failed),
  };
  const operation = async (): Promise<Operation> => {
    const r = await c.meter.getOperation(access, ref);
    if (r.outcome !== "ok" || !r.value) throw new UsageError();
    return r.value;
  };
  // Server URL separates identities for independently operated servers. No token or key is persisted.
  const identity = c.baseUrl + ":" + ref.operationId + ":" + commandId;
  if (command === "release") {
    const payload = await journal<ReleaseInput>(c.configDir, identity, semantic, async () => ({
      ...ref,
      commandId,
      expectedVersion: (await operation()).version,
      reason: string(o, "reason", "cancelled_before_dispatch"),
    }));
    return { result: await c.meter.releaseUndispatched(payload), refused: false };
  }
  const quantities = string(o, "quantity").split(",").map(quantity),
    cost = fromDecimalString(string(o, "cost"));
  const payload = await journal<SettleInput>(c.configDir, identity, semantic, async () => {
    const op = await operation(),
      now = new Date().toISOString();
    if (!op.lease) throw new UsageError();
    return {
      ...ref,
      commandId,
      expectedVersion: op.version,
      authority: { kind: "lease", leaseId: op.lease.leaseId },
      receipt: {
        id: commandId,
        measurements: quantities.map((q) => ({ unit: q.unit, quantity: q, certainty: "measured" })),
        cost: { certainty: "measured", money: cost },
        occurredAt: string(o, "occurred-at", now),
        recordedAt: now,
        cached: false,
        failed: Boolean(o.failed),
      },
    };
  });
  return { result: await c.meter.settle(payload), refused: false };
}
