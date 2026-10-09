import { execFile, execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import type { ComponentType, ReactNode } from "react";
import { createManualClock, createMemoryStore } from "@usagekit/store";
import { createMeter } from "@usagekit/meter";
import {
  MeterProvider,
  ProviderManagementProvider,
  createMeterQueryClient,
  createProviderQueryClient,
} from "@usagekit/react";
import type { BudgetWriter } from "@usagekit/react";
import { legacy, styleMap, styleSource, styles } from "../styles/styles.mjs";
import {
  createDemoProviderPort,
  demoProviders,
  initialAllocations,
  initialConnections,
} from "../consumers/radix/app/demo-providers.js";
import type { ProviderCommand, ProviderReadResult } from "@usagekit/views";
import type { AccessContext, Budget, ReserveInput } from "@usagekit/core";
import { blockNames, variants } from "./index.js";
import type { Variant } from "./index.js";

/** The shadcn CLI version these tests pin; the root lockfile installs exactly this one. */
const shadcnVersion = "4.21.0";
const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "../..");
const cli = join(repo, "node_modules/shadcn/dist/index.js");
// Inside the workspace root (ignored by Git and Prettier): the test module loader serves files
// under its root only. Each run removes its own directory.
mkdirSync(join(root, ".work"), { recursive: true });
const work = mkdtempSync(join(root, ".work", "run-"));
const out = join(work, "registry");
const npmLog = join(work, "npm.log");
const requests: string[] = [];
let server: Server;
let registryUrl: string;

/**
 * Loopback stand-in for the public registry: bare registryDependencies resolve to the primitive
 * files already committed in each consumer, and the base color is an empty palette. No network.
 */
function serve(): Promise<void> {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    requests.push(url);
    res.setHeader("content-type", "application/json");
    if (/^\/r\/colors\/[a-z]+\.json$/.test(url)) {
      const empty = { light: {}, dark: {} };
      res.end(
        JSON.stringify({
          inlineColors: empty,
          cssVars: empty,
          cssVarsV4: empty,
          inlineColorsTemplate: "",
          cssVarsTemplate: "",
        }),
      );
      return;
    }
    const match = /^\/r\/styles\/([a-z0-9-]+)\/([a-z-]+)\.json$/.exec(url);
    const variant: Variant | null = match
      ? match[1]!.startsWith("base")
        ? "base"
        : "radix"
      : null;
    const file = match && join(root, "consumers", variant!, "components/ui", `${match[2]}.tsx`);
    if (!file || !existsSync(file)) {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    res.end(
      JSON.stringify({
        name: match![2],
        type: "registry:ui",
        files: [
          {
            path: `ui/${match![2]}.tsx`,
            type: "registry:ui",
            content: readFileSync(file, "utf8"),
          },
        ],
      }),
    );
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () => {
      registryUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/r`;
      done();
    }),
  );
}

/** Copies a committed consumer, links the workspace node_modules and adds every block to it. */
async function addBlocks(variant: Variant): Promise<string> {
  const host = join(work, variant);
  cpSync(join(root, "consumers", variant), host, { recursive: true });
  symlinkSync(join(repo, "node_modules"), join(host, "node_modules"), "dir");
  const bin = join(work, "bin");
  mkdirSync(bin, { recursive: true });
  // The CLI installs pinned block dependencies with npm; this stub records them offline.
  writeFileSync(join(bin, "npm"), `#!/bin/sh\necho "$@" >> "${npmLog}"\n`);
  chmodSync(join(bin, "npm"), 0o755);
  // Asynchronous on purpose: the loopback registry answers from this same process.
  await promisify(execFile)(
    process.execPath,
    [
      cli,
      "add",
      ...blockNames.map((n) => join(out, "r", variant, `${n}.json`)),
      "--yes",
      "--overwrite",
    ],
    {
      cwd: host,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        REGISTRY_URL: registryUrl,
      },
    },
  );
  return host;
}

const hosts = {} as Record<Variant, string>;
beforeAll(async () => {
  execFileSync(process.execPath, [join(repo, "scripts/registry-build.mjs"), "--out", out]);
  await serve();
  for (const variant of variants) hosts[variant] = await addBlocks(variant);
}, 180000);
afterAll(() => {
  server?.close();
  rmSync(work, { recursive: true, force: true });
});
afterEach(cleanup);

describe("shadcn add against both consumers", () => {
  test("the pinned CLI version runs", () => {
    expect(execFileSync(process.execPath, [cli, "--version"]).toString().trim()).toBe(
      shadcnVersion,
    );
  });
  test.each(variants)("%s: every block lands unchanged and primitives stay intact", (variant) => {
    const host = hosts[variant];
    for (const name of blockNames)
      expect(readFileSync(join(host, "components/usagekit", `${name}.tsx`), "utf8")).toBe(
        styleSource(
          readFileSync(join(root, "registry", variant, name, `${name}.tsx`), "utf8"),
          styleMap(styles.find((style) => style.name === legacy[variant])!.sheet),
        ),
      );
    for (const primitive of [
      "table",
      "card",
      "badge",
      "tooltip",
      "select",
      "button",
      "input",
      "label",
    ])
      expect(readFileSync(join(host, "components/ui", `${primitive}.tsx`), "utf8")).toBe(
        readFileSync(join(root, "consumers", variant, "components/ui", `${primitive}.tsx`), "utf8"),
      );
    expect(readFileSync(join(host, "app/index.css"), "utf8")).toBe(
      readFileSync(join(root, "consumers", variant, "app/index.css"), "utf8"),
    );
  });
  test("block dependencies were requested at the pinned versions, offline", () => {
    const version = (name: string) =>
      JSON.parse(readFileSync(join(repo, "packages", name, "package.json"), "utf8")).version;
    const log = readFileSync(npmLog, "utf8");
    for (const name of ["react", "views", "core"])
      expect(log).toContain(`@usagekit/${name}@${version(name)}`);
    expect(requests.every((url) => url.startsWith("/r/"))).toBe(true);
    expect(requests.some((url) => url.startsWith("/r/styles/base-vega/"))).toBe(true);
    expect(requests.some((url) => url.startsWith("/r/styles/new-york/"))).toBe(true);
  });
  test.each(variants)("%s: the consumer typechecks with the added blocks", (variant) => {
    const host = hosts[variant];
    const paths = Object.fromEntries(
      ["core", "views", "react", "store", "meter"].map((n) => [
        `@usagekit/${n}`,
        [join(repo, "packages", n, "src/index.ts")],
      ]),
    );
    writeFileSync(
      join(host, "tsconfig.check.json"),
      JSON.stringify({
        extends: "./tsconfig.json",
        compilerOptions: { paths: { "@/*": ["./*"], ...paths } },
      }),
    );
    try {
      execFileSync(
        process.execPath,
        [join(repo, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.check.json"],
        { cwd: host, stdio: "pipe" },
      );
    } catch (error) {
      const output = error as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(`${output.stdout ?? ""}${output.stderr ?? ""}`);
    }
  });
});

const access: AccessContext = {
  namespace: "test",
  readablePrincipals: ["u1"],
  readableGroups: [],
  readablePools: [],
  canReadBillingDetail: true,
  canManageBudgets: false,
};
const scope = { namespace: "test", principal: "u1", connection: "c1" };
const month = { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" };
const budgets: Budget[] = [
  {
    id: "cap",
    version: 1,
    scope: { kind: "principal", namespace: "test", principal: "u1" },
    surface: "any",
    unit: "requests",
    limit: { value: 10n, scale: 0, unit: "requests" },
    window: { kind: "calendar_month", timezone: "UTC" },
    onExceed: "allow",
    hardLimit: { value: 15n, scale: 0, unit: "requests" },
    alerts: [{ at: { percent: 50 } }],
  },
  {
    id: "pool",
    version: 1,
    scope: { kind: "platform_pool", namespace: "test", poolId: "p1" },
    surface: "any",
    unit: "requests",
    limit: { value: 100n, scale: 0, unit: "requests" },
    window: { kind: "calendar_month", timezone: "UTC" },
    onExceed: "block",
  },
];

async function memoryMeter() {
  const clock = createManualClock(),
    store = createMemoryStore({ clock, budgets: [...budgets] }),
    meter = createMeter({ store, clock });
  const reserve = async (overrides: Partial<ReserveInput> = {}) => {
    const r = await store.reserve({
      operationId: crypto.randomUUID(),
      scope,
      fundingSource: "byok",
      costOwner: "u1",
      surface: "app",
      source: "app",
      provider: "search",
      operation: "search",
      platformPools: ["p1"],
      estimate: [{ value: 1n, scale: 0, unit: "requests" }],
      ...overrides,
    });
    if (r.outcome !== "reserved") throw new Error("fixture");
    return r.operation;
  };
  for (const provider of ["alpha", "beta"]) {
    const op = await reserve({ provider });
    const ref = { namespace: "test", principal: "u1", operationId: op.operationId };
    const g = await store.markDispatchIntent({
      ...ref,
      commandId: crypto.randomUUID(),
      expectedVersion: op.version,
      holder: "h",
      leaseTtlMs: 60000,
    });
    if (!("granted" in g) || !g.granted) throw new Error("fixture");
    await store.settle({
      ...ref,
      commandId: crypto.randomUUID(),
      expectedVersion: g.operation.version,
      authority: { kind: "lease", leaseId: g.lease.leaseId },
      receipt: {
        id: crypto.randomUUID(),
        measurements: [
          {
            unit: "requests",
            quantity: { value: 3n, scale: 0, unit: "requests" },
            certainty: "measured",
          },
          {
            unit: "customer_cents",
            quantity: { value: 180001n, scale: 4, unit: "customer_cents" },
            certainty: "measured",
          },
        ],
        cost: { certainty: "measured", money: { units: 12345n, currency: "USD" } },
        occurredAt: "2026-09-23T12:00:00.000Z",
        recordedAt: "2026-09-23T12:00:00.000Z",
        cached: false,
        failed: false,
      },
    });
  }
  await reserve({ reservationTtlMs: 1000 });
  clock.advance(5000);
  await meter.countRequest({
    commandId: "unpriced-request",
    scope,
    provider: "search",
    operation: "unknown",
    surface: "app",
    source: "app",
    state: "unpriced",
  });
  return meter;
}

type Module = Record<string, ComponentType<Record<string, unknown>>>;
const load = async (variant: Variant, name: string): Promise<Module> =>
  (await import(
    /* @vite-ignore */ pathToFileURL(join(hosts[variant], "components/usagekit", `${name}.tsx`))
      .href
  )) as Module;

describe.each(variants)("%s native usage presentation", (variant) => {
  test("unknown progress cannot display a fabricated zero", async () => {
    const { UsageOverviewCard } = await load(variant, "usage-overview-card");
    render(
      createElement(UsageOverviewCard!, {
        title: "Provider usage",
        budget: { label: "Budget used", value: "0%", percent: 0, partial: true },
        metrics: [{ id: "paid", label: "Paid to providers", value: "Unknown" }],
        labels: { unknown: "Unconfirmed usage" },
      }),
    );
    expect(screen.getByRole("region", { name: "Budget used" }).textContent).toContain(
      "Unconfirmed usage",
    );
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
  });
  test("partial and exceeded progress preserve actual copy and valid meter geometry", async () => {
    const { UsageOverviewCard } = await load(variant, "usage-overview-card");
    render(
      createElement(UsageOverviewCard!, {
        title: "Provider usage",
        budget: {
          label: "Budget used",
          value: "At least 180%",
          meterLabel: "Partial budget usage",
          percent: 180,
          partial: true,
        },
        metrics: [{ id: "paid", label: "Paid", value: "At least $125.55" }],
        children: createElement("li", null, "Provider A"),
        notice: {
          message: "Provider A reached its limit",
          action: createElement("a", { href: "/settings" }, "Settings"),
        },
      }),
    );
    const meter = screen.getByRole("meter", { name: "Partial budget usage" });
    expect(meter.getAttribute("aria-valuenow")).toBe("100");
    expect(meter.getAttribute("aria-valuetext")).toBe("At least 180%");
    expect(meter.getAttribute("data-level")).toBe("exceeded");
    expect(meter.style.getPropertyValue("--usage-fill")).toBe("100%");
    expect(meter.getAttribute("data-kind")).toBe("partial");
    expect(meter.querySelector("[data-usage-over]")).toBeTruthy();
    expect(screen.getByRole("listitem").textContent).toBe("Provider A");
    expect(screen.getByRole("alert").textContent).toContain("Provider A reached its limit");
    expect(screen.getByText("At least $125.55")).toBeTruthy();
  });
  test("loading keeps the layout without placeholder figures", async () => {
    const { UsageOverviewCard } = await load(variant, "usage-overview-card");
    render(
      createElement(UsageOverviewCard!, {
        title: "Provider usage",
        loading: true,
        budget: { label: "Budget used", value: "0%", percent: 0, partial: false },
        metrics: [{ id: "paid", label: "Paid", value: "$0.00" }],
      }),
    );
    expect(screen.getByRole("status").textContent).toBe("Loading usage.");
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.queryByText("$0.00")).toBeNull();
  });
  test("a known figure, its status words and the warning mark render together", async () => {
    const { UsageOverviewCard } = await load(variant, "usage-overview-card");
    const { container } = render(
      createElement(UsageOverviewCard!, {
        title: "Provider usage",
        budget: {
          label: "Budget used",
          value: "86% of the tightest budget used",
          figure: "86%",
          caption: "Tightest: Search",
          percent: 86,
          partial: false,
          warningAt: 80,
        },
        metrics: [],
        labels: { warning: "Close to the limit" },
      }),
    );
    expect(screen.getByText("86%")).toBeTruthy();
    expect(screen.getByText("Close to the limit")).toBeTruthy();
    const meter = screen.getByRole("meter", { name: "Budget used" });
    expect(meter.getAttribute("aria-valuetext")).toBe("86% of the tightest budget used");
    expect(meter.getAttribute("data-level")).toBe("warning");
    expect(container.querySelector('[style*="left: 80%"]')).toBeTruthy();
  });
  test("a partial reading below the warning point does not claim to be within budget", async () => {
    const { UsageOverviewCard } = await load(variant, "usage-overview-card");
    render(
      createElement(UsageOverviewCard!, {
        title: "Provider usage",
        budget: {
          label: "Budget used",
          value: "At least 62%",
          qualifier: "At least",
          figure: "62%",
          percent: 62.75,
          partial: true,
        },
        metrics: [],
      }),
    );
    expect(screen.queryByText("Within budget")).toBeNull();
    expect(screen.getByText("Still measuring")).toBeTruthy();
    expect(screen.getByText("At least")).toBeTruthy();
    expect(screen.getByRole("meter").getAttribute("data-kind")).toBe("partial");
  });
  test("connection rows unfold their readings from a keyboard-operable disclosure", async () => {
    const { UsageOverviewCard } = await load(variant, "usage-overview-card");
    const { UsageConnectionRow } = await load(variant, "usage-connection-row");
    render(
      createElement(
        UsageOverviewCard!,
        {
          title: "Provider usage",
          budget: { label: "Budget used", value: "No budget", percent: null, partial: false },
          metrics: [],
        },
        createElement(UsageConnectionRow!, {
          name: "Search",
          tags: ["Primary"],
          status: { label: "Connected", tone: "positive" },
          summary: { value: "28%", percent: 28 },
          groups: [
            {
              id: "own",
              readings: [
                { id: "app", label: "App", value: "28 of 100 used", percent: 28 },
                { id: "api", label: "API", value: "No cap", percent: null },
                { id: "late", label: "Late", value: "Usage unknown", percent: 0, partial: true },
              ],
            },
          ],
          breakdown: [{ id: "rank", label: "Rank checks", value: "28", tags: ["Scheduled 4"] }],
        }),
      ),
    );
    const toggle = screen.getByRole("button", { name: "Search Primary Connected 28%" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const details = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(details.hasAttribute("inert")).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(details.hasAttribute("inert")).toBe(false);
    const meter = within(details).getByRole("meter", { name: "Search App" });
    expect(meter.getAttribute("aria-valuetext")).toBe("28 of 100 used");
    // Uncapped and unknown readings never draw a fill that could read as zero.
    expect(within(details).getAllByRole("meter")).toHaveLength(1);
    expect(details.querySelector('[data-usage-track="none"]')).toBeTruthy();
    expect(details.querySelector('[data-usage-track="unknown"]')).toBeTruthy();
    expect(within(details).getByText("Scheduled 4")).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(details.hasAttribute("inert")).toBe(true);
  });
  test("an unknown connection summary never shows the host figure", async () => {
    const { UsageConnectionRow } = await load(variant, "usage-connection-row");
    render(
      createElement(
        "ul",
        null,
        createElement(UsageConnectionRow!, {
          name: "Search",
          summary: { value: "0%", percent: 0, partial: true },
          labels: { unknown: "Not yet measured" },
        }),
      ),
    );
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.getByRole("button", { name: "Search Not yet measured" })).toBeTruthy();
  });
  test("cap pill keeps hidden, unavailable and partial states distinct", async () => {
    const { UsageCapPill } = await load(variant, "usage-cap-pill");
    const node = (props: Record<string, unknown>) => createElement(UsageCapPill!, props);
    const view = render(node({ state: "hidden" }));
    expect(view.container.innerHTML).toBe("");
    view.rerender(
      node({ state: "unavailable", href: "/usage", labels: { unavailable: "Spend unavailable" } }),
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Spend unavailable");
    view.rerender(
      node({
        state: "ready",
        href: "/usage",
        percent: 0,
        partial: true,
        label: "0% used",
        ariaLabel: "Monthly cap 0% used",
      }),
    );
    expect(screen.getByRole("link", { name: "Usage unknown" }).textContent).toContain(
      "Usage unknown",
    );
    expect(screen.queryByText("0% used")).toBeNull();
    view.rerender(
      node({
        state: "ready",
        href: "/usage",
        percent: 62.75,
        partial: true,
        label: "At least 62% used",
      }),
    );
    expect(screen.getByRole("link", { name: "At least 62% used" }).getAttribute("href")).toBe(
      "/usage",
    );
  });
});

describe.each(variants)("%s blocks render against a memory Meter", (variant) => {
  const withMeter = async (node: ReactNode) => {
    const meter = await memoryMeter();
    return render(createElement(MeterProvider, { meter, access }, node));
  };
  test("usage table pages through the view", async () => {
    const { UsageTablePanel } = await load(variant, "usage-table");
    await withMeter(
      createElement(UsageTablePanel!, {
        scope: { kind: "principal", namespace: "test", principal: "u1" },
        ...month,
        units: ["requests", "tokens"],
        groupBy: ["provider"],
        limit: 1,
      }),
    );
    await screen.findByText("alpha");
    const table = screen.getByRole("table", { name: "Usage detail" });
    expect(table.tabIndex).toBe(0);
    table.focus();
    expect(document.activeElement).toBe(table);
    expect(screen.getByText("3 requests")).toBeTruthy();
    expect(screen.getByText("1.2345 cents")).toBeTruthy();
    expect(screen.getByText("Unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("beta");
    expect(screen.getByRole("button", { name: "First page" })).toBeTruthy();
  });
  test.each(["Meter", "access"])(
    "usage cursor resets when the %s binding changes",
    async (change) => {
      const { UsageTablePanel } = await load(variant, "usage-table");
      const first = await memoryMeter();
      const second = change === "Meter" ? await memoryMeter() : first;
      const usage = vi.fn(second.usage.bind(second));
      second.usage = usage;
      const panel = createElement(UsageTablePanel!, {
        scope: { kind: "principal", namespace: "test", principal: "u1" },
        ...month,
        units: ["requests"],
        groupBy: ["provider"],
        limit: 1,
      });
      const rendered = render(createElement(MeterProvider, { meter: first, access }, panel));
      await screen.findByText("alpha");
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      await screen.findByText("beta");
      usage.mockClear();
      rendered.rerender(
        createElement(
          MeterProvider,
          {
            meter: second,
            access: change === "access" ? { ...access, readableGroups: ["g1"] } : access,
          },
          panel,
        ),
      );
      await waitFor(() => expect(usage).toHaveBeenCalled());
      expect(usage.mock.calls[0]![1].cursor).toBeUndefined();
      await screen.findByText("alpha");
    },
  );
  test("an invalid usage cursor keeps a first-page recovery action", async () => {
    const { UsageTablePanel } = await load(variant, "usage-table");
    const meter = await memoryMeter();
    const read = meter.usage.bind(meter);
    meter.usage = async (access, query) =>
      query.cursor
        ? { outcome: "invalid", field: "cursor", reason: "Expired cursor" }
        : read(access, query);
    render(
      createElement(
        MeterProvider,
        { meter, access },
        createElement(UsageTablePanel!, {
          scope: { kind: "principal", namespace: "test", principal: "u1" },
          ...month,
          units: ["requests"],
          groupBy: ["provider"],
          limit: 1,
        }),
      ),
    );
    await screen.findByText("alpha");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "First page" }));
    await screen.findByText("alpha");
  });
  test("paging keeps the current page visible and busy until the next page arrives", async () => {
    const { UsageTablePanel } = await load(variant, "usage-table");
    const meter = await memoryMeter();
    const read = meter.usage.bind(meter);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    meter.usage = async (access, query) => {
      if (query.cursor) await gate;
      return read(access, query);
    };
    render(
      createElement(
        MeterProvider,
        { meter, access },
        createElement(UsageTablePanel!, {
          scope: { kind: "principal", namespace: "test", principal: "u1" },
          ...month,
          units: ["requests"],
          groupBy: ["provider"],
          limit: 1,
        }),
      ),
    );
    await screen.findByText("alpha");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(screen.getByRole("table", { name: "Usage detail" }).getAttribute("aria-busy")).toBe(
        "true",
      ),
    );
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.queryByText("Loading usage.")).toBeNull();
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await act(async () => release());
    await screen.findByText("beta");
    expect(screen.queryByText("alpha")).toBeNull();
    expect(
      screen.getByRole("table", { name: "Usage detail" }).getAttribute("aria-busy"),
    ).toBeNull();
  });
  test("a failed read drops the retained page, so a reload never shows superseded data", async () => {
    const { UsageTablePanel } = await load(variant, "usage-table");
    const meter = await memoryMeter();
    const read = meter.usage.bind(meter);
    const queryClient = createMeterQueryClient();
    let attempts = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    meter.usage = async (access, query) => {
      if (!query.cursor) return read(access, query);
      attempts += 1;
      // A malformed page fails the loader itself; that failure is the one a refetch clears.
      if (attempts === 1) return { outcome: "ok", value: null } as never;
      await gate;
      return read(access, query);
    };
    render(
      createElement(
        MeterProvider,
        { meter, access, queryClient },
        createElement(UsageTablePanel!, {
          scope: { kind: "principal", namespace: "test", principal: "u1" },
          ...month,
          units: ["requests"],
          groupBy: ["provider"],
          limit: 1,
        }),
      ),
    );
    await screen.findByText("alpha");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByRole("alert");
    act(() => queryClient.invalidate());
    await screen.findByText("Loading usage.");
    expect(screen.queryByText("alpha")).toBeNull();
    await act(async () => release());
    await screen.findByText("beta");
  });
  test("budget cards show figures, markers and the redacted pool", async () => {
    const { BudgetCardsPanel } = await load(variant, "budget-card");
    const { container } = await withMeter(
      createElement(BudgetCardsPanel!, {
        scope,
        surface: "app",
        units: ["requests"],
        platformPools: ["p1"],
      }),
    );
    await screen.findByText("principal u1");
    expect(screen.getByText("6 requests")).toBeTruthy();
    expect(screen.getByText("Warning")).toBeTruthy();
    expect(screen.getByText(/figures are hidden/)).toBeTruthy();
    expect(screen.getByRole("img", { name: "Hard limit 15 requests" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Alert 50%" })).toBeTruthy();
    const track = container.querySelector<HTMLElement>("[data-usage-track]")!;
    expect(track.style.getPropertyValue("--usage-fill")).toBe("40%");
    expect(track.style.getPropertyValue("--usage-reserved")).toBe("6.66%");
  });
  test("header status shows one pill per visible bound", async () => {
    const { HeaderStatusPanel } = await load(variant, "header-status");
    await withMeter(
      createElement(HeaderStatusPanel!, {
        scope,
        surface: "app",
        units: ["requests"],
        platformPools: ["p1"],
      }),
    );
    // Six settled plus one expired reservation that no sweep has released yet: reads never mutate.
    const pill = await screen.findByText("3 of 10 requests left");
    expect(pill.closest("[data-level]")?.getAttribute("data-level")).toBe("warning");
    expect(screen.getByText("1 hidden bounds")).toBeTruthy();
  });
  test("coverage summary states what cost excludes", async () => {
    const { CoverageSummaryPanel } = await load(variant, "coverage-summary");
    await withMeter(
      createElement(CoverageSummaryPanel!, {
        scope: { kind: "principal", namespace: "test", principal: "u1" },
        ...month,
      }),
    );
    await screen.findByText("6");
    expect(screen.queryByText("Unavailable")).toBeNull();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText(/Cost excludes untracked requests/)).toBeTruthy();
  });
  test("exceptions list shows state and age", async () => {
    const { ExceptionsListPanel } = await load(variant, "exceptions-list");
    await withMeter(
      createElement(ExceptionsListPanel!, {
        scope: { kind: "principal", namespace: "test", principal: "u1" },
        ...month,
      }),
    );
    await screen.findByText("Reservation expired");
    const table = screen.getByRole("table", { name: "Needs attention" });
    expect(table.tabIndex).toBe(0);
    table.focus();
    expect(document.activeElement).toBe(table);
    expect(screen.getByText("4 s")).toBeTruthy();
    expect(screen.getByText("reserved")).toBeTruthy();
  });
  test("usage filters render the host select with the chosen values", async () => {
    const { UsageFilters } = await load(variant, "usage-filters");
    render(
      createElement(UsageFilters!, {
        period: "this",
        periods: [
          { value: "this", label: "This month" },
          { value: "last", label: "Last month" },
        ],
        onPeriodChange: () => {},
        scope: "me",
        scopes: [{ value: "me", label: "My usage" }],
        onScopeChange: () => {},
      }),
    );
    expect(screen.getByRole("combobox", { name: "Period" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Scope" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("This month")).toBeTruthy());
    expect(screen.getByText("My usage")).toBeTruthy();
  });
  test("connection list shows funding, tags and plan", async () => {
    const { ConnectionList } = await load(variant, "connection-list");
    render(
      createElement(ConnectionList!, {
        connections: [
          { id: "c1", provider: "search", label: "Search", fundingSource: "byok", tags: ["prod"] },
          { id: "c2", provider: "maps", fundingSource: "platform", plan: "developer" },
        ],
      }),
    );
    const table = screen.getByRole("table", { name: "Connections" });
    expect(table.tabIndex).toBe(0);
    table.focus();
    expect(document.activeElement).toBe(table);
    expect(screen.getByText("Own key")).toBeTruthy();
    expect(screen.getByText("Platform")).toBeTruthy();
    expect(screen.getByText("prod")).toBeTruthy();
    expect(screen.getByText("developer")).toBeTruthy();
    expect(screen.getByText("c2")).toBeTruthy();
  });
  test("measurement card keeps unknown and unavailable separate from exact zero", async () => {
    const { MeasurementCard } = await load(variant, "measurement-card");
    const { rerender } = render(
      createElement(MeasurementCard!, {
        title: "Requests",
        value: { text: "0", unit: "requests", certainty: "measured" },
      }),
    );
    expect(screen.getByText("0")).toBeTruthy();
    rerender(
      createElement(MeasurementCard!, {
        title: "Requests",
        value: { text: "", unit: "requests", certainty: "unknown" },
      }),
    );
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
    rerender(createElement(MeasurementCard!, { title: "Requests", value: "unavailable" }));
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
  });
  test("customer charge units have readable labels while arbitrary units stay exact", async () => {
    const { MeasurementCard } = await load(variant, "measurement-card");
    const rendered = render(
      createElement(MeasurementCard!, {
        title: "Customer charges",
        value: { text: "18.0000", unit: "customer_cents", certainty: "measured" },
      }),
    );
    expect(screen.getByText("18.0000")).toBeTruthy();
    expect(screen.getByText("cents")).toBeTruthy();
    expect(screen.queryByText("customer_cents")).toBeNull();
    rendered.unmount();
    const { UsageTablePanel } = await load(variant, "usage-table");
    await withMeter(
      createElement(UsageTablePanel!, {
        scope: budgets[0]!.scope,
        ...month,
        units: ["customer_cents", "requests"],
        groupBy: ["provider"],
        limit: 1,
      }),
    );
    await screen.findByRole("columnheader", { name: "Customer charges" });
    expect(screen.getByRole("columnheader", { name: "requests" })).toBeTruthy();
    expect(screen.getByText("18.0001 cents")).toBeTruthy();
    expect(screen.queryByText("customer_cents")).toBeNull();
  });
  test("usage and cost cards share exact summary data", async () => {
    const { UsageSummaryCardsPanel } = await load(variant, "usage-summary-cards");
    const { CostSummaryCardPanel } = await load(variant, "cost-summary-card");
    await withMeter(
      createElement(
        "div",
        null,
        createElement(UsageSummaryCardsPanel!, {
          scope: budgets[0]!.scope,
          ...month,
          units: ["requests"],
          unitLabels: { requests: "Requests" },
        }),
        createElement(CostSummaryCardPanel!, {
          scope: budgets[0]!.scope,
          ...month,
          units: ["requests"],
        }),
      ),
    );
    await screen.findByText("Requests");
    await screen.findByText("2.4690");
    expect(screen.getByText("6")).toBeTruthy();
  });
  test.each([
    "budget-card",
    "header-status",
    "usage-table",
    "coverage-summary",
    "exceptions-list",
    "usage-summary-cards",
    "cost-summary-card",
  ])("%s panel reports a missing Meter instead of loading forever", async (name) => {
    const module = await load(variant, name as (typeof blockNames)[number]);
    const panel = Object.entries(module).find(([key]) => key.endsWith("Panel"))![1];
    render(
      createElement(panel!, {
        scope,
        ...month,
        surface: "app",
        platformPools: [],
        units: ["requests"],
        groupBy: [],
      }),
    );
    await screen.findByRole("alert");
    expect(screen.queryByText(/Loading/)).toBeNull();
  });
  test("editor is read-only without a host writer", async () => {
    const { BudgetEditor } = await load(variant, "budget-editor");
    await withMeter(createElement(BudgetEditor!, { budget: budgets[0] }));
    expect(screen.getByRole("textbox", { name: "Limit (requests)" }).hasAttribute("readonly")).toBe(
      true,
    );
    expect(
      (screen.getByRole("button", { name: "Save budget" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/View only/)).toBeTruthy();
  });
  const editable = async (node: ReactNode, writer: BudgetWriter) =>
    render(
      createElement(
        MeterProvider,
        {
          meter: await memoryMeter(),
          access: { ...access, canManageBudgets: true },
          budgetWriter: writer,
        },
        node,
      ),
    );
  test("editor sends exact decimal strings through host save and preserves immutable scope", async () => {
    const { BudgetEditor } = await load(variant, "budget-editor");
    const save = vi.fn<BudgetWriter["save"]>(async (budget) => ({ outcome: "saved", budget }));
    await editable(
      createElement(BudgetEditor!, { budget: { ...budgets[0], hardLimit: undefined } }),
      { save },
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Limit (requests)" }), {
      target: { value: "9007199254740993.000001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
    await screen.findByText("Budget saved.");
    expect(save).toHaveBeenCalledTimes(1);
    const sent = save.mock.calls[0]![0];
    expect(sent.limit).toEqual({ value: 9007199254740993000001n, scale: 6, unit: "requests" });
    expect(sent.scope).toEqual(budgets[0]!.scope);
    expect(sent.version).toBe(2);
  });
  test.each(["Block requests", "No limit"])(
    "editor can save allow+hardLimit after choosing %s",
    async (action) => {
      const { BudgetEditor } = await load(variant, "budget-editor");
      const save = vi.fn<BudgetWriter["save"]>(async (budget) => ({ outcome: "saved", budget }));
      // No percent alerts in this fixture: unlimited requires explicit alert removal/conversion.
      await editable(createElement(BudgetEditor!, { budget: { ...budgets[0], alerts: [] } }), {
        save,
      });
      fireEvent.click(screen.getByRole("button", { name: action }));
      fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
      await screen.findByText("Budget saved.");
      expect(save.mock.calls[0]![0].hardLimit).toBeUndefined();
      expect(save.mock.calls[0]![0].limit === null).toBe(action === "No limit");
    },
  );
  test("invalid exact input is visible and never invokes host writer", async () => {
    const { BudgetEditor } = await load(variant, "budget-editor");
    const save = vi.fn<BudgetWriter["save"]>();
    await editable(createElement(BudgetEditor!, { budget: budgets[0] }), { save });
    fireEvent.change(screen.getByRole("textbox", { name: "Limit (requests)" }), {
      target: { value: "1e9" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
    await screen.findByRole("alert");
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("decimal");
  });
  test("a new invalid draft replaces prior saved feedback without another write", async () => {
    const { BudgetEditor } = await load(variant, "budget-editor");
    const save = vi.fn<BudgetWriter["save"]>(async (budget) => ({ outcome: "saved", budget }));
    await editable(createElement(BudgetEditor!, { budget: budgets[0] }), { save });
    fireEvent.change(screen.getByRole("textbox", { name: "Limit (requests)" }), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
    await screen.findByText("Budget saved.");
    fireEvent.change(screen.getByRole("textbox", { name: "Limit (requests)" }), {
      target: { value: "1e9" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
    expect((await screen.findByRole("alert")).textContent).toContain("decimal");
    expect(screen.queryByText("Budget saved.")).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
  });
  test("unlimited mode keeps percent alerts removable with precise validation feedback", async () => {
    const { BudgetEditor } = await load(variant, "budget-editor");
    const save = vi.fn<BudgetWriter["save"]>(async (budget) => ({ outcome: "saved", budget }));
    await editable(createElement(BudgetEditor!, { budget: budgets[0] }), { save });
    fireEvent.click(screen.getByRole("button", { name: "No limit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Alerts:.*finite/);
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove alert 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
    await screen.findByText("Budget saved.");
    expect(save.mock.calls[0]![0].limit).toBeNull();
    expect(save.mock.calls[0]![0].alerts).toEqual([]);
  });
  test("unknown save blocks duplicate submits until authoritative reconciliation", async () => {
    const { BudgetEditor } = await load(variant, "budget-editor");
    const save = vi.fn<BudgetWriter["save"]>(async () => ({
      outcome: "unavailable",
      message: "Timeout",
      ambiguous: true,
    }));
    const reconcile = vi.fn<NonNullable<BudgetWriter["reconcile"]>>(async () => ({
      outcome: "not_saved",
    }));
    await editable(createElement(BudgetEditor!, { budget: budgets[0] }), { save, reconcile });
    fireEvent.change(screen.getByRole("textbox", { name: "Limit (requests)" }), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
    await screen.findByText(/save result is unknown/);
    expect(
      (screen.getByRole("button", { name: "Save budget" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Reset changes" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Check save status" }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Save budget" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  test("manager reloads a conflict and saves the newly read version within the same Provider", async () => {
    const { BudgetManagerPanel } = await load(variant, "budget-manager-panel");
    const meter = await memoryMeter();
    const server = [structuredClone(budgets[0]!)];
    meter.definedBudgets = async () => ({ outcome: "ok", value: structuredClone(server) });
    let conflict = true;
    const save = vi.fn<BudgetWriter["save"]>(async (budget) => {
      if (conflict) {
        conflict = false;
        server[0] = {
          ...server[0]!,
          version: 2,
          limit: { value: 11n, scale: 0, unit: "requests" },
        };
        return { outcome: "conflict", reason: "Concurrent edit" };
      }
      expect(budget.version).toBe(3);
      server[0] = budget;
      return { outcome: "saved", budget };
    });
    render(
      createElement(
        MeterProvider,
        { meter, access: { ...access, canManageBudgets: true }, budgetWriter: { save } },
        createElement(BudgetManagerPanel!, {
          scope: budgets[0]!.scope,
          budgetTitles: { cap: "Monthly requests" },
        }),
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit Monthly requests" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Limit (requests)" }), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
    await screen.findByText(/changed elsewhere/);
    // Automatic definition invalidation must not silently rebase/discard the conflicted draft.
    await screen.findByText("11 requests");
    expect(
      (screen.getByRole("textbox", { name: "Limit (requests)" }) as HTMLInputElement).value,
    ).toBe("12");
    expect(screen.getByText(/changed elsewhere/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Save budget" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reload latest budgets" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit Monthly requests" }));
    await waitFor(() =>
      expect(
        (screen.getByRole("textbox", { name: "Limit (requests)" }) as HTMLInputElement).value,
      ).toBe("11"),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Limit (requests)" }), {
      target: { value: "13" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
    await screen.findAllByText("Budget saved.");
    expect(save).toHaveBeenCalledTimes(2);
  });
  test("manager creates only from host templates with exact quantities and fixed windows", async () => {
    const { BudgetManagerPanel } = await load(variant, "budget-manager-panel");
    const meter = await memoryMeter();
    let server: Budget[] = [];
    meter.definedBudgets = async () => ({ outcome: "ok", value: structuredClone(server) });
    const save = vi.fn<BudgetWriter["save"]>(async (budget) => {
      server = [budget];
      return { outcome: "saved", budget };
    });
    render(
      createElement(
        MeterProvider,
        { meter, access: { ...access, canManageBudgets: true }, budgetWriter: { save } },
        createElement(BudgetManagerPanel!, {
          scope: budgets[0]!.scope,
          templates: [
            {
              title: "Monthly cost",
              budget: {
                id: "cost-cap",
                version: 0,
                scope: budgets[0]!.scope,
                surface: "app",
                unit: "cents",
                window: { kind: "calendar_month", timezone: "UTC" },
              },
            },
          ],
        }),
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Create Monthly cost" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Limit (cents)" }), {
      target: { value: "1.2500" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
    await screen.findAllByText("Budget saved.");
    const sent = save.mock.calls[0]![0];
    expect(sent).toMatchObject({
      id: "cost-cap",
      version: 1,
      scope: budgets[0]!.scope,
      surface: "app",
      window: { kind: "calendar_month", timezone: "UTC" },
      limit: { value: 12500n, scale: 4, unit: "cents" },
    });
  });
});

describe.each(variants)("%s provider blocks use explicit host ports", (variant) => {
  const fixture = () => createDemoProviderPort(`acme:test:${crypto.randomUUID()}`);
  const mounted = (node: ReactNode, demo = fixture(), canManage = true) => {
    const wrap = (child: ReactNode) =>
      createElement(
        ProviderManagementProvider,
        { port: demo.port, binding: { ...demo.binding, canManage } },
        child,
      );
    return { ...render(wrap(node)), demo, wrap };
  };
  const editorFixture = () => {
    const demo = fixture();
    const client = createProviderQueryClient();
    const read = demo.port.read.bind(demo.port);
    let failure: "forbidden" | "unavailable" | null = null;
    let revision = "1";
    let removed = false;
    let extraProvider = false;
    demo.port.read = vi.fn(async (binding, query): Promise<ProviderReadResult> => {
      if (failure === "forbidden") return { outcome: "forbidden" };
      if (failure === "unavailable")
        return { outcome: "unavailable", message: "Stored evidence is unavailable." };
      const answer = await read(binding, query);
      if (answer.outcome === "ok" && answer.value.kind === "connections" && extraProvider)
        return {
          ...answer,
          value: {
            ...answer.value,
            providers: [
              ...answer.value.providers,
              { ...demoProviders[0]!, id: "new-provider", label: "New provider" },
            ],
            connections: [
              ...answer.value.connections,
              {
                ...structuredClone(initialConnections[0]!),
                id: "new-connection",
                provider: "new-provider",
                label: "New provider account",
              },
            ],
          },
        };
      if (answer.outcome === "ok" && removed) {
        if (answer.value.kind === "connections")
          return { outcome: "ok", value: { ...answer.value, state: "empty", connections: [] } };
        if (answer.value.kind === "details")
          return { outcome: "ok", value: { ...answer.value, state: "empty", connection: null } };
        if (answer.value.kind === "allocations")
          return { outcome: "ok", value: { ...answer.value, state: "empty", rows: [] } };
      }
      if (answer.outcome !== "ok" || revision === "1") return answer;
      const connection = (item: (typeof initialConnections)[number]) =>
        item.id === "search-own"
          ? {
              ...item,
              revision,
              rates: item.rates.map((rate) => ({
                ...rate,
                price: { text: "9.7500", unit: "cents", certainty: "measured" as const },
                provenance: { ...rate.provenance, version: "rate-2" },
              })),
            }
          : item;
      const value = answer.value;
      if (value.kind === "connections")
        return {
          outcome: "ok",
          value: { ...value, revision, connections: value.connections.map(connection) },
        };
      if (value.kind === "details")
        return {
          outcome: "ok",
          value: {
            ...value,
            revision,
            connection: value.connection ? connection(value.connection) : null,
          },
        };
      if (value.kind === "allocations")
        return {
          outcome: "ok",
          value: {
            ...value,
            revision,
            rows: value.rows.map((row) => ({
              ...row,
              revision,
              ...(row.id === "byok-app"
                ? {
                    limit: { text: "700", unit: "requests", certainty: "measured" as const },
                    used: { text: "25", unit: "requests", certainty: "measured" as const },
                  }
                : {}),
            })),
          },
        };
      return answer;
    });
    const wrap = (node: ReactNode) =>
      createElement(
        ProviderManagementProvider,
        { port: demo.port, binding: demo.binding, client },
        node,
      );
    return {
      demo,
      client,
      wrap,
      fail(value: typeof failure) {
        failure = value;
      },
      newer() {
        revision = "2";
      },
      remove() {
        removed = true;
      },
      revealProvider() {
        extraProvider = true;
      },
      async refresh() {
        await act(async () => client.invalidate(demo.port, demo.binding));
      },
    };
  };
  test("stored reads never test or mutate providers, and writes are read-only by default", async () => {
    const { ProviderManagerPanel } = await load(variant, "provider-manager-panel");
    const demo = fixture();
    render(
      createElement(
        ProviderManagementProvider,
        {
          port: demo.port,
          binding: {
            scopeKey: demo.binding.scopeKey,
            principalKey: demo.binding.principalKey,
            authRevision: demo.binding.authRevision,
          },
        },
        createElement(ProviderManagerPanel!),
      ),
    );
    await screen.findByText("Search production");
    expect(demo.calls).toEqual([]);
    expect(
      (screen.getAllByRole("button", { name: "Test stored credentials" })[0] as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  test("draft credential test is separate from connect and passes secrets only ephemerally", async () => {
    const { ProviderConnectForm } = await load(variant, "provider-connect-form");
    const demo = fixture();
    const execute = demo.port.execute;
    const received: { command: ProviderCommand; secrets: Record<string, string> | undefined }[] =
      [];
    demo.port.execute = vi.fn(async (binding, command, secrets) => {
      received.push({
        command: structuredClone(command),
        secrets: secrets ? { ...secrets } : undefined,
      });
      return execute(binding, command, secrets);
    });
    mounted(createElement(ProviderConnectForm!, { provider: demoProviders[0] }), demo);
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "ephemeral-test-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Test credentials" }));
    await screen.findByText("Provider command completed");
    expect(received[0]!.command.kind).toBe("test");
    expect(received[0]!.secrets).toEqual({ key: "ephemeral-test-key" });
    expect(JSON.stringify(received[0]!.command)).not.toContain("ephemeral-test-key");
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("ephemeral-test-key");
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(demo.calls).toHaveLength(2));
    expect(demo.calls[1]!.kind).toBe("connect");
    await waitFor(() =>
      expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe(""),
    );
  });
  test("platform connection does not require own-key credential fields", async () => {
    const { ProviderConnectForm } = await load(variant, "provider-connect-form");
    const demo = fixture();
    mounted(
      createElement(ProviderConnectForm!, {
        provider: demoProviders[0],
        fundingSource: "platform",
      }),
      demo,
    );
    expect(screen.queryByLabelText("API key")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(demo.calls).toHaveLength(1));
    expect(demo.calls[0]).toMatchObject({ kind: "connect", fundingSource: "platform" });
  });
  test.each(["binding", "port", "target"])(
    "credentials clear immediately when %s changes",
    async (change) => {
      const { ProviderConnectForm } = await load(variant, "provider-connect-form");
      const demo = fixture();
      const next = fixture();
      const node = createElement(ProviderConnectForm!, { provider: demoProviders[0] });
      const rendered = mounted(node, demo);
      fireEvent.change(screen.getByLabelText("API key"), {
        target: { value: "must-not-cross-authority" },
      });
      rendered.rerender(
        createElement(
          ProviderManagementProvider,
          {
            port: change === "port" ? next.port : demo.port,
            binding:
              change === "binding" ? { ...demo.binding, principalKey: "another" } : demo.binding,
          },
          change === "target"
            ? createElement(ProviderConnectForm!, { provider: demoProviders[1] })
            : node,
        ),
      );
      expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
      expect(demo.calls).toEqual([]);
    },
  );
  test("disconnect requires confirmation; no action occurs on mount", async () => {
    const { ProviderConnectForm } = await load(variant, "provider-connect-form");
    const demo = fixture();
    mounted(
      createElement(ProviderConnectForm!, {
        provider: demoProviders[0],
        connection: initialConnections[0],
      }),
      demo,
    );
    expect(demo.calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(demo.calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));
    await waitFor(() => expect(demo.calls).toHaveLength(1));
    expect(demo.calls[0]).toMatchObject({ kind: "disconnect", expectedRevision: "1" });
  });
  test("unknown credential result clears local secrets and gates all new writes until reconciliation", async () => {
    const { ProviderConnectForm } = await load(variant, "provider-connect-form");
    const demo = fixture();
    demo.setNextOutcome("unknown");
    const reconcile = vi.fn(demo.port.reconcile!);
    demo.port.reconcile = reconcile;
    mounted(createElement(ProviderConnectForm!, { provider: demoProviders[0] }), demo);
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "transient" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText(/The result is unknown/);
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Check change status" }));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect(demo.calls).toHaveLength(1);
    expect(reconcile.mock.calls[0]).toHaveLength(2);
    expect(JSON.stringify(reconcile.mock.calls[0])).not.toContain("transient");
  });
  test("funding source changes only after explicit confirmation", async () => {
    const { ProviderSourceSelector } = await load(variant, "provider-source-selector");
    const demo = fixture();
    mounted(
      createElement(ProviderSourceSelector!, {
        connection: initialConnections[0],
        sources: ["byok", "platform"],
      }),
      demo,
    );
    fireEvent.click(screen.getByRole("button", { name: "Platform funded" }));
    expect(demo.calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm funding change" }));
    await waitFor(() => expect(demo.calls).toHaveLength(1));
    expect(demo.calls[0]).toMatchObject({
      kind: "funding",
      expectedRevision: "1",
      fundingSource: "platform",
    });
  });
  test("rates preserve exact inputs, provenance and explicit host fallback", async () => {
    const { ProviderRateEditor } = await load(variant, "provider-rate-editor");
    const demo = fixture();
    const rendered = mounted(
      createElement(ProviderRateEditor!, { connection: initialConnections[0] }),
      demo,
    );
    expect(screen.getByText("153")).toBeTruthy();
    expect(screen.getByText("rate-1")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Price/), { target: { value: "10.001234" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rate" }));
    await waitFor(() => expect(demo.calls).toHaveLength(1));
    expect(demo.calls[0]).toMatchObject({
      kind: "rates",
      rates: [{ rateId: "standard", price: "1000.1234" }],
    });
    rendered.rerender(
      rendered.wrap(
        createElement(ProviderRateEditor!, { connection: demo.snapshots().connections[0] }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Use measured rate" }));
    await waitFor(() => expect(demo.calls).toHaveLength(2));
    expect(demo.calls[1]).toMatchObject({ rates: [{ rateId: "standard", price: null }] });
  });
  test("unknown rate save retains its exact submitted value after editor remount", async () => {
    const { ProviderRateEditor } = await load(variant, "provider-rate-editor");
    const demo = fixture();
    demo.setNextOutcome("unknown");
    const rendered = mounted(
      createElement(ProviderRateEditor!, { connection: initialConnections[0] }),
      demo,
    );
    fireEvent.change(screen.getByLabelText(/Price/), { target: { value: "12.5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rate" }));
    await screen.findByText(/The result is unknown/);
    rendered.rerender(
      rendered.wrap(
        createElement(ProviderRateEditor!, {
          key: "fresh-editor",
          connection: initialConnections[0],
        }),
      ),
    );
    expect((screen.getByLabelText(/Price/) as HTMLInputElement).value).toBe("12.5000");
    expect((screen.getByRole("button", { name: "Save rate" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(demo.calls).toHaveLength(1);
  });
  test("unknown rate uses the host price unit without guessing money", async () => {
    const { ProviderRateEditor } = await load(variant, "provider-rate-editor");
    const demo = fixture();
    const connection = structuredClone(initialConnections[0]!);
    connection.rates[0]!.price = "unavailable";
    connection.rates[0]!.priceUnit = "tokens";
    mounted(createElement(ProviderRateEditor!, { connection }), demo);
    fireEvent.change(screen.getByLabelText(/Price/), { target: { value: "9007199254740993.125" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rate" }));
    await waitFor(() => expect(demo.calls).toHaveLength(1));
    expect(demo.calls[0]).toMatchObject({
      rates: [{ price: "9007199254740993.125", rateId: "standard" }],
    });
  });
  test("rates read and edit as exact dollars, and only a manual rate offers its fallback", async () => {
    const { ProviderRateEditor } = await load(variant, "provider-rate-editor");
    const demo = fixture();
    const rendered = mounted(
      createElement(ProviderRateEditor!, { connection: initialConnections[0] }),
      demo,
    );
    const row = screen.getByRole("button", { name: /Standard request/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(row.textContent).toContain("$0.00625 per request");
    expect(row.textContent).toContain("Measured");
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect((screen.getByLabelText(/Price/) as HTMLInputElement).value).toBe("0.006250");
    expect(screen.getByText("(USD)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Use measured rate|Use list price/ })).toBeNull();
    fireEvent.change(screen.getByLabelText(/Price/), { target: { value: "0.0000001" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rate" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter an exact nonnegative price.");
    expect(demo.calls).toEqual([]);
    fireEvent.change(screen.getByLabelText(/Price/), { target: { value: "0.02" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rate" }));
    await waitFor(() => expect(demo.calls).toHaveLength(1));
    expect(demo.calls[0]).toMatchObject({ rates: [{ rateId: "standard", price: "2" }] });
    rendered.rerender(
      rendered.wrap(
        createElement(ProviderRateEditor!, { connection: demo.snapshots().connections[0] }),
      ),
    );
    const saved = screen.getByRole("button", { name: /Standard request/ });
    expect(saved.textContent).toContain("$0.02 per request");
    expect(saved.textContent).toContain("Your rate");
    fireEvent.click(saved);
    expect(screen.getByText("Without your rate").nextElementSibling?.textContent).toContain(
      "$0.00625",
    );
    fireEvent.click(screen.getByRole("button", { name: "Use measured rate" }));
    await waitFor(() => expect(demo.calls).toHaveLength(2));
    expect(demo.calls[1]).toMatchObject({ rates: [{ rateId: "standard", price: null }] });
  });
  test("a manual rate names what clearing it restores", async () => {
    const { ProviderRateEditor } = await load(variant, "provider-rate-editor");
    const connection = structuredClone(initialConnections[0]!);
    const rate = connection.rates[0]!;
    const manual = { ...rate.provenance, source: "manual" as const, origin: "host" as const };
    connection.rates = [
      {
        ...rate,
        id: "listed",
        label: "Listed",
        provenance: manual,
        fallback: {
          price: rate.price,
          provenance: { ...rate.provenance, source: "list", origin: "catalog", sampleSize: null },
        },
      },
      { ...rate, id: "bare", label: "Bare", provenance: manual },
    ];
    mounted(createElement(ProviderRateEditor!, { connection }));
    for (const name of [/Listed/, /Bare/]) fireEvent.click(screen.getByRole("button", { name }));
    expect(screen.getByRole("button", { name: "Use list price" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear your rate" })).toBeTruthy();
  });
  test("dollar text and input move the decimal point exactly", async () => {
    const money = (await load(variant, "provider-feedback")) as unknown as Record<
      "usdText" | "usdInput" | "centsFromUsd",
      (text: string) => string | null
    >;
    expect(money.usdText("0.6250")).toBe("$0.00625");
    expect(money.usdText("123456789.5")).toBe("$1,234,567.895");
    expect(money.usdText("100")).toBe("$1.00");
    expect(money.usdText("-5")).toBe("−$0.05");
    expect(money.usdText("1e3")).toBeNull();
    expect(money.usdInput("1250.00")).toBe("12.5000");
    expect(money.usdInput("0.6250")).toBe("0.006250");
    expect(money.centsFromUsd("12.5000")).toBe("1250.00");
    expect(money.centsFromUsd("0.000001")).toBe("0.0001");
    expect(money.centsFromUsd("5")).toBe("500");
    expect(money.centsFromUsd("9007199254740993.125")).toBe("900719925474099312.5");
    expect(money.centsFromUsd("0.0000001")).toBeNull();
    expect(money.centsFromUsd("-1")).toBeNull();
  });
  test("fallback order is one atomic CAS command and excludes its own connection", async () => {
    const { ProviderChainEditor } = await load(variant, "provider-chain-editor");
    const demo = fixture();
    const connection = {
      ...initialConnections[0]!,
      fallbackChain: ["backup", "language-platform"],
    };
    const backup = { ...initialConnections[1]!, id: "backup", label: "Backup" };
    mounted(
      createElement(ProviderChainEditor!, {
        connection,
        connections: [connection, initialConnections[1], backup],
      }),
      demo,
    );
    expect(screen.queryByRole("button", { name: "Add to fallback: Search production" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Move up: Language shared" }));
    expect(demo.calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Save fallback order" }));
    await waitFor(() => expect(demo.calls).toHaveLength(1));
    expect(demo.calls[0]).toMatchObject({
      kind: "settings",
      expectedRevision: "1",
      changes: { fallbackChain: ["language-platform", "backup"] },
    });
  });
  test("allocation matrix keeps all four units and submits only one changed row exactly", async () => {
    const { ProviderAllocationEditor } = await load(variant, "provider-allocation-editor");
    const demo = fixture();
    mounted(
      createElement(ProviderAllocationEditor!, {
        rows: initialAllocations,
        revision: "1",
        fresh: true,
      }),
      demo,
    );
    const ownApp = screen.getByRole("region", { name: "Own key App" });
    const platformApp = screen.getByRole("region", { name: "Platform funded App" });
    expect(within(platformApp).getByLabelText("Limit (cents)")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Own key Programmatic" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Platform funded Programmatic" })).toBeTruthy();
    fireEvent.click(within(ownApp).getByRole("button", { name: "Use available balance" }));
    expect((within(ownApp).getByLabelText("Limit (requests)") as HTMLInputElement).value).toBe(
      "9007199254741008.125",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save allocations" }));
    await waitFor(() => expect(demo.calls).toHaveLength(1));
    expect(demo.calls[0]).toMatchObject({
      kind: "allocations",
      changes: [{ rowId: "byok-app", expectedRevision: "1", limit: "9007199254741008.125" }],
    });
  });
  test("settled usage refresh keeps an unsaved allocation draft in the same revision", async () => {
    const { ProviderAllocationEditor } = await load(variant, "provider-allocation-editor");
    const demo = fixture();
    const rendered = mounted(
      createElement(ProviderAllocationEditor!, { rows: initialAllocations, revision: "1" }),
      demo,
    );
    fireEvent.change(screen.getAllByLabelText("Limit (requests)")[0]!, {
      target: { value: "123" },
    });
    const rows = structuredClone(initialAllocations);
    rows[0]!.used = { text: "25", unit: "requests", certainty: "measured" };
    rendered.rerender(
      rendered.wrap(createElement(ProviderAllocationEditor!, { rows, revision: "1" })),
    );
    expect((screen.getAllByLabelText("Limit (requests)")[0] as HTMLInputElement).value).toBe("123");
    fireEvent.click(screen.getByRole("button", { name: "Save allocations" }));
    await waitFor(() => expect(demo.calls).toHaveLength(1));
    expect(demo.calls[0]).toMatchObject({
      changes: [{ rowId: "byok-app", expectedRevision: "1", limit: "123" }],
    });
  });
  test("balances and request quotes keep unknown cost independent of known customer charge", async () => {
    const { ProviderBalanceCard, ProviderRequestQuote } = await load(
      variant,
      "provider-balance-card",
    );
    render(
      createElement(ProviderBalanceCard!, {
        balance: {
          connectionId: "c",
          fundingSource: "byok",
          authority: "provider",
          balance: { text: "9007199254740993.125", unit: "tokens", certainty: "measured" },
          reserved: { text: "", unit: "tokens", certainty: "unknown" },
          availability: { state: "unknown" },
          freshness: { observedAt: null, stale: true, source: "unknown" },
        },
      }),
    );
    expect(screen.getByText("9007199254740993.125 tokens")).toBeTruthy();
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.getByText("Stale evidence")).toBeTruthy();
    cleanup();
    render(
      createElement(ProviderRequestQuote!, {
        projection: {
          connectionId: "c",
          quantity: { text: "1", unit: "requests", certainty: "measured" },
          providerCost: { text: "", unit: "cents", certainty: "unknown" },
          customerCharge: { text: "1.0000", unit: "customer_cents", certainty: "measured" },
          canProceed: "unknown",
          freshness: { observedAt: null, stale: true, source: "unknown" },
        },
      }),
    );
    expect(screen.getByText("1.0000 cents")).toBeTruthy();
    expect(screen.getAllByText("Unknown")).toHaveLength(2);
    expect(screen.queryByText("0 cents")).toBeNull();
  });
  test("allocation drafts reset on a new host revision and cannot overwrite untouched rows", async () => {
    const { ProviderAllocationEditor } = await load(variant, "provider-allocation-editor");
    const demo = fixture();
    const rendered = mounted(
      createElement(ProviderAllocationEditor!, { rows: initialAllocations, revision: "1" }),
      demo,
    );
    fireEvent.change(screen.getAllByLabelText("Limit (requests)")[0]!, {
      target: { value: "123" },
    });
    const rows = structuredClone(initialAllocations);
    rows[0]!.revision = "2";
    rows[0]!.limit = { text: "500", unit: "requests", certainty: "measured" };
    rendered.rerender(
      rendered.wrap(createElement(ProviderAllocationEditor!, { rows, revision: "2" })),
    );
    expect((screen.getAllByLabelText("Limit (requests)")[0] as HTMLInputElement).value).toBe("500");
    expect(
      (screen.getByRole("button", { name: "Save allocations" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(demo.calls).toEqual([]);
  });
  test.each(["stale", "unit", "unknown"])("use available refuses %s evidence", async (reason) => {
    const { ProviderAllocationEditor } = await load(variant, "provider-allocation-editor");
    const demo = fixture();
    const rows = structuredClone(initialAllocations);
    if (reason === "unit")
      rows[0]!.available = { text: "1", unit: "tokens", certainty: "measured" };
    if (reason === "unknown")
      rows[0]!.available = { text: "", unit: "requests", certainty: "unknown" };
    mounted(
      createElement(ProviderAllocationEditor!, { rows, revision: "1", fresh: reason !== "stale" }),
      demo,
    );
    expect(
      (
        within(screen.getByRole("region", { name: "Own key App" })).getByRole("button", {
          name: "Use available balance",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  test("manager conflict retains its editor until explicit reload and can then save latest revision", async () => {
    const { ProviderManagerPanel } = await load(variant, "provider-manager-panel");
    const demo = fixture();
    demo.setNextOutcome("conflict");
    mounted(createElement(ProviderManagerPanel!), demo);
    await screen.findByText("Search production");
    fireEvent.click(screen.getAllByRole("button", { name: "Manage connection" })[0]!);
    fireEvent.change(screen.getByLabelText(/Price/), { target: { value: "12.5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rate" }));
    await screen.findAllByText(/changed elsewhere/);
    await waitFor(() => expect(demo.snapshots().connections[0]!.revision).toBe("2"));
    expect((screen.getByLabelText(/Price/) as HTMLInputElement).value).toBe("12.5000");
    expect((screen.getByRole("button", { name: "Save rate" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload connections" }));
    await waitFor(() => expect(screen.queryByLabelText(/Price/)).toBeNull());
    fireEvent.click(screen.getAllByRole("button", { name: "Manage connection" })[0]!);
    fireEvent.change(screen.getByLabelText(/Price/), { target: { value: "14.5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rate" }));
    await waitFor(() => expect(demo.calls).toHaveLength(2));
    expect(demo.calls[1]).toMatchObject({ kind: "rates", expectedRevision: "2" });
  });
  test.each(["forbidden", "unavailable"] as const)(
    "allocation %s read keeps the draft fenced and hides old financial evidence until a fresh read",
    async (failure) => {
      const { ProviderAllocationPanel } = await load(variant, "provider-allocation-editor");
      const f = editorFixture();
      render(
        f.wrap(
          createElement(ProviderAllocationPanel!, { connectionIds: ["search-own"], fresh: true }),
        ),
      );
      const region = await screen.findByRole("region", { name: "Own key App" });
      fireEvent.change(within(region).getByLabelText("Limit (requests)"), {
        target: { value: "123" },
      });
      expect(within(region).getByText("12 requests")).toBeTruthy();
      f.fail(failure);
      await f.refresh();
      await screen.findByText(
        failure === "forbidden"
          ? "You cannot make this change."
          : "Stored evidence is unavailable.",
      );

      const draft = within(screen.getByRole("region", { name: "Own key App" })).getByLabelText(
        "Limit (requests)",
      ) as HTMLInputElement;
      expect(draft.value).toBe("123");
      expect(draft.readOnly || draft.disabled).toBe(true);
      expect(
        (screen.getByRole("button", { name: "Save allocations" }) as HTMLButtonElement).disabled,
      ).toBe(true);
      for (const value of [
        "12 requests",
        "3 requests",
        "985 requests",
        "9007199254740993.125 requests",
      ])
        expect(screen.queryByText(value)).toBeNull();
      expect(
        (
          within(screen.getByRole("region", { name: "Own key App" })).getByRole("button", {
            name: "Use available balance",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      expect(f.demo.calls).toEqual([]);

      f.newer();
      f.fail(null);
      await f.refresh();
      await screen.findByText("25 requests");
      expect(
        (
          within(screen.getByRole("region", { name: "Own key App" })).getByLabelText(
            "Limit (requests)",
          ) as HTMLInputElement
        ).value,
      ).toBe("123");
      fireEvent.click(screen.getByRole("button", { name: "Reload allocations" }));
      await waitFor(() =>
        expect(
          (
            within(screen.getByRole("region", { name: "Own key App" })).getByLabelText(
              "Limit (requests)",
            ) as HTMLInputElement
          ).value,
        ).toBe("700"),
      );
      expect(f.demo.calls).toEqual([]);
    },
  );
  test.each(["forbidden", "unavailable"] as const)(
    "manager %s read retains the disabled rate draft without old price, provenance or balance",
    async (failure) => {
      const { ProviderManagerPanel } = await load(variant, "provider-manager-panel");
      const f = editorFixture();
      render(f.wrap(createElement(ProviderManagerPanel!)));
      await screen.findByText("Search production");
      fireEvent.click(screen.getAllByRole("button", { name: "Manage connection" })[0]!);
      const price = await screen.findByLabelText(/Price/);
      fireEvent.change(price, { target: { value: "12.5000" } });
      expect(screen.getByText("rate-1")).toBeTruthy();
      f.fail(failure);
      await f.refresh();
      await screen.findAllByText(
        failure === "forbidden"
          ? "You cannot make this change."
          : "Stored evidence is unavailable.",
      );

      const draft = screen.getByLabelText(/Price/) as HTMLInputElement;
      expect(draft.value).toBe("12.5000");
      expect(draft.readOnly || draft.disabled).toBe(true);
      expect(
        (screen.getByRole("button", { name: "Save rate" }) as HTMLButtonElement).disabled,
      ).toBe(true);
      for (const value of [
        "rate-1",
        "153",
        "9007199254740993.125 requests",
        "12 requests",
        "985 requests",
      ])
        expect(screen.queryByText(value)).toBeNull();
      expect(screen.queryByText(/\$0\.00625/)).toBeNull();
      expect(f.demo.calls).toEqual([]);

      f.newer();
      f.fail(null);
      await f.refresh();
      await screen.findByText("rate-2");
      expect((screen.getByLabelText(/Price/) as HTMLInputElement).value).toBe("12.5000");
      fireEvent.click(screen.getByRole("button", { name: "Reload connections" }));
      await waitFor(() => expect(screen.queryByLabelText(/Price/)).toBeNull());
      fireEvent.click(screen.getAllByRole("button", { name: "Manage connection" })[0]!);
      await waitFor(() =>
        expect((screen.getByLabelText(/Price/) as HTMLInputElement).value).toBe("0.097500"),
      );
      expect(f.demo.calls).toEqual([]);
    },
  );
  test("failed explicit allocation reload does not discard a dirty draft on later background recovery", async () => {
    const { ProviderAllocationPanel } = await load(variant, "provider-allocation-editor");
    const f = editorFixture();
    render(f.wrap(createElement(ProviderAllocationPanel!, { connectionIds: ["search-own"] })));
    const region = await screen.findByRole("region", { name: "Own key App" });
    fireEvent.change(within(region).getByLabelText("Limit (requests)"), {
      target: { value: "123" },
    });
    f.fail("unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Reload allocations" }));
    await screen.findByText("Stored evidence is unavailable.");
    expect((screen.getAllByLabelText("Limit (requests)")[0] as HTMLInputElement).value).toBe("123");
    f.newer();
    f.fail(null);
    await f.refresh();
    await screen.findByText("25 requests");
    expect((screen.getAllByLabelText("Limit (requests)")[0] as HTMLInputElement).value).toBe("123");
    expect(f.demo.calls).toEqual([]);
  });
  test("changing the manager query removes the old selected rate draft before the new read finishes", async () => {
    const { ProviderManagerPanel } = await load(variant, "provider-manager-panel");
    const f = editorFixture();
    const rendered = render(f.wrap(createElement(ProviderManagerPanel!, { provider: "search" })));
    await screen.findByText("Search production");
    fireEvent.click(screen.getByRole("button", { name: "Manage connection" }));
    fireEvent.change(await screen.findByLabelText(/Price/), { target: { value: "12.5000" } });
    rendered.rerender(f.wrap(createElement(ProviderManagerPanel!, { provider: "language" })));
    expect(screen.queryByLabelText(/Price/)).toBeNull();
    expect(screen.queryByText("rate-1")).toBeNull();
    await screen.findByText("Language shared");
    expect(screen.queryByLabelText(/Price/)).toBeNull();
    expect(f.demo.calls).toEqual([]);
  });
  test("removed allocation targets keep a disabled draft without retained totals or a writable Save", async () => {
    const { ProviderAllocationPanel } = await load(variant, "provider-allocation-editor");
    const f = editorFixture();
    render(
      f.wrap(
        createElement(ProviderAllocationPanel!, { connectionIds: ["search-own"], fresh: true }),
      ),
    );
    const region = await screen.findByRole("region", { name: "Own key App" });
    fireEvent.change(within(region).getByLabelText("Limit (requests)"), {
      target: { value: "123" },
    });
    f.remove();
    await f.refresh();
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Save allocations" }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    expect((screen.getAllByLabelText("Limit (requests)")[0] as HTMLInputElement).value).toBe("123");
    expect(screen.queryByText("12 requests")).toBeNull();
    expect(screen.queryByText("985 requests")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save allocations" }));
    expect(f.demo.calls).toEqual([]);
  });
  test("removed manager target hides rate evidence and fences its retained draft while new connections remain available", async () => {
    const { ProviderManagerPanel } = await load(variant, "provider-manager-panel");
    const f = editorFixture();
    render(f.wrap(createElement(ProviderManagerPanel!)));
    await screen.findByText("Search production");
    fireEvent.click(screen.getAllByRole("button", { name: "Manage connection" })[0]!);
    fireEvent.change(await screen.findByLabelText(/Price/), { target: { value: "12.5000" } });
    f.remove();
    await f.refresh();
    await screen.findByText("No provider connections yet.");
    expect((screen.getByLabelText(/Price/) as HTMLInputElement).value).toBe("12.5000");
    expect((screen.getByRole("button", { name: "Save rate" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByText("rate-1")).toBeNull();
    expect(screen.queryByText(/\$0\.00625/)).toBeNull();
    expect(
      (screen.getByRole("button", { name: "New connection: Search" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save rate" }));
    expect(f.demo.calls).toEqual([]);
  });
  test("hook-backed rate panel preserves a dirty draft on failed read and rebases only on successful Reload", async () => {
    const { ProviderRatePanel } = await load(variant, "provider-rate-editor");
    const f = editorFixture();
    render(f.wrap(createElement(ProviderRatePanel!, { connectionId: "search-own" })));
    fireEvent.change(await screen.findByLabelText(/Price/), { target: { value: "12.5000" } });
    f.fail("unavailable");
    await f.refresh();
    await screen.findByText("Stored evidence is unavailable.");
    expect((screen.getByLabelText(/Price/) as HTMLInputElement).value).toBe("12.5000");
    expect((screen.getByRole("button", { name: "Save rate" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByText("rate-1")).toBeNull();
    expect(screen.queryByText(/\$0\.00625/)).toBeNull();
    f.newer();
    f.fail(null);
    await f.refresh();
    await screen.findByText("rate-2");
    expect((screen.getByLabelText(/Price/) as HTMLInputElement).value).toBe("12.5000");
    fireEvent.click(screen.getByRole("button", { name: "Reload rates" }));
    await waitFor(() =>
      expect((screen.getByLabelText(/Price/) as HTMLInputElement).value).toBe("0.097500"),
    );
    expect(f.demo.calls).toEqual([]);
  });
  test("manager opens a newly observed provider from fresh evidence", async () => {
    const { ProviderManagerPanel } = await load(variant, "provider-manager-panel");
    const f = editorFixture();
    render(f.wrap(createElement(ProviderManagerPanel!)));
    await screen.findByText("Search production");
    f.revealProvider();
    await f.refresh();
    fireEvent.click(await screen.findByRole("button", { name: "New connection: New provider" }));
    expect(screen.getByRole("form", { name: "New provider credentials" })).toBeTruthy();
    expect(screen.getByLabelText("API key")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Manage connection" })[2]!);
    fireEvent.change(await screen.findByLabelText(/Price/), { target: { value: "12.5000" } });
    f.fail("unavailable");
    await f.refresh();
    await screen.findAllByText("Stored evidence is unavailable.");
    expect((screen.getByLabelText(/Price/) as HTMLInputElement).value).toBe("12.5000");
    expect((screen.getByRole("button", { name: "Save rate" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByText("rate-1")).toBeNull();
    expect(screen.queryByText(/\$0\.00625/)).toBeNull();
    expect(f.demo.calls).toEqual([]);
  });
  test.each(["forbidden", "unavailable", "empty"])(
    "manager distinguishes %s from loading",
    async (state) => {
      const { ProviderManagerPanel } = await load(variant, "provider-manager-panel");
      const demo = fixture();
      demo.port.read = vi.fn(async () =>
        state === "forbidden"
          ? { outcome: "forbidden" as const }
          : state === "unavailable"
            ? { outcome: "unavailable" as const, message: "Host offline" }
            : {
                outcome: "ok" as const,
                value: {
                  kind: "connections" as const,
                  state: "empty" as const,
                  problem: null,
                  asOf: null,
                  revision: "1",
                  providers: [],
                  connections: [],
                },
              },
      );
      mounted(createElement(ProviderManagerPanel!), demo);
      await screen.findByText(
        state === "forbidden"
          ? "You cannot make this change."
          : state === "unavailable"
            ? "Host offline"
            : "No provider connections yet.",
      );
      expect(screen.queryByText("Loading connection evidence…")).toBeNull();
      expect(demo.calls).toEqual([]);
    },
  );
});
