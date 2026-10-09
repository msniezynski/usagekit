import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Figure, Limit } from "@usagekit/views";
import { figureText, usdExact } from "./format.js";
import { useLive, useLiveBudgets, useLiveSummary } from "./live.js";
import { FigureValue, LevelBadge, MeterBar, Money, SectionHeading } from "./ui.js";

/* Products: the two ways to use usagekit, built into a product or run in front of agents. */

export function ProductsSection() {
  return (
    <section className="section prod" id="products" aria-labelledby="products-title">
      <div className="container">
        <SectionHeading id="products-title" title="Two ways to use it.">
          One runtime meters both: the calls your product makes for its users, and the calls your
          agents make.
        </SectionHeading>
        <div className="prod-grid">
          <div className="prod-panel">
            <div className="prod-copy">
              <h3 className="prod-title">In your product</h3>
              <p className="prod-text">
                Show your users their usage, provider costs and budgets with shadcn blocks for Radix
                or Base UI, or with headless React hooks.
              </p>
              <p className="prod-note">The runtime and the React layer are on npm.</p>
              <p className="prod-more">
                <a className="prod-link" href="/components/">
                  Explore the blocks
                </a>
              </p>
            </div>
            <figure className="prod-stage">
              <UsagePreview />
              <figcaption className="prod-caption">
                Sample data. It updates as you send requests above.
              </figcaption>
            </figure>
          </div>
          <div className="prod-panel">
            <div className="prod-copy">
              <h3 className="prod-title">For your agents</h3>
              <p className="prod-text">
                A local API proxy keeps provider keys in an encrypted vault. Budgets answer 429
                before a call is sent, and a dashboard tracks usage.
              </p>
              <p className="prod-note">
                Runs from the repository checkout, with SerpApi and DataForSEO built in.
              </p>
              <p className="prod-more">
                <a className="prod-link" href="/agents/">
                  See spend limits for agents
                </a>
              </p>
            </div>
            <figure className="prod-stage">
              <Exchange />
              <figcaption className="prod-caption">
                The same SerpApi search, before and after the limit.
              </figcaption>
            </figure>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Identity of a figure for change detection: certainty, unit and exact text. */
const keyOf = (value: Figure | Limit | undefined): string =>
  value === undefined
    ? "none"
    : typeof value === "string"
      ? value
      : `${value.certainty}:${value.unit}:${value.text}`;

/** "Nov 1": the sample's reset day, fixed in UTC so prerender and client agree. */
const resetDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** False in prerendered HTML and the hydrating render, true once the page is interactive. */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** A figure that settles briefly into place when a visitor's request changes it. */
function Tick({ value, fresh, children }: { value: string; fresh: boolean; children: ReactNode }) {
  return (
    <TickFace key={value} fresh={fresh}>
      {children}
    </TickFace>
  );
}
function TickFace({ fresh, children }: { fresh: boolean; children: ReactNode }) {
  // Decided once, when this value first appears: never on page load, always after a change.
  const [changed] = useState(fresh);
  return (
    <span className="prod-tick" data-changed={changed ? "" : undefined}>
      {children}
    </span>
  );
}

/**
 * A usage card as a product would show it, built from the hooks that read this page's Meter:
 * spend against the monthly budget, the requests behind it, and what is reserved right now.
 */
function UsagePreview() {
  const live = useLive();
  const { view: budgets } = useLiveBudgets();
  const { view: summary } = useLiveSummary();
  const fresh = useMounted();
  const row = budgets.rows[0];
  if (budgets.state !== "ok" || !row || row.redacted)
    return <p className="prod-card prod-missing">The sample budget is not available.</p>;
  const limit = typeof row.limit === "object" ? row.limit.text : null;
  const requests = summary.measurements.requests;
  return (
    <div className="prod-card" data-flight={live.inFlight > 0}>
      <div className="prod-card-head">
        <div>
          <p className="prod-card-title">Monthly spend</p>
          <p className="prod-card-desc">
            {row.resetsAt ? `Resets ${resetDay.format(new Date(row.resetsAt))}` : "No reset"}
          </p>
        </div>
        {row.level === "unavailable" ? (
          <span className="badge">Unavailable</span>
        ) : (
          <LevelBadge level={row.level} />
        )}
      </div>
      <p className="prod-card-reading">
        <span className="prod-card-used">
          <Tick value={keyOf(row.used)} fresh={fresh}>
            <FigureValue figure={row.used} />
          </Tick>
        </span>
        {limit ? (
          <span className="prod-card-of">
            of <Money cents={limit} />
          </span>
        ) : null}
      </p>
      <MeterBar
        bar={row.bar}
        label="Monthly spend"
        valueText={`${figureText(row.used)} used and ${figureText(row.reserved)} reserved${limit ? ` of ${usdExact(limit)}` : ""}`}
      />
      <dl className="prod-figures">
        <div>
          <dt>Requests</dt>
          <dd>
            <Tick value={keyOf(requests)} fresh={fresh}>
              <FigureValue figure={requests} className="num" />
            </Tick>
          </dd>
        </div>
        <div>
          <dt>Reserved</dt>
          <dd>
            <Tick value={keyOf(row.reserved)} fresh={fresh}>
              <FigureValue figure={row.reserved} />
            </Tick>
          </dd>
        </div>
        <div>
          <dt>Remaining</dt>
          <dd>
            <Tick value={keyOf(row.remaining)} fresh={fresh}>
              {row.remaining === "unlimited" ? "Unlimited" : <FigureValue figure={row.remaining} />}
            </Tick>
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** What an agent gets back from the local proxy: one metered call, then one refused. */
function Exchange() {
  return (
    <div className="prod-wire">
      <div className="prod-wire-head">
        <code className="prod-wire-req">
          <span className="prod-wire-method">GET</span> /proxy/c1/search?q=ai
        </code>
        <span className="prod-tag">Illustration</span>
      </div>
      <ol className="prod-wire-list">
        <li className="prod-res">
          <span className="prod-http is-ok">200</span>
          <span>OK</span>
          <span className="prod-res-detail">
            <span className="prod-res-key">X-Usagekit-Accounting:</span> metered
          </span>
        </li>
        <li className="prod-res">
          <span className="prod-http is-denied">429</span>
          <span>Too Many Requests</span>
          <span className="prod-res-detail">
            {'{"error":'}
            <wbr />
            {'"allowance_exceeded"}'}
          </span>
        </li>
      </ol>
    </div>
  );
}
