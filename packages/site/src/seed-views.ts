import type {
  BudgetsView,
  CoverageView,
  ExceptionsView,
  HeaderStatus,
  UsageSummaryView,
  UsageView,
} from "@usagekit/views";

export type SiteViews = {
  budgets: BudgetsView;
  header: HeaderStatus;
  summary: UsageSummaryView;
  usage: UsageView;
  coverage: CoverageView;
  exceptions: ExceptionsView;
};

/**
 * The seeded fixture views, rendered before the in-memory Meter finishes seeding in the browser
 * and in the prerendered HTML. seed-views.test.ts proves they equal the live views.
 */
export const seedViews: SiteViews = {
  budgets: {
    state: "ok",
    rows: [
      {
        id: "monthly-spend",
        version: 1,
        kind: "principal",
        target: "demo-workspace",
        traffic: {
          kind: "any",
        },
        window: "calendar_month",
        unit: "cents",
        epoch: "2026-10",
        resetsAt: "2026-11-01T00:00:00.000Z",
        limit: {
          text: "2500",
          unit: "cents",
          certainty: "measured",
        },
        used: {
          text: "1812",
          unit: "cents",
          certainty: "measured",
        },
        reserved: {
          text: "0",
          unit: "cents",
          certainty: "estimated",
        },
        remaining: {
          text: "688",
          unit: "cents",
          certainty: "measured",
        },
        boundary: {
          onExceed: "block",
        },
        alerts: [
          {
            key: "percent:80",
            at: {
              percent: 80,
            },
            crossed: false,
          },
        ],
        bar: {
          used: "72.48",
          reserved: "0",
          limit: "100",
          hardLimit: null,
          alerts: ["80"],
        },
        warningAt: null,
        redacted: false,
        level: "ok",
      },
    ],
    problem: null,
  },
  header: {
    state: "ok",
    level: "ok",
    bounds: [
      {
        budgetId: "monthly-spend",
        kind: "principal",
        target: "demo-workspace",
        unit: "cents",
        remaining: {
          text: "688",
          unit: "cents",
          certainty: "measured",
        },
        of: {
          text: "2500",
          unit: "cents",
          certainty: "measured",
        },
        epoch: "2026-10",
        resetsAt: "2026-11-01T00:00:00.000Z",
        level: "ok",
        warningAt: null,
        alerts: [
          {
            key: "percent:80",
            at: {
              percent: 80,
            },
            crossed: false,
          },
        ],
      },
    ],
    hidden: 0,
    problem: null,
  },
  summary: {
    state: "ok",
    complete: true,
    measurements: {
      requests: {
        text: "11",
        unit: "requests",
        certainty: "measured",
      },
      cents: {
        text: "1812",
        unit: "cents",
        certainty: "measured",
      },
    },
    cost: {
      text: "1812.0000",
      unit: "cents",
      certainty: "measured",
    },
    funding: [
      {
        key: '["byok","demo-workspace"]',
        fundingSource: "byok",
        costOwner: "demo-workspace",
        measurements: {
          requests: {
            text: "5",
            unit: "requests",
            certainty: "measured",
          },
          cents: {
            text: "563",
            unit: "cents",
            certainty: "measured",
          },
        },
        cost: {
          text: "563.0000",
          unit: "cents",
          certainty: "measured",
        },
        unknownOperations: "0",
      },
      {
        key: '["platform","platform"]',
        fundingSource: "platform",
        costOwner: "platform",
        measurements: {
          requests: {
            text: "6",
            unit: "requests",
            certainty: "measured",
          },
          cents: {
            text: "1249",
            unit: "cents",
            certainty: "measured",
          },
        },
        cost: {
          text: "1249.0000",
          unit: "cents",
          certainty: "measured",
        },
        unknownOperations: "0",
      },
    ],
    unknownOperations: "0",
    rowCount: 2,
    pages: 1,
    nextCursor: null,
    watermark: null,
    asOf: "2026-10-07T12:06:47.000Z",
    problem: null,
  },
  usage: {
    units: ["requests", "tokens", "cents"],
    groupBy: ["provider"],
    rows: [
      {
        key: '[[["provider","language"]],"platform","platform"]',
        dimensions: {
          provider: "language",
        },
        units: {
          requests: {
            text: "6",
            unit: "requests",
            certainty: "measured",
          },
          tokens: {
            text: "12490",
            unit: "tokens",
            certainty: "estimated",
          },
          cents: {
            text: "1249",
            unit: "cents",
            certainty: "measured",
          },
        },
        cost: {
          text: "1249.0000",
          unit: "cents",
          certainty: "measured",
        },
        certainty: "estimated",
        fundingSource: "platform",
        costOwner: "platform",
        unknownOperations: "0",
      },
      {
        key: '[[["provider","search"]],"byok","demo-workspace"]',
        dimensions: {
          provider: "search",
        },
        units: {
          requests: {
            text: "5",
            unit: "requests",
            certainty: "measured",
          },
          tokens: "unavailable",
          cents: {
            text: "563",
            unit: "cents",
            certainty: "measured",
          },
        },
        cost: {
          text: "563.0000",
          unit: "cents",
          certainty: "measured",
        },
        certainty: "measured",
        fundingSource: "byok",
        costOwner: "demo-workspace",
        unknownOperations: "0",
      },
    ],
    nextCursor: null,
    watermark: null,
    asOf: "2026-10-07T12:06:47.000Z",
    state: "ok",
    problem: null,
  },
  coverage: {
    origin: "meter",
    entries: [
      {
        state: "metered",
        count: "11",
        share: "68.75",
      },
      {
        state: "passthrough",
        count: "1",
        share: "6.25",
      },
      {
        state: "unpriced",
        count: "0",
        share: "0",
      },
      {
        state: "cached",
        count: "3",
        share: "18.75",
      },
      {
        state: "rate_limited",
        count: "1",
        share: "6.25",
      },
    ],
    total: "16",
    costExcludesUntracked: true,
    state: "ok",
    problem: null,
  },
  exceptions: {
    state: "empty",
    rows: [],
    nextCursor: null,
    asOf: "2026-10-07T12:06:47.000Z",
    problem: null,
  },
};
