import type {
  ConnectionPolicy,
  MeterReserveInput,
  Operation,
  PricingCatalog,
  ReserveInput,
  ValidationFailure,
} from "@usagekit/core";

/** Host lookup of a connection's provider, plan, manual prices and tracking policy. */
export type ConnectionResolver = (
  connectionId: string,
) => Promise<ConnectionPolicy | undefined> | ConnectionPolicy | undefined;

/** What reserve does with a request after the catalog and the connection policy spoke. */
export type ReserveResolution =
  | { kind: "reserve"; input: ReserveInput }
  | { kind: "count"; state: "passthrough" | "unpriced" }
  | { kind: "invalid"; failure: ValidationFailure };

const invalid = (field: string, reason: string): ReserveResolution => ({
  kind: "invalid",
  failure: { outcome: "invalid", field, reason },
});

/**
 * Order: a stored operation replays with its own estimate; then the connection's tracking
 * policy and free catalog operations count as passthrough; then a given estimate is used as is;
 * then the catalog resolves one (manual, measured, list, unknown), and an operation the catalog
 * does not know counts as unpriced.
 */
const provenanceOf = (
  estimateSource?: MeterReserveInput["estimateSource"],
  providerPriceVersion?: string,
) => ({
  ...(estimateSource ? { estimateSource } : {}),
  ...(providerPriceVersion ? { providerPriceVersion } : {}),
});

export async function resolveReserve(
  requested: MeterReserveInput,
  existing: Operation | null,
  catalog?: PricingCatalog,
  resolveConnection?: ConnectionResolver,
): Promise<ReserveResolution> {
  const { options = {}, estimate, estimateSource, providerPriceVersion, ...rest } = requested;
  // A retry that omits the estimate replays the stored one, including provenance. A retry that
  // sends an estimate keeps only the provenance on that request.
  if (existing) {
    if (estimate === undefined)
      return {
        kind: "reserve",
        input: {
          ...rest,
          estimate: existing.estimate,
          ...provenanceOf(existing.estimateSource, existing.providerPriceVersion),
        },
      };
    return {
      kind: "reserve",
      input: { ...rest, estimate, ...provenanceOf(estimateSource, providerPriceVersion) },
    };
  }
  const policy =
    catalog && resolveConnection ? await resolveConnection(rest.scope.connection) : undefined;
  if (policy && policy.provider !== rest.provider)
    return invalid("provider", "differs from the connection provider");
  if (policy && catalog) {
    const known = catalog.operationsOf(policy.provider).find((o) => o.id === rest.operation);
    if (policy.tracking?.[rest.operation] === "passthrough" || known?.billable === false)
      return { kind: "count", state: "passthrough" };
    if (estimate === undefined) {
      if (!known) return { kind: "count", state: "unpriced" };
      const { tracking: _, ...connection } = policy,
        resolved = catalog.estimate(
          { ...connection, id: rest.scope.connection },
          rest.operation,
          options,
        );
      return {
        kind: "reserve",
        input: {
          ...rest,
          estimate: resolved.quantities,
          estimateSource: resolved.source,
          ...(resolved.priceVersion ? { providerPriceVersion: resolved.priceVersion } : {}),
        },
      };
    }
  }
  if (estimate === undefined)
    return invalid(
      "estimate",
      catalog && resolveConnection ? "unknown connection" : "required without a catalog",
    );
  return {
    kind: "reserve",
    input: { ...rest, estimate, ...provenanceOf(estimateSource, providerPriceVersion) },
  };
}
