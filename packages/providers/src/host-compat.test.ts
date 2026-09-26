import { expect, test } from "vitest";
import { createCatalog, dataforseo, serpapi } from "./index.js";
// Public endpoint inventory of host A, checked 2026-09-26. No host code is copied.
const paid = [
  "serp/google/organic/live/advanced",
  "serp/google/organic/task_post",
  ...[
    "keyword_ideas",
    "keyword_suggestions",
    "related_keywords",
    "keyword_overview",
    "ranked_keywords",
    "domain_rank_overview",
    "historical_rank_overview",
    "relevant_pages",
  ].map((operation) => `dataforseo_labs/google/${operation}/live`),
  ...["summary", "history", "backlinks"].map((operation) => `backlinks/${operation}/live`),
];
const free = [
  "serp/google/organic/tasks_ready",
  "serp/google/organic/task_get/advanced",
  "appendix/user_data",
  "dataforseo_labs/status",
];
test("host A endpoint inventory maps to descriptors without changing requests", () => {
  const catalog = createCatalog({
    providers: [dataforseo, serpapi],
    enabled: ["dataforseo", "serpapi"],
  });
  for (const [paths, method, billable] of [
    [paid, "POST", true],
    [free, "GET", false],
  ] as const)
    for (const path of paths) {
      const request = {
          method,
          url: `https://api.dataforseo.com/v3/${path}${path.includes("task_get") ? "/fixture-task" : ""}`,
        },
        before = structuredClone(request);
      expect(catalog.match("dataforseo", request)).toMatchObject({
        operation: { id: path.replaceAll("/", "."), billable },
      });
      expect(request).toEqual(before);
    }
  for (const [operation, billable] of [
    ["search", true],
    ["account", false],
  ] as const)
    expect(
      catalog.match("serpapi", { method: "GET", url: `https://serpapi.com/${operation}.json` }),
    ).toMatchObject({ operation: { id: operation, billable } });
});
