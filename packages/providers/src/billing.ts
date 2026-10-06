import type { BillingLine } from "@usagekit/core";
import type { ProviderModule } from "./types.js";

export type ParsedBillingExport = {
  provider: string;
  fileHash: string;
  lines: readonly BillingLine[];
};

/** Exact USD numeric lexeme at the Meter's six-digit money scale. Never rounds. */
function exactCostUnits(source: unknown): bigint | null {
  if (typeof source !== "string") return null;
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
  if (!match) return null;
  const fraction = match[2] ?? "",
    exponent = Number(match[3] ?? "0");
  let coefficient = (match[1]! + fraction).replace(/^0+/, "");
  if (!coefficient) return 0n;
  if (!Number.isSafeInteger(exponent)) return null;
  let scale = fraction.length - exponent;
  const trimmed = coefficient.replace(/0+$/, "");
  scale -= coefficient.length - trimmed.length;
  coefficient = trimmed;
  if (scale > 6 || scale < -324) return null;
  if (coefficient.length + 6 - scale > 19) return null;
  const units = BigInt(coefficient) * 10n ** BigInt(6 - scale);
  return units <= 2n ** 63n - 1n ? units : null;
}

/** Parse the advertised export locally, hashing the original UTF-8 bytes before normalization.
 * This performs no provider request and grants no accounting or dispatch authority. The host
 * supplies its verified connection, window and attribution to Meter.importBilling separately.
 */
export async function parseBillingExport(
  provider: ProviderModule,
  original: string,
): Promise<ParsedBillingExport> {
  const { billingExport, id } = provider.descriptor;
  if (billingExport.kind === "none" || !provider.extractors.billingExport)
    throw new Error(`Billing export is unavailable for ${id}`);
  const bytes = new TextEncoder().encode(original);
  const input: unknown = billingExport.kind === "task-history" ? JSON.parse(original) : original;
  let lines = provider.extractors.billingExport(input);
  // The current task-history format has one row per task. Never silently import a partial
  // export when the descriptor parser cannot read a charge, identity or occurrence time.
  if (billingExport.kind === "task-history") {
    const tasks =
      input && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>).tasks
        : undefined;
    if (!Array.isArray(tasks) || lines.length !== tasks.length)
      throw new Error(`Invalid task-history billing export for ${id}`);
    // JSON.parse's source context retains the original numeric spelling even when a number
    // cannot survive binary floating point. Runtimes without it fail closed for charged rows.
    const lexical = JSON.parse(original, (_key, value: unknown, context?: { source?: string }) =>
      typeof value === "number" ? context?.source : value,
    ) as { tasks: { id?: unknown; cost?: unknown }[] };
    const exactCosts = new Map<string, bigint>();
    for (const task of lexical.tasks) {
      const exact = exactCostUnits(task.cost);
      if (exact === null || typeof task.id !== "string" || !task.id || exactCosts.has(task.id))
        throw new Error(`Invalid task-history billing cost for ${id}`);
      exactCosts.set(task.id, exact);
    }
    const matched = new Set<string>();
    lines = lines.map((line) => {
      const requestId = line.providerRequestId;
      if (!requestId || !exactCosts.has(requestId) || matched.has(requestId))
        throw new Error(`Invalid task-history billing identity for ${id}`);
      matched.add(requestId);
      return { ...line, cost: { units: exactCosts.get(requestId)!, currency: "USD" } };
    });
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const fileHash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { provider: id, fileHash, lines };
}
