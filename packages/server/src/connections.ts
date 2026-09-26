import type { Catalog } from "@usagekit/providers";
import type { ConnectionMetadata } from "./vault.js";
/** Reject policy typos at the boundary; omitted fields preserve policy on key rotation. */
export function connectionMetadata(
  body: Record<string, unknown>,
  catalog?: Catalog,
): ConnectionMetadata | null {
  const provider = String(body.provider);
  if (
    body.plan !== undefined &&
    (typeof body.plan !== "string" || !catalog?.plansOf(provider).some((p) => p.id === body.plan))
  )
    return null;
  const tracking = body.tracking;
  if (
    tracking !== undefined &&
    (!tracking ||
      typeof tracking !== "object" ||
      Array.isArray(tracking) ||
      Object.entries(tracking).some(
        ([id, mode]) =>
          !catalog?.operationsOf(provider).some((o) => o.id === id) ||
          !["metered", "passthrough"].includes(String(mode)),
      ))
  )
    return null;
  const manualPrices = body.manualPrices;
  if (body.overage !== undefined && typeof body.overage !== "boolean") return null;
  if (
    manualPrices !== undefined &&
    (!manualPrices ||
      typeof manualPrices !== "object" ||
      Array.isArray(manualPrices) ||
      Object.entries(manualPrices).some(([id, price]) => {
        if (
          !catalog?.operationsOf(provider).some((o) => o.id === id && o.billable) ||
          !price ||
          typeof price !== "object" ||
          Array.isArray(price)
        )
          return true;
        const q = price as Record<string, unknown>;
        return (
          typeof q.value !== "string" ||
          !/^\d{1,38}$/.test(q.value) ||
          !Number.isInteger(q.scale) ||
          (q.scale as number) < 0 ||
          (q.scale as number) > 18 ||
          q.unit !== catalog.providers().find((p) => p.id === provider)?.billing.unit
        );
      }))
  )
    return null;
  return {
    ...(manualPrices === undefined
      ? {}
      : { manualPrices: manualPrices as NonNullable<ConnectionMetadata["manualPrices"]> }),
    ...(body.overage === undefined ? {} : { overage: body.overage as boolean }),
    ...(body.plan === undefined ? {} : { plan: body.plan as string }),
    ...(tracking === undefined
      ? {}
      : { tracking: tracking as NonNullable<ConnectionMetadata["tracking"]> }),
  };
}
