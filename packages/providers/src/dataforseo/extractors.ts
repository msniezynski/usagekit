import { formatQuantity } from "@usagekit/core";
import type { BalanceSnapshot, BillingLine, Measurement, PriceRow } from "@usagekit/core";
import type { Extractors, ReceiptDraft } from "../types.js";
import { listEstimate } from "../prices.js";
import { pointer } from "../pointer.js";
import { moneyFromDollars, requestsMeasured } from "../receipts.js";

type Task = {
  id?: unknown;
  status_code?: unknown;
  cost?: unknown;
  path?: unknown;
  result?: unknown;
};
const tasksOf = (body: unknown): Task[] => {
  const tasks = pointer(body, "/tasks");
  return Array.isArray(tasks) ? (tasks as Task[]) : [];
};
const isCost = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const centsQuantity = (dollars: number) => ({
  value: moneyFromDollars(dollars).units,
  scale: 4,
  unit: "cents",
});
const priceListSource = "https://docs.dataforseo.com/v3/appendix/user_data/";

/**
 * Price object keys `api.func_type.func_name` to operation ids. The key layout follows the
 * documented field schema; a recorded user_data fixture confirms it. Unmapped keys, per-result
 * entries and free functions are skipped.
 */
export const priceKeys: Readonly<Record<string, string>> = {
  "serp.live.advanced": "serp.google.organic.live.advanced",
  "serp.task_post.organic": "serp.google.organic.task_post",
  ...Object.fromEntries(
    [
      "keyword_ideas",
      "keyword_suggestions",
      "related_keywords",
      "keyword_overview",
      "ranked_keywords",
      "domain_rank_overview",
      "historical_rank_overview",
      "relevant_pages",
    ].map((n) => [`dataforseo_labs.live.${n}`, `dataforseo_labs.google.${n}.live`]),
  ),
  ...Object.fromEntries(
    ["summary", "history", "backlinks"].map((n) => [`backlinks.live.${n}`, `backlinks.${n}.live`]),
  ),
};
const withPriority = new Set(["serp.google.organic.task_post"]);

function timestamp(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) \+00:00$/.exec(text);
  return m ? new Date(`${m[1]}T${m[2]}Z`).toISOString() : undefined;
}

export const extractors: Extractors = {
  estimate: listEstimate,
  /** priority 1 is normal (the documented default when absent), 2 is high; anything else is unreadable. */
  options: (operation, request) => {
    if (!operation.optionKeys?.includes("priority")) return {};
    const first = Array.isArray(request.body) ? (request.body[0] as Record<string, unknown>) : null;
    if (!first || typeof first !== "object") return {};
    const priority = first.priority ?? 1;
    return priority === 1 ? { priority: "normal" } : priority === 2 ? { priority: "high" } : {};
  },
  /**
   * Cost from the envelope `cost` (USD, every task of the call). A task status of 40000 or
   * more, or an HTTP error, marks the receipt failed with whatever the provider charged.
   * Deferred operations keep cost unknown and carry the task id for resolution.
   */
  extract: (operation, _request, response, body): ReceiptDraft => {
    const tasks = tasksOf(body),
      id = extractors.requestId(body),
      cost = pointer(body, "/cost"),
      status = pointer(body, "/status_code");
    const failed =
      response.status >= 400 ||
      (typeof status === "number" && status >= 40000) ||
      tasks.some((t) => typeof t.status_code === "number" && t.status_code >= 40000);
    const known = operation.costEvidence !== "deferred" && isCost(cost);
    const cents: Measurement = known
      ? { unit: "cents", quantity: centsQuantity(cost), certainty: "measured" }
      : { unit: "cents", quantity: null, certainty: "unknown" };
    return {
      measurements: [cents, requestsMeasured()],
      cost: known
        ? { certainty: "measured", money: moneyFromDollars(cost) }
        : { certainty: "unknown", money: null },
      ...(id ? { providerRequestId: id } : {}),
      cached: false,
      failed,
    };
  },
  requestId: (body) => {
    const id = tasksOf(body)[0]?.id;
    return typeof id === "string" && id ? id : undefined;
  },
  balance: (body): BalanceSnapshot => {
    const result = pointer(body, "/tasks/0/result/0") as Record<string, unknown> | undefined;
    const snapshot: BalanceSnapshot = { plan: "prepaid" };
    const balance = pointer(result, "/money/balance"),
      total = pointer(result, "/money/total"),
      login = pointer(result, "/login"),
      perMinute = pointer(result, "/rates/limits/minute/total");
    if (isCost(balance)) snapshot.remaining = centsQuantity(balance);
    if (isCost(balance) && isCost(total) && total >= balance)
      snapshot.used = {
        ...centsQuantity(total),
        value: centsQuantity(total).value - centsQuantity(balance).value,
      };
    if (typeof login === "string" && login) snapshot.accountIdentity = login;
    if (typeof perMinute === "number" && Number.isSafeInteger(perMinute))
      snapshot.rateLimitPerHour = perMinute * 60;
    return snapshot;
  },
  /** Maps price.api.func_type.func_name.priority to operation and priority option. */
  priceList: (body, checkedAt): PriceRow[] => {
    const price = pointer(body, "/tasks/0/result/0/price");
    const rows: PriceRow[] = [];
    if (!price || typeof price !== "object") return rows;
    for (const [api, types] of Object.entries(price as Record<string, unknown>))
      for (const [type, names] of Object.entries((types ?? {}) as Record<string, unknown>))
        for (const [name, priorities] of Object.entries((names ?? {}) as Record<string, unknown>)) {
          const operation = priceKeys[`${api}.${type}.${name}`];
          if (!operation) continue;
          for (const [priority, entry] of Object.entries(
            (priorities ?? {}) as Record<string, { cost_type?: unknown; cost?: unknown }>,
          )) {
            const level = priority.replace(/^priority_/, "");
            if (entry?.cost_type !== "per_request" || !isCost(entry.cost)) continue;
            if (!withPriority.has(operation) && level !== "normal") continue;
            rows.push({
              validFrom: checkedAt,
              operation,
              ...(withPriority.has(operation) ? { option: { priority: level } } : {}),
              unit: "cents",
              perUnit: formatQuantity(centsQuantity(entry.cost)),
              source: priceListSource,
              checkedAt,
            });
          }
        }
    return rows;
  },
  /** Task history lines: the charge of each posted task, matched by task id. */
  billingExport: (input): BillingLine[] =>
    tasksOf(input).flatMap((t) => {
      const occurredAt = timestamp(pointer(t, "/result/0/datetime"));
      if (typeof t.id !== "string" || !isCost(t.cost) || !occurredAt) return [];
      return [
        {
          providerRequestId: t.id,
          operation: "serp.google.organic.task_post",
          occurredAt,
          cost: moneyFromDollars(t.cost),
        },
      ];
    }),
};
