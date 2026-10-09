import type { ComponentProps } from "react";
import { UsageConnectionRow } from "@/components/usagekit/usage-connection-row";
import { UsageOverviewCard } from "@/components/usagekit/usage-overview-card";
import type { UsageCapPillProps } from "@/components/usagekit/usage-cap-pill";

type Row = ComponentProps<typeof UsageConnectionRow>;
type Card = Omit<ComponentProps<typeof UsageOverviewCard>, "title" | "children">;
export type Scenario = {
  key: string;
  label: string;
  card: Card;
  rows: readonly Row[];
  pill: Omit<UsageCapPillProps, "href" | "renderLink">;
};

const searchBreakdown = [
  {
    id: "rank",
    label: "Rank checks",
    value: "3,912 searches",
    tags: ["App 3,100", "Scheduled 812"],
  },
  {
    id: "research",
    label: "Keyword research",
    value: "688 searches",
    tags: ["API 412", "MCP 276"],
  },
];
const languageRow = (used: string, percent: number): Row => ({
  name: "Language model",
  tags: ["Platform credits"],
  status: { label: "Connected", tone: "positive" },
  summary: { value: `${Math.round(percent)}%`, percent },
  groups: [
    {
      id: "credits",
      readings: [
        {
          id: "app",
          label: "App & schedules",
          value: `${used} of $100.00 used`,
          percent,
        },
        { id: "api", label: "API & agents", value: "$4.10 of $50.00 used", percent: 8.2 },
      ],
      note: "Credits are charged to the workspace wallet, not the provider account.",
    },
  ],
  breakdown: [
    { id: "summaries", label: "Summaries", value: "1,204 requests", tags: ["App 1,204"] },
  ],
});
const backupRow: Row = {
  name: "Backup search",
  status: { label: "No budget", tone: "neutral" },
  summary: { value: "No cap", percent: null },
  groups: [
    {
      id: "own",
      readings: [
        { id: "app", label: "App & schedules", value: "No cap", percent: null },
        { id: "api", label: "API & agents", value: "No cap", percent: null },
      ],
      note: "Balance $12.40, checked 6 min ago. Does not expire.",
    },
  ],
};
const searchRow = (
  value: string,
  percent: number,
  status: Row["status"],
  extra: Partial<Row> = {},
): Row => ({
  name: "Search API",
  tags: ["Primary"],
  status,
  summary: { value: `${Math.floor(percent)}%`, percent, partial: extra.summary?.partial },
  groups: [
    {
      id: "own",
      readings: [
        { id: "app", label: "App & schedules", value, percent, partial: extra.summary?.partial },
        { id: "api", label: "API & agents", value: "No cap", percent: null },
      ],
      note: "6,820 searches left at the provider, checked 4 min ago. Resets with the billing cycle.",
    },
  ],
  notes: <p className="m-0">Usage can take up to 15 minutes to appear.</p>,
  breakdown: searchBreakdown,
  ...extra,
});
const metrics = (paid: string, requests: string, projected: string) => [
  { id: "paid", label: "Paid to providers", value: paid },
  { id: "requests", label: "Provider requests", value: requests },
  { id: "projected", label: "Projected spend", value: projected },
];
const card = (budget: Omit<Card["budget"], "label">, rest: Partial<Card> = {}): Card => ({
  description: "How much each provider can spend in this workspace each month.",
  period: "October 2026, resets in 22 days",
  budget: { warningAt: 80, ...budget, label: "Budget used" },
  metrics: metrics("$84.20", "12,480", "$151.30"),
  empty: "Connect a provider to see its usage here.",
  ...rest,
});

export const scenarios: readonly Scenario[] = [
  {
    key: "within",
    label: "Within budget",
    card: card({
      value: "46% of the tightest budget used",
      figure: "46%",
      caption: "Tightest: Search API, app and schedules",
      explanation: "On pace to stay within every budget this month.",
      percent: 46,
      partial: false,
    }),
    rows: [
      searchRow("4,600 of 10,000 searches used", 46, { label: "Connected", tone: "positive" }),
      languageRow("$21.40", 21.4),
      backupRow,
    ],
    pill: { state: "ready", percent: 46, label: "46% used", ariaLabel: "Budget 46% used" },
  },
  {
    key: "near",
    label: "Near limit",
    card: card(
      {
        value: "86% of the tightest budget used",
        figure: "86%",
        caption: "Tightest: Search API, app and schedules",
        explanation: "On pace to reach the Search API budget on October 24.",
        percent: 86,
        partial: false,
      },
      { metrics: metrics("$141.75", "21,050", "$212.40") },
    ),
    rows: [
      searchRow(
        "8,600 of 10,000 searches used",
        86,
        { label: "Near limit", tone: "warning" },
        { defaultOpen: true },
      ),
      languageRow("$48.90", 48.9),
      backupRow,
    ],
    pill: { state: "ready", percent: 86, label: "86% used", ariaLabel: "Budget 86% used" },
  },
  {
    key: "over",
    label: "Over limit",
    card: card(
      {
        value: "112% of the Search API budget used",
        figure: "112%",
        caption: "Search API passed its app and schedules budget",
        explanation: "Scheduled checks fall back to Backup search until the budget resets.",
        percent: 112,
        partial: false,
      },
      {
        metrics: metrics("$168.10", "24,920", "$240.00"),
        notice: {
          message: "Search API reached its budget. Checks now fall back to Backup search.",
          action: (
            <a className="font-medium underline underline-offset-4" href="#settings">
              Connection settings
            </a>
          ),
        },
      },
    ),
    rows: [
      searchRow("11,200 of 10,000 searches used", 112, {
        label: "Budget reached",
        tone: "exceeded",
      }),
      languageRow("$52.10", 52.1),
      { ...backupRow, status: { label: "Fallback active", tone: "warning" } },
    ],
    pill: { state: "ready", percent: 112, label: "112% used", ariaLabel: "Budget 112% used" },
  },
  {
    key: "partial",
    label: "Partial data",
    card: card(
      {
        value: "At least 62% of the tightest budget used",
        qualifier: "At least",
        figure: "62%",
        caption: "Tightest: Search API, app and schedules",
        explanation: "18 requests are still being measured, so these figures are lower bounds.",
        percent: 62.75,
        partial: true,
        meterLabel: "Confirmed budget used, partial data",
      },
      { metrics: metrics("At least $125.55", "At least 15,060", "Unknown") },
    ),
    rows: [
      searchRow(
        "At least 6,275 of 10,000 searches used",
        62.75,
        { label: "Still measuring", tone: "neutral" },
        { summary: { value: "62%", percent: 62.75, partial: true } },
      ),
      languageRow("$31.00", 31),
      backupRow,
    ],
    pill: {
      state: "ready",
      percent: 62.75,
      partial: true,
      label: "At least 62% used",
      ariaLabel: "At least 62% of the budget used",
    },
  },
  {
    key: "unknown",
    label: "Unknown",
    card: card(
      {
        value: "0%",
        percent: 0,
        partial: true,
        explanation: "Requests were sent, but none of their costs are confirmed yet.",
      },
      { metrics: metrics("Unknown", "At least 18", "Unknown") },
    ),
    rows: [
      searchRow(
        "Usage unknown",
        0,
        { label: "Still measuring", tone: "unknown" },
        { summary: { value: "Unknown", percent: 0, partial: true } },
      ),
    ],
    pill: { state: "ready", percent: 0, partial: true, label: "0% used" },
  },
  {
    key: "none",
    label: "No budget",
    card: card(
      {
        value: "No budget set",
        caption: "Set a monthly budget to get a warning before spend runs away.",
        percent: null,
        partial: false,
      },
      { metrics: metrics("$84.20", "12,480", "No budget") },
    ),
    rows: [
      { ...backupRow, name: "Search API", tags: ["Primary"] },
      { ...backupRow, name: "Language model" },
    ],
    pill: { state: "ready", percent: null, label: "No budget set" },
  },
  {
    key: "empty",
    label: "No connections",
    card: card(
      { value: "No budget set", percent: null, partial: false },
      {
        metrics: [],
        emptyAction: (
          <a
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium"
            href="#connect"
          >
            Connect a provider
          </a>
        ),
      },
    ),
    rows: [],
    pill: { state: "hidden" },
  },
  {
    key: "loading",
    label: "Loading",
    card: card({ value: "", percent: null, partial: false }, { loading: true }),
    rows: [],
    pill: { state: "hidden" },
  },
  {
    key: "failed",
    label: "Read failed",
    card: card(
      {
        value: "Unavailable",
        caption: "Figures stay hidden until usage can be read again.",
        percent: null,
        partial: false,
      },
      {
        metrics: metrics("Unavailable", "Unavailable", "Unavailable"),
        notice: {
          message: "Usage could not be read. Nothing below is a zero.",
          action: (
            <a className="font-medium underline underline-offset-4" href="#retry">
              Try again
            </a>
          ),
        },
        empty: "",
      },
    ),
    rows: [],
    pill: { state: "unavailable" },
  },
];

/** Native host usage: the shared card fed by an adapter's localized observations. */
export function NativeUsage({ scenario, id }: { scenario: Scenario; id?: string }) {
  return (
    <UsageOverviewCard id={id} title="Provider budgets" {...scenario.card}>
      {scenario.rows.map((row, index) => (
        <UsageConnectionRow key={row.name} index={index} {...row} />
      ))}
    </UsageOverviewCard>
  );
}
