import { describe, expect, it } from "vitest";
import {
  headerStatusFromBudgets,
  loadBudgetsView,
  loadCoverageView,
  loadExceptionsView,
  loadUsageSummary,
  loadUsageView,
} from "@usagekit/views";
import {
  budgetQuery,
  coverageQuery,
  createSiteMeterFixture,
  exceptionsQuery,
  fixtureAccess,
  summaryQuery,
  usageQuery,
} from "./meter-fixture.js";
import { seedViews } from "./seed-views.js";

// Watermarks are random read identities, not figures.
const figures = (value: unknown) =>
  JSON.parse(JSON.stringify(value, (key, item: unknown) => (key === "watermark" ? null : item)));

describe("site meter fixture", () => {
  it("prerenders exactly the views of the seeded in-memory Meter", async () => {
    const fixture = createSiteMeterFixture();
    await Promise.all([fixture.seed(), fixture.seed()]);
    const budgets = await loadBudgetsView(fixture.meter, fixtureAccess, budgetQuery);
    expect(
      figures({
        budgets,
        header: headerStatusFromBudgets(budgets),
        summary: await loadUsageSummary(fixture.meter, fixtureAccess, summaryQuery),
        usage: await loadUsageView(fixture.meter, fixtureAccess, usageQuery),
        coverage: await loadCoverageView(fixture.meter, fixtureAccess, coverageQuery),
        exceptions: await loadExceptionsView(fixture.meter, fixtureAccess, exceptionsQuery),
      }),
    ).toEqual(figures(seedViews));
  });

  it("reserves before dispatch, holds unknown outcomes and blocks without headroom", async () => {
    const fixture = createSiteMeterFixture();
    await fixture.seed();
    const timedOut = await fixture.start("language");
    if (timedOut.kind !== "dispatched") throw Error("expected a dispatch");
    const pending = await fixture.finish(timedOut, false);
    expect(pending).toMatchObject({ status: "pending", estimate: "150.0000", actual: null });
    const held = await loadBudgetsView(fixture.meter, fixtureAccess, budgetQuery);
    expect(held.rows[0]?.reserved).toMatchObject({ text: "150" });
    const exceptions = await loadExceptionsView(fixture.meter, fixtureAccess, exceptionsQuery);
    expect(exceptions.rows.map((row) => row.kind)).toEqual(["pending"]);
    expect(await fixture.settleEvidence(pending)).toMatchObject({ status: "evidence" });
    const statuses: string[] = [];
    for (let index = 0; index < 6; index++) {
      const started = await fixture.start("language");
      statuses.push(
        started.kind === "blocked" ? "blocked" : (await fixture.finish(started, true)).status,
      );
    }
    expect(statuses).toEqual(["settled", "settled", "settled", "settled", "blocked", "blocked"]);
    const blocked = await loadBudgetsView(fixture.meter, fixtureAccess, budgetQuery);
    expect(blocked.rows[0]).toMatchObject({ level: "warning", reserved: { text: "0" } });
  });
});
