import { useState } from "react";
import type { ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";
import type { BudgetBar } from "@usagekit/views";
import { Code } from "./code.js";
import { Certainty, LevelBadge, MeterBar, SectionHeading } from "./ui.js";

/* Agents: usagekit serve as a local proxy, ledger and dashboard for agents that call paid APIs. */

/** Inline code in running text. */
const C = ({ children }: { children: ReactNode }) => <code className="agt-code">{children}</code>;

/** Lines stay within 46 characters so each command fits its 5fr column without scrolling. */
const setupSource = [
  "usagekit provider add serpapi \\",
  "  --connection c1 --secret-env PROVIDER_KEY",
  "usagekit budget set --id agent \\",
  "  --scope connection --connection c1 \\",
  "  --limit 500:requests --alert 80",
].join("\n");

const callSource = [
  "curl --fail-with-body \\",
  '  -H "Authorization: Bearer $USAGEKIT_TOKEN" \\',
  '  -H "Idempotency-Key: search-job-447" \\',
  '  "http://127.0.0.1:4242/proxy/c1/search?q=ai"',
].join("\n");

const steps: readonly {
  title: string;
  text: ReactNode;
  code?: { title: string; source: string };
}[] = [
  {
    title: "Store the key and set a limit",
    text: (
      <>
        The key goes into the encrypted vault. The budget caps <C>c1</C> at 500 requests a month.
      </>
    ),
    code: { title: "Terminal", source: setupSource },
  },
  {
    title: "Point the agent at the proxy",
    text: "The agent sends the local token. The proxy adds the provider key from the vault.",
    code: { title: "Agent request", source: callSource },
  },
  {
    title: "Watch it in the dashboard",
    text: (
      <>
        Open <C>127.0.0.1:4242</C> and enter the token to see usage, budgets and exceptions, drawn
        with the same{" "}
        <a className="link" href="/components/">
          shadcn blocks
        </a>{" "}
        you can copy.
      </>
    ),
  },
];

const points: readonly { title: string; text: ReactNode }[] = [
  {
    title: "Keys stay in the vault.",
    text: "The agent never holds the provider key, and requests only go to the provider's pinned origin.",
  },
  {
    title: "A hard stop before dispatch.",
    text: "Past a blocking limit, nothing reaches the provider.",
  },
  {
    title: "No silent retries.",
    text: (
      <>
        A repeated <C>Idempotency-Key</C> gets <C>409</C>, and the proxy never retries a call on its
        own.
      </>
    ),
  },
];

/** The page's h1 carries the promise, so the heading only names the path. */
const title = "From key to limit in three\u00a0steps.";

export function AgentsSection() {
  return (
    <section className="section agt" id="agents" aria-labelledby="agents-title">
      <div className="container">
        <SectionHeading id="agents-title" title={title}>
          The agent needs no SDK, only the proxy URL and a local token.
        </SectionHeading>

        <div className="agt-grid">
          <ol className="agt-steps">
            {steps.map((step, index) => (
              <li key={step.title} className="agt-step">
                <span className="agt-step-num num" aria-hidden="true">
                  {index + 1}
                </span>
                <h3 className="agt-step-title">{step.title}</h3>
                <p className="agt-step-text">{step.text}</p>
                {step.code ? (
                  <Code lang="shell" title={step.code.title}>
                    {step.code.source}
                  </Code>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="agt-media">
            <Dashboard />
            <Wire />
          </div>
        </div>

        <ul className="agt-points">
          {points.map(({ title, text }) => (
            <li key={title} className="agt-point">
              <p>
                <strong>{title}</strong> {text}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/*
 * The local dashboard, drawn with the page's primitives. One static story across the tabs:
 * connection c1 has 446 settled requests this month and 1 in flight, so 53 of 500 remain and the
 * 80% alert has been crossed. One call from last month was cut off by a crash: it is pending with
 * unknown cost, so it shows under Exceptions (which looks back to last month) and this month's
 * usage stays exact.
 */

const pages = [
  ["overview", "Overview"],
  ["budgets", "Budgets"],
  ["exceptions", "Exceptions"],
  ["connections", "Connections"],
] as const;

const bar: BudgetBar = {
  used: "89.2",
  reserved: "0.2",
  limit: "100",
  hardLimit: null,
  alerts: ["80"],
};

function Dashboard() {
  // Pages fade in only after a visitor switches tabs, never on page load.
  const [switched, setSwitched] = useState(false);
  return (
    <figure className="agt-frame">
      <figcaption className="agt-bar">
        <span className="agt-address">
          <span className="sr-only">Local dashboard at </span>127.0.0.1:4242
        </span>
        <span className="agt-bar-label">Illustration</span>
      </figcaption>
      <Tabs.Root defaultValue="overview" onValueChange={() => setSwitched(true)}>
        <Tabs.List className="agt-nav" aria-label="Dashboard pages">
          {pages.map(([value, label]) => (
            <Tabs.Tab key={value} value={value} className="agt-nav-tab">
              {label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {/* Pages stay mounted and unhidden, stacked in one cell so a wide frame keeps its height.
            Base UI marks the inactive ones inert; the stylesheet makes them invisible. */}
        <div className="agt-pages" data-switched={switched ? "" : undefined}>
          <Tabs.Panel value="overview" className="agt-page" keepMounted hidden={false}>
            <OverviewPage />
          </Tabs.Panel>
          <Tabs.Panel value="budgets" className="agt-page" keepMounted hidden={false}>
            <BudgetsPage />
          </Tabs.Panel>
          <Tabs.Panel value="exceptions" className="agt-page" keepMounted hidden={false}>
            <ExceptionsPage />
          </Tabs.Panel>
          <Tabs.Panel value="connections" className="agt-page" keepMounted hidden={false}>
            <ConnectionsPage />
          </Tabs.Panel>
        </div>
      </Tabs.Root>
    </figure>
  );
}

const usage: readonly [provider: string, operation: string, requests: string][] = [
  ["serpapi", "search", "446"],
];

const coverage: readonly [label: string, count: string, share: string][] = [
  ["Metered", "446", "100"],
  ["Unpriced", "0", "0"],
  ["Passthrough", "0", "0"],
];

function OverviewPage() {
  return (
    <div className="agt-overview">
      <div className="agt-status-row">
        <LevelBadge level="warning">
          <span className="sr-only">Warning: </span>53 of 500 requests left
        </LevelBadge>
        <span className="agt-meta">This month</span>
      </div>
      <div className="agt-card is-usage">
        <p className="agt-card-title">Usage detail</p>
        <table className="agt-table">
          <caption className="sr-only">Usage this month, by provider and operation</caption>
          <thead>
            <tr>
              <th scope="col">Provider</th>
              <th scope="col">Operation</th>
              <th scope="col" className="is-num">
                Requests
              </th>
            </tr>
          </thead>
          <tbody>
            {usage.map(([provider, operation, requests]) => (
              <tr key={`${provider} ${operation}`}>
                <th scope="row">{provider}</th>
                <td>{operation}</td>
                <td className="is-num num">{requests}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="agt-foot">The ledger stores no request content.</p>
      </div>
      <div className="agt-card">
        <div className="agt-card-head">
          <p className="agt-card-title">Coverage</p>
          <p className="agt-meta">Requests by tracking state</p>
        </div>
        <ul className="agt-cov">
          {coverage.map(([label, count, share]) => (
            <li key={label} className="agt-cov-row">
              <span className="agt-cov-label">{label}</span>
              <span className="agt-cov-bar" aria-hidden="true">
                <span style={{ width: `${share}%` }} />
              </span>
              <span className="agt-cov-count num">{count}</span>
            </li>
          ))}
        </ul>
        <p className="agt-cov-total">
          <span>Total</span>
          <span className="num">446 requests</span>
        </p>
      </div>
    </div>
  );
}

const figures: readonly [label: string, mark: string, value: string][] = [
  ["Used", "used", "446 requests"],
  ["Reserved", "reserved", "1 request"],
  ["Remaining", "headroom", "53 requests"],
  ["Limit", "none", "500 requests"],
];

function BudgetsPage() {
  return (
    <div className="agt-card">
      <div className="agt-card-head">
        <div>
          <p className="agt-card-title">connection c1</p>
          <p className="agt-meta">Resets on the 1st</p>
        </div>
        <LevelBadge level="warning" />
      </div>
      <MeterBar
        bar={bar}
        label="connection c1"
        valueText="446 requests used and 1 request reserved of 500 requests"
      />
      <dl className="agt-rows">
        {figures.map(([label, mark, value]) => (
          <div key={label} className="agt-row">
            <dt>
              <span className={`agt-key is-${mark}`} aria-hidden="true" />
              {label}
            </dt>
            <dd className="num">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="agt-foot">Blocks at the limit. Alert at 80%.</p>
    </div>
  );
}

function ExceptionsPage() {
  return (
    <div className="agt-card">
      <div className="agt-card-head">
        <p className="agt-card-title">Needs attention</p>
        <p className="agt-meta">1 operation</p>
      </div>
      <div className="agt-item">
        <div className="agt-item-head">
          <code className="agt-id">search-job-377</code>
          <span className="badge agt-kind">
            <span className="badge-dot" aria-hidden="true" />
            Pending evidence
          </span>
        </div>
        <dl className="agt-facts">
          <div>
            <dt>Provider</dt>
            <dd>serpapi search</dd>
          </div>
          <div>
            <dt>Cost</dt>
            <dd>
              <Certainty value="unknown" />
            </dd>
          </div>
          <div>
            <dt>Age</dt>
            <dd className="num">9 d</dd>
          </div>
        </dl>
      </div>
      <p className="agt-foot">
        Dispatched before a crash. Its cost stays unknown, and it is never resent.
      </p>
    </div>
  );
}

function ConnectionsPage() {
  return (
    <div className="agt-card">
      <div className="agt-card-head">
        <p className="agt-card-title">Connections</p>
        <p className="agt-meta">1 connection</p>
      </div>
      <div className="agt-item">
        <dl className="agt-facts is-four">
          <div>
            <dt>Connection</dt>
            <dd>
              <code className="agt-id">c1</code>
            </dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd>serpapi</dd>
          </div>
          <div>
            <dt>Funding</dt>
            <dd>Own key</dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd>No plan</dd>
          </div>
        </dl>
      </div>
      <p className="agt-foot">The key itself stays in the encrypted vault.</p>
    </div>
  );
}

/** Two proxy responses as the agent receives them: status line and the headers that matter. */
function Wire() {
  return (
    <figure className="agt-wire">
      <figcaption className="agt-wire-head">
        <span className="agt-wire-title">What the agent gets back</span>
        <span className="agt-bar-label">Illustration</span>
      </figcaption>
      <ol className="agt-wire-list">
        <li className="agt-res">
          <p className="agt-res-when">Under the limit</p>
          <div className="agt-res-body">
            <p className="agt-res-status">
              <span className="agt-http is-ok">200</span> OK
            </p>
            <dl className="agt-headers">
              <div>
                <dt>X-Usagekit-Operation-Id</dt>
                <dd>search-job-447</dd>
              </div>
              <div>
                <dt>X-Usagekit-Accounting</dt>
                <dd>metered</dd>
              </div>
            </dl>
          </div>
        </li>
        <li className="agt-res">
          <p className="agt-res-when">Limit reached</p>
          <div className="agt-res-body">
            <p className="agt-res-status">
              <span className="agt-http is-denied">429</span> Too Many Requests{" "}
              <span className="agt-res-code">allowance_exceeded</span>
            </p>
            <dl className="agt-headers">
              <div>
                <dt>Retry-After</dt>
                <dd>1987200</dd>
              </div>
            </dl>
            <p className="agt-res-note">
              Seconds until the budget resets. Nothing reached the provider.
            </p>
          </div>
        </li>
      </ol>
    </figure>
  );
}
