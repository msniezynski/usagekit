import type { PriceRow, ProviderDescriptor, ProviderOperation } from "@usagekit/core";

const docs = "https://docs.dataforseo.com/v3/";
export const serpPricing = "https://dataforseo.com/pricing/serp/google-organic-serp-api";
export const labsPricing = "https://dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api";
export const backlinksPricing = "https://dataforseo.com/pricing/backlinks/backlinks";
const checked = "2026-09-25";

const live = (id: string, label: string, path: string): ProviderOperation => ({
  id,
  label,
  billable: true,
  match: [{ method: "POST", path }],
  costEvidence: "response",
});
const free = (
  id: string,
  label: string,
  method: "GET" | "POST",
  path: string,
): ProviderOperation => ({
  id,
  label,
  billable: false,
  match: [{ method, path }],
  costEvidence: "response",
});
const labs = [
  ["keyword_ideas", "Keyword ideas"],
  ["keyword_suggestions", "Keyword suggestions"],
  ["related_keywords", "Related keywords"],
  ["keyword_overview", "Keyword overview"],
  ["ranked_keywords", "Ranked keywords"],
  ["domain_rank_overview", "Domain rank overview"],
  ["historical_rank_overview", "Historical rank overview"],
  ["relevant_pages", "Relevant pages"],
] as const;
const backlinks = [
  ["summary", "Backlinks summary"],
  ["history", "Backlinks history"],
  ["backlinks", "Backlinks live"],
] as const;

const row = (
  operation: string,
  perUnit: string,
  source: string,
  option?: Record<string, string>,
): PriceRow => ({
  validFrom: checked,
  operation,
  ...(option ? { option } : {}),
  unit: "cents",
  perUnit,
  source,
  checkedAt: checked,
});

/**
 * Provider A: cost per call in every response, prepaid money balance, basic auth. List prices
 * are the per-task base price in cents; per-result charges, depth multipliers and paid
 * parameters come from the receipt.
 */
export const descriptor: ProviderDescriptor = {
  id: "dataforseo",
  label: "DataForSEO",
  upstream: "https://api.dataforseo.com",
  auth: { kind: "basic" },
  stripRequestHeaders: ["authorization"],
  billing: { unit: "cents", cycle: "prepaid" },
  plans: [{ id: "prepaid", label: "Prepaid balance", cycle: "prepaid", allowanceMode: "hard" }],
  prices: [
    row("serp.google.organic.live.advanced", "0.2", serpPricing),
    row("serp.google.organic.task_post", "0.06", serpPricing, { priority: "normal" }),
    row("serp.google.organic.task_post", "0.12", serpPricing, { priority: "high" }),
    ...labs.map(([name]) =>
      row(
        `dataforseo_labs.google.${name}.live`,
        name === "historical_rank_overview" ? "12" : "1.2",
        labsPricing,
      ),
    ),
    ...backlinks.map(([name]) => row(`backlinks.${name}.live`, "2.4", backlinksPricing)),
  ],
  priceList: {
    kind: "endpoint",
    operation: "appendix.user_data",
    pointer: "/tasks/0/result/0/price",
    mapping: "provider-specific",
  },
  operations: [
    live(
      "serp.google.organic.live.advanced",
      "Google organic SERP, live advanced",
      "/v3/serp/google/organic/live/advanced",
    ),
    {
      id: "serp.google.organic.task_post",
      label: "Google organic SERP, task post",
      billable: true,
      match: [{ method: "POST", path: "/v3/serp/google/organic/task_post" }],
      optionKeys: ["priority"],
      costEvidence: "deferred",
    },
    free(
      "serp.google.organic.tasks_ready",
      "Google organic SERP, tasks ready",
      "GET",
      "/v3/serp/google/organic/tasks_ready",
    ),
    free(
      "serp.google.organic.task_get.advanced",
      "Google organic SERP, task get advanced",
      "GET",
      "/v3/serp/google/organic/task_get/advanced/:id",
    ),
    ...labs.map(([name, label]) =>
      live(`dataforseo_labs.google.${name}.live`, label, `/v3/dataforseo_labs/google/${name}/live`),
    ),
    ...backlinks.map(([name, label]) =>
      live(`backlinks.${name}.live`, label, `/v3/backlinks/${name}/live`),
    ),
    free(
      "appendix.user_data",
      "User data (balance, limits, prices)",
      "GET",
      "/v3/appendix/user_data",
    ),
    free("dataforseo_labs.status", "Labs status", "GET", "/v3/dataforseo_labs/status"),
  ],
  balance: {
    operation: "appendix.user_data",
    // money.balance is USD; the balance extractor converts it to cents. rates.limits.minute.total
    // is per minute; the extractor reports it per hour.
    fields: {
      remaining: "/tasks/0/result/0/money/balance",
      remainingUnit: "cents",
      accountIdentity: "/tasks/0/result/0/login",
      rateLimitPerHour: "/tasks/0/result/0/rates/limits/minute/total",
    },
  },
  billingExport: {
    kind: "task-history",
    operation: "serp.google.organic.task_get.advanced",
    granularity: "per-request",
    matchKey: "providerRequestId",
  },
  rateLimits: [{ scope: "account", perMinute: 2000 }],
  docs: { pricing: serpPricing, api: docs },
};
