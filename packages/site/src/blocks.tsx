import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@base-ui/react/button";
import { Tabs } from "@base-ui/react/tabs";
import { Info, RotateCcw, Send, TimerOff } from "lucide-react";
import type { Certainty as CertaintyValue, FundingSource } from "@usagekit/core";
import type {
  AlertAt,
  CoverageState,
  ExceptionKind,
  Figure,
  Level,
  Limit,
  UsageFundingSummary,
} from "@usagekit/views";
import { useAnnouncer } from "./announce.js";
import { Code } from "./code.js";
import { registryBlocks } from "./content.js";
import { groupDigits, providerLabel, usdExact, utcTime } from "./format.js";
import {
  maxInFlight,
  useLive,
  useLiveBudgets,
  useLiveCoverage,
  useLiveExceptions,
  useLiveHeader,
  useLiveSummary,
  useLiveUsage,
} from "./live.js";
import type { Live } from "./live.js";
import { fixturePeriod } from "./meter-fixture.js";
import type { SiteEvent } from "./meter-fixture.js";
import { Certainty, FigureValue, LevelBadge, MeterBar, SectionHeading } from "./ui.js";

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const monthName = (iso: string) => months[Number(iso.slice(5, 7)) - 1] ?? iso.slice(0, 7);
/** "Nov 1" from an ISO instant, in UTC and without the viewer's locale. */
const dayText = (iso: string) => `${monthName(iso).slice(0, 3)} ${Number(iso.slice(8, 10))}`;
/** The sample period, "October 2026". */
const periodText = `${monthName(fixturePeriod.from)} ${fixturePeriod.from.slice(0, 4)}`;

/** The registry budget-card's level labels. */
const levelText: Record<Level, string> = {
  ok: "Within budget",
  warning: "Warning",
  exceeded: "Exceeded",
};
const fundingLabel: Record<FundingSource, string> = {
  byok: "Own key",
  platform: "Platform funded",
};
const fundingOrder: Record<FundingSource, number> = { byok: 0, platform: 1 };

/** Identity of a figure for change detection: certainty and exact text. */
const keyOf = (value: Figure | Limit | undefined): string =>
  value === undefined
    ? "none"
    : typeof value === "string"
      ? value
      : `${value.certainty}:${value.unit}:${value.text}`;
const certaintyOf = (figure: Figure | undefined): CertaintyValue | "unavailable" =>
  figure === undefined || figure === "unavailable" ? "unavailable" : figure.certainty;
/** Exact figure text such as "$6.9998"; missing states keep their names. */
function figureWords(value: Figure | Limit): string {
  if (value === "unlimited") return "Unlimited";
  if (value === "unavailable") return "Unavailable";
  if (value.certainty === "unknown") return "Unknown";
  return value.unit === "cents" ? usdExact(value.text) : `${groupDigits(value.text)} ${value.unit}`;
}
const alertText = (at: AlertAt): string => ("percent" in at ? `${at.percent}%` : figureWords(at));
/** A budget figure in the page's money format; unlimited keeps its name. */
function BudgetFigure({ value }: { value: Figure | Limit }) {
  return value === "unlimited" ? <>Unlimited</> : <FigureValue figure={value} />;
}
function requestsText(figure: Figure | undefined): string {
  if (figure === undefined || figure === "unavailable") return "Requests unavailable";
  if (figure.certainty === "unknown") return "Requests unknown";
  return `${groupDigits(figure.text)} ${figure.text === "1" ? "request" : "requests"}`;
}

/** Exact integer of a cents text at four fractional digits, for bar geometry only. */
function scaled(text: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(text);
  return match ? BigInt(`${match[1] ?? "0"}${(match[2] ?? "").padEnd(4, "0")}`) : null;
}
/** Percent text truncated to two decimals, computed without floating point. */
function shareText(part: bigint, total: bigint): string {
  const basis = (part * 10_000n) / total;
  return `${basis / 100n}.${(basis % 100n).toString().padStart(2, "0")}`;
}
/** Bar widths for each funding row, or null while any cost is unknown. */
function splitOf(rows: readonly UsageFundingSummary[]): string[] | null {
  const values = rows.map((row) =>
    row.cost.certainty === "unknown" ? null : scaled(row.cost.text),
  );
  if (values.some((value) => value === null)) return null;
  const total = values.reduce<bigint>((sum, value) => sum + (value ?? 0n), 0n);
  return total > 0n ? values.map((value) => shareText(value ?? 0n, total)) : null;
}

/** Replays a short roll when its value changes after the first render, never on page load. */
function Tick({ value, children }: { value: string; children: ReactNode }) {
  const first = useRef(value);
  return (
    <span key={value} className="blk-tick" data-changed={value === first.current ? undefined : ""}>
      {children}
    </span>
  );
}

function Frame({ name, children }: { name: string; children: ReactNode }) {
  const id = `blk-${name}`;
  return (
    <article className={`blk-frame is-${name}`} aria-labelledby={id}>
      <header className="blk-cap">
        <h3 className="blk-cap-name" id={id}>
          {name}
        </h3>
      </header>
      <div className="blk-body">{children}</div>
    </article>
  );
}

/**
 * A table that scrolls inside its frame. Row headers stay pinned, and the trailing edge fades
 * while more columns wait to the right, since overlay scrollbars show nothing until a swipe.
 */
function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ scrolled: false, more: false });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const scrolled = node.scrollLeft > 0;
      const more = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
      setEdges((current) =>
        current.scrolled === scrolled && current.more === more ? current : { scrolled, more },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    node.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", measure);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="blk-scroll"
      tabIndex={0}
      role="region"
      aria-label={label}
      data-scrolled={edges.scrolled ? "" : undefined}
      data-more={edges.more ? "" : undefined}
    >
      {children}
    </div>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <p className="blk-message" role="status">
      {children}
    </p>
  );
}

function HeaderStatusBlock() {
  const { view } = useLiveHeader();
  const bound = view.bounds[0];
  const missing =
    view.state === "forbidden"
      ? "Status hidden"
      : view.state === "unavailable"
        ? "Status unavailable"
        : "No budgets apply";
  return (
    <Frame name="header-status">
      <div className="blk-appbar">
        <span className="blk-ws">
          <span className="blk-avatar" aria-hidden="true">
            DW
          </span>
          <span className="blk-ws-name">Demo workspace</span>
        </span>
        {/* Not a live region: the toolbar announces the requests it sends. */}
        <span className="blk-pill">
          {bound ? (
            <LevelBadge level={bound.level}>
              <span className="sr-only">{levelText[bound.level]}: </span>
              <Tick value={`${keyOf(bound.remaining)} ${keyOf(bound.of)}`}>
                <BudgetFigure value={bound.remaining} /> left of <BudgetFigure value={bound.of} />
              </Tick>
            </LevelBadge>
          ) : (
            <span className="badge">{missing}</span>
          )}
        </span>
      </div>
      {bound ? (
        <div className="blk-tip">
          <p className="blk-tip-title">{levelText[bound.level]}</p>
          <p>{bound.resetsAt ? `Resets ${dayText(bound.resetsAt)}` : "No reset"}</p>
          {bound.alerts.length ? (
            <p>Alert at {bound.alerts.map((alert) => alertText(alert.at)).join(", ")}</p>
          ) : null}
        </div>
      ) : null}
    </Frame>
  );
}

function Tile({ label, figure }: { label: string; figure: Figure | undefined }) {
  return (
    <div className="blk-tile">
      <p className="blk-tile-label">{label}</p>
      <p className="blk-tile-value">
        <Tick value={keyOf(figure)}>
          <FigureValue figure={figure} />
        </Tick>
      </p>
      <Certainty value={certaintyOf(figure)} />
    </div>
  );
}

function UsageSummaryBlock() {
  const { view } = useLiveSummary();
  const unknown = view.unknownOperations;
  const message =
    view.state === "forbidden"
      ? "You cannot view usage for this scope."
      : view.state === "unavailable"
        ? "Usage summary is unavailable right now."
        : view.state === "empty"
          ? "No usage in this period."
          : !view.complete
            ? "The summary could not cover the whole period."
            : null;
  return (
    <Frame name="usage-summary-cards">
      {message ? (
        <Message>{message}</Message>
      ) : (
        <div className="blk-tiles">
          <Tile label="Requests" figure={view.measurements.requests} />
          <Tile label="Provider cost" figure={view.measurements.cents} />
          <div className="blk-tile">
            <p className="blk-tile-label">Unknown operations</p>
            <p className="blk-tile-value">
              <Tick value={unknown ?? "none"}>
                {unknown === null ? (
                  <span className="figure-missing">Unavailable</span>
                ) : (
                  <span className="num">{groupDigits(unknown)}</span>
                )}
              </Tick>
            </p>
            <span
              className={`certainty is-${unknown === null ? "unavailable" : unknown === "0" ? "measured" : "unknown"}`}
            >
              <span className="certainty-mark" aria-hidden="true" />
              {unknown === null
                ? "Unavailable"
                : unknown === "0"
                  ? "None awaiting evidence"
                  : `${groupDigits(unknown)} awaiting evidence`}
            </span>
          </div>
        </div>
      )}
    </Frame>
  );
}

function BudgetRowItem({
  label,
  value,
  mark,
}: {
  label: string;
  value: Figure | Limit;
  mark: "used" | "reserved" | "headroom" | "none";
}) {
  return (
    <div className="blk-row">
      <dt>
        <span className={`blk-key is-${mark}`} aria-hidden="true" />
        {label}
      </dt>
      <dd>
        <Tick value={keyOf(value)}>
          <BudgetFigure value={value} />
        </Tick>
      </dd>
    </div>
  );
}

function BudgetCardBlock() {
  const { view } = useLiveBudgets();
  const live = useLive();
  const row = view.rows[0];
  if (view.state !== "ok" || !row)
    return (
      <Frame name="budget-card">
        <Message>
          {view.state === "forbidden"
            ? "You cannot view these budgets."
            : view.state === "unavailable"
              ? "Budgets are unavailable right now."
              : "No budgets apply."}
        </Message>
      </Frame>
    );
  const alerts = row.alerts.map((alert) => alertText(alert.at));
  return (
    <Frame name="budget-card">
      <div className="blk-head">
        <div>
          <p className="blk-title">Monthly spend</p>
          <p className="blk-desc">
            {row.resetsAt ? `Resets ${dayText(row.resetsAt)}` : "No reset"}
          </p>
        </div>
        {row.level === "unavailable" ? (
          <span className="badge">Unavailable</span>
        ) : (
          <LevelBadge level={row.level} />
        )}
      </div>
      {row.redacted ? (
        <Message>This shared budget applies, but its figures are hidden from you.</Message>
      ) : (
        <>
          {/* The hatching marches only while a request is in flight, not while one is pending. */}
          <div className="blk-meter" data-flight={live.inFlight > 0}>
            <MeterBar
              bar={row.bar}
              label="Monthly spend"
              valueText={`${figureWords(row.used)} used and ${figureWords(row.reserved)} reserved of ${figureWords(row.limit)}`}
              size="md"
            />
          </div>
          <dl className="blk-rows">
            <BudgetRowItem label="Used" mark="used" value={row.used} />
            <BudgetRowItem label="Reserved" mark="reserved" value={row.reserved} />
            <BudgetRowItem label="Remaining" mark="headroom" value={row.remaining} />
            <BudgetRowItem label="Limit" mark="none" value={row.limit} />
          </dl>
        </>
      )}
      <p className="blk-foot">
        {row.boundary.onExceed === "block" ? "Blocks at the limit." : "Allows overage."}
        {alerts.length ? ` Alert at ${alerts.join(", ")}.` : ""}
      </p>
    </Frame>
  );
}

function CostSummaryBlock() {
  const { view } = useLiveSummary();
  const funding = [...view.funding].sort(
    (a, b) => fundingOrder[a.fundingSource] - fundingOrder[b.fundingSource],
  );
  const split = splitOf(funding);
  const cost = view.complete ? view.cost : "unavailable";
  const message =
    view.state === "forbidden"
      ? "You cannot view costs for this scope."
      : view.state === "unavailable"
        ? "Cost summary is unavailable right now."
        : view.state === "empty"
          ? "No tracked costs in this period."
          : null;
  return (
    <Frame name="cost-summary-card">
      <div className="blk-head">
        <div>
          <p className="blk-title">Provider cost</p>
          <p className="blk-desc">Provider charges for tracked usage.</p>
        </div>
        <Certainty value={certaintyOf(cost)} />
      </div>
      {message ? (
        <Message>{message}</Message>
      ) : (
        <>
          <p className="blk-big">
            <Tick value={keyOf(cost)}>
              <FigureValue figure={cost} />
            </Tick>
          </p>
          <div className={split ? "blk-split" : "blk-split is-unknown"} aria-hidden="true">
            {split?.map((share, index) => (
              <span
                key={funding[index]?.key ?? index}
                className={`blk-split-part is-${funding[index]?.fundingSource ?? "platform"}`}
                style={{ width: `${share}%` }}
              />
            ))}
          </div>
          <ul className="blk-funding">
            {funding.map((row) => (
              <li key={row.key} className="blk-fund">
                <span className={`blk-key is-${row.fundingSource}`} aria-hidden="true" />
                <span className="blk-fund-name">{fundingLabel[row.fundingSource]}</span>
                <span className="blk-fund-cost">
                  <Tick value={keyOf(row.cost)}>
                    <FigureValue figure={row.cost} />
                  </Tick>
                </span>
                <span className="blk-fund-owner">
                  Cost owner <span className="mono">{row.costOwner}</span>
                </span>
                <span className="blk-fund-count">{requestsText(row.measurements.requests)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Frame>
  );
}

const coverageOrder = [
  "metered",
  "cached",
  "passthrough",
  "rate_limited",
  "unpriced",
] as const satisfies readonly CoverageState[];
const coverageLabel: Record<CoverageState, string> = {
  metered: "Metered",
  cached: "Cached",
  passthrough: "Passthrough",
  rate_limited: "Rate limited",
  unpriced: "Unpriced",
};

function CoverageBlock() {
  const { view } = useLiveCoverage();
  const message =
    view.state === "forbidden"
      ? "You cannot view coverage for this scope."
      : view.state === "unavailable"
        ? "Coverage is unavailable right now."
        : view.state === "empty"
          ? "No requests in this period."
          : null;
  return (
    <Frame name="coverage-summary">
      <div className="blk-head">
        <p className="blk-title">Coverage</p>
        <p className="blk-head-meta">{periodText}</p>
      </div>
      {message ? (
        <Message>{message}</Message>
      ) : (
        <>
          <ul className="blk-cov">
            {coverageOrder.map((state) => {
              const entry = view.entries.find((item) => item.state === state);
              const count = entry?.count ?? "unavailable";
              const share = entry?.share ?? null;
              return (
                <li key={state} className="blk-cov-row" data-state={state}>
                  <span className="blk-cov-label">{coverageLabel[state]}</span>
                  <span className="blk-cov-bar" aria-hidden="true">
                    <span style={{ width: `${share ?? "0"}%` }} />
                  </span>
                  <span className="blk-cov-count">
                    <Tick value={count}>
                      {count === "unavailable" ? (
                        <span className="figure-missing">Unavailable</span>
                      ) : (
                        groupDigits(count)
                      )}
                    </Tick>
                  </span>
                  <span className="blk-cov-share">{share === null ? "" : `${share}%`}</span>
                </li>
              );
            })}
          </ul>
          <p className="blk-cov-total">
            <span>Total</span>
            <span className="num">
              {view.total === null ? "Unavailable" : `${groupDigits(view.total)} requests`}
            </span>
          </p>
          <p className="blk-note">
            <Info size={14} strokeWidth={1.75} aria-hidden="true" />
            {view.costExcludesUntracked === null
              ? "Requests outside metering are not counted here, so cost may exclude them."
              : view.costExcludesUntracked
                ? "Cost excludes untracked requests."
                : "Every request in this period was metered."}
          </p>
        </>
      )}
    </Frame>
  );
}

function UsageTableBlock() {
  const { view } = useLiveUsage();
  const message =
    view.state === "forbidden"
      ? "You cannot view usage for this scope."
      : view.state === "unavailable"
        ? "Usage is unavailable right now."
        : null;
  return (
    <Frame name="usage-table">
      <div className="blk-head">
        <p className="blk-title">Usage detail</p>
        <p className="blk-head-meta">{periodText}</p>
      </div>
      {message ? (
        <Message>{message}</Message>
      ) : (
        <ScrollTable label="Usage detail by provider">
          <table className="blk-table">
            <caption className="sr-only">Usage by provider, {periodText}</caption>
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Funding</th>
                <th scope="col" className="is-num">
                  Requests
                </th>
                <th scope="col" className="is-num">
                  Tokens
                </th>
                <th scope="col" className="is-num">
                  Cost
                </th>
                <th scope="col">Certainty</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.length ? (
                view.rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{providerLabel(row.dimensions.provider ?? "")}</th>
                    <td>{fundingLabel[row.fundingSource]}</td>
                    <td className="is-num">
                      <Tick value={keyOf(row.units.requests)}>
                        <FigureValue figure={row.units.requests} />
                      </Tick>
                    </td>
                    <td className="is-num">
                      <Tick value={keyOf(row.units.tokens)}>
                        <FigureValue figure={row.units.tokens} />
                      </Tick>
                    </td>
                    <td className="is-num">
                      <Tick value={keyOf(row.cost)}>
                        <FigureValue figure={row.cost} />
                      </Tick>
                    </td>
                    <td>
                      <Certainty value={row.certainty} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="blk-table-empty">
                    No usage in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollTable>
      )}
      {view.asOf ? (
        <p className="blk-foot">
          As of <time dateTime={view.asOf}>{utcTime(view.asOf)} UTC</time> on the sample clock.
        </p>
      ) : null}
    </Frame>
  );
}

/** The registry block's labels and age format, so the preview reads like the component you copy. */
const kindLabel: Record<ExceptionKind, string> = {
  reservation_expired: "Reservation expired",
  lease_expired: "Lease expired",
  pending: "Pending evidence",
};
function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86_400)} d`;
}

function ExceptionsBlock() {
  const { view } = useLiveExceptions();
  return (
    <Frame name="exceptions-list">
      <div className="blk-head">
        <p className="blk-title">Needs attention</p>
        <p className="blk-head-meta">{periodText}</p>
      </div>
      {view.state === "forbidden" || view.state === "unavailable" ? (
        <Message>
          {view.state === "forbidden"
            ? "You cannot view operations for this scope."
            : "Exceptions are unavailable right now."}
        </Message>
      ) : (
        <ScrollTable label="Operations that need attention">
          <table className="blk-table">
            <caption className="sr-only">Operations that need attention, {periodText}</caption>
            <thead>
              <tr>
                <th scope="col">Operation</th>
                <th scope="col">Provider</th>
                <th scope="col">Principal</th>
                <th scope="col">Exception</th>
                <th scope="col">State</th>
                <th scope="col" className="is-num">
                  Age
                </th>
              </tr>
            </thead>
            <tbody>
              {view.rows.length ? (
                view.rows.map((row) => (
                  <tr key={row.operationId} className="blk-exc-row" data-kind={row.kind}>
                    <th scope="row" className="blk-op">
                      {row.operationId}
                    </th>
                    <td>{`${row.provider} ${row.operation}`}</td>
                    <td>{row.principal}</td>
                    <td>
                      <span className={`badge blk-kind is-${row.kind}`}>
                        <span className="badge-dot" aria-hidden="true" />
                        {kindLabel[row.kind]}
                      </span>
                    </td>
                    <td className="is-muted">{row.state}</td>
                    <td className="is-num">{formatAge(row.ageSeconds)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="blk-table-empty">
                    No exceptions in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollTable>
      )}
    </Frame>
  );
}

/** One sentence about a request this toolbar sent, for assistive technology. */
/**
 * Sample commands for the shared Meter. They sit outside the frames, so each preview stays the
 * block you install. No other part of this page announces them, so the toolbar does.
 */
function LiveControls() {
  const live = useLive();
  const announcer = useAnnouncer(live);
  const blocked = live.events[0]?.status === "blocked";
  const pending = live.events.filter((event) => event.status === "pending");
  // Events are newest first, so evidence settles the operation that has waited longest.
  const oldest = pending.at(-1);
  const [settling, setSettling] = useState<string | null>(null);
  const busy = settling !== null && settling === oldest?.id && !live.problem;
  const closed = !live.ready || live.inFlight >= maxInFlight;
  const sendRef = useRef<HTMLButtonElement>(null);
  const settleRef = useRef<HTMLButtonElement>(null);
  /** Set when a focused button that may disappear is pressed; if it does, focus moves to Send. */
  const handoff = useRef(false);
  useEffect(() => {
    if (!handoff.current) return;
    const active = document.activeElement;
    if (busy && active !== null && active === settleRef.current) return;
    handoff.current = false;
    if (!active || active === document.body) sendRef.current?.focus();
  });
  const [tone, text] = live.problem
    ? ["danger", live.problem]
    : live.inFlight
      ? ["accent", `${live.inFlight} ${live.inFlight === 1 ? "request" : "requests"} in flight`]
      : blocked
        ? ["danger", "Blocked before dispatch."]
        : pending.length
          ? [
              "accent",
              `${pending.length} ${pending.length === 1 ? "operation awaits" : "operations await"} evidence`,
            ]
          : ["idle", "In-memory sample data"];
  // Status and its follow-up come first; Send and Simulate stay put when either changes.
  return (
    <div className="blk-controls">
      {/* The visible status also follows requests sent elsewhere, so it stays silent. */}
      <p className="blk-status" data-tone={tone}>
        <span>
          {tone === "idle" ? null : <span className="blk-status-dot" aria-hidden="true" />}
          {text}
        </span>
      </p>
      <p className="sr-only" aria-live="polite">
        {announcer.said.text ? <span key={announcer.said.count}>{announcer.said.text}</span> : null}
      </p>
      <div className="blk-commands">
        {oldest ? (
          <Button
            ref={settleRef}
            className="btn btn-outline btn-sm"
            disabled={!live.ready || busy}
            focusableWhenDisabled
            onClick={(event) => {
              handoff.current = event.currentTarget === document.activeElement;
              setSettling(oldest.id);
              announcer.adopt(oldest.id);
              live.settleEvidence(oldest.id);
            }}
          >
            Settle from evidence
          </Button>
        ) : null}
        {blocked ? (
          <Button
            className="btn btn-ghost btn-sm"
            onClick={(event) => {
              handoff.current = event.currentTarget === document.activeElement;
              live.reset();
              announcer.say("Sample reset to its starting monthly spend.");
            }}
          >
            <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
            Reset the sample
          </Button>
        ) : null}
        <div className="blk-actions">
          <Button
            ref={sendRef}
            className="btn btn-outline btn-sm"
            onClick={() => {
              announcer.claim();
              live.send();
            }}
            disabled={closed}
            focusableWhenDisabled
          >
            <Send size={14} strokeWidth={1.75} aria-hidden="true" />
            Send a request
          </Button>
          <Button
            className="btn btn-outline btn-sm"
            onClick={() => {
              announcer.claim();
              live.timeout();
            }}
            disabled={closed}
            focusableWhenDisabled
          >
            <TimerOff size={14} strokeWidth={1.75} aria-hidden="true" />
            Simulate a timeout
          </Button>
        </div>
      </div>
    </div>
  );
}

const installSample = `# Your usagekit checkout, after npm run registry:build
R=/absolute/path/to/usagekit/packages/registry/dist

# Radix / New York
npx shadcn add $R/r/radix/budget-card.json

# Base UI
npx shadcn add $R/r/base/budget-card.json`;

const pageSample = `"use client";

import { MeterProvider } from "@usagekit/react";
import { HeaderStatusPanel } from "@/components/usagekit/header-status";
import { UsageSummaryCardsPanel } from "@/components/usagekit/usage-summary-cards";
import { BudgetCardsPanel } from "@/components/usagekit/budget-card";
import { CostSummaryCardPanel } from "@/components/usagekit/cost-summary-card";
import { CoverageSummaryPanel } from "@/components/usagekit/coverage-summary";
import { UsageTablePanel } from "@/components/usagekit/usage-table";
import { ExceptionsListPanel } from "@/components/usagekit/exceptions-list";
// Your Meter and the signed-in viewer's AccessContext.
import { access, meter } from "@/lib/usagekit";

const workspace = { namespace: "acme", principal: "workspace-42" };
const owner = { kind: "principal", ...workspace } as const;
const range = { from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" };
const bounds = {
  scope: { ...workspace, connection: "language-key" },
  surface: "app",
  units: ["cents"],
} as const;
const query = { scope: owner, ...range, units: ["requests", "tokens", "cents"] };

export function UsagePage() {
  return (
    <MeterProvider meter={meter} access={access}>
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Usage</h1>
        <HeaderStatusPanel {...bounds} />
      </header>
      <UsageSummaryCardsPanel
        {...query}
        units={["requests", "cents"]}
        unitLabels={{ requests: "Requests", cents: "Provider cost" }}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <BudgetCardsPanel {...bounds} />
        <CostSummaryCardPanel {...query} />
        <CoverageSummaryPanel scope={owner} {...range} />
      </div>
      <UsageTablePanel {...query} groupBy={["provider"]} />
      <ExceptionsListPanel scope={owner} {...range} />
    </MeterProvider>
  );
}`;

function CodeView() {
  return (
    <div className="blk-code">
      <div className="blk-code-aside">
        <Code title="Terminal" lang="shell" className="blk-codeblock">
          {installSample}
        </Code>
        <p className="blk-code-note">
          The registry builds locally from the checkout with <code>npm run registry:build</code>;
          copied blocks use your <code>@/components/ui</code> primitives and tokens.
        </p>
      </div>
      <Code title="app/usage/page.tsx" lang="tsx" className="blk-codeblock">
        {pageSample}
      </Code>
    </div>
  );
}

type View = "preview" | "code";

export function BlocksSection() {
  const [view, setView] = useState<View>("preview");
  return (
    <section id="components" className="section blk" aria-labelledby="components-title">
      <div className="container">
        <SectionHeading id="components-title" title="Try them live.">
          These previews read an in-memory Meter in your browser. Send a request or simulate a
          timeout, and every number moves.
        </SectionHeading>
        <Tabs.Root
          className="blk-tabs"
          value={view}
          onValueChange={(next: unknown) => {
            if (next === "preview" || next === "code") setView(next);
          }}
        >
          <div className="blk-toolbar">
            <Tabs.List className="blk-tablist" aria-label="Blocks">
              <Tabs.Tab value="preview" className="blk-tab">
                Preview
              </Tabs.Tab>
              <Tabs.Tab value="code" className="blk-tab">
                Code
              </Tabs.Tab>
            </Tabs.List>
            {view === "preview" ? <LiveControls /> : null}
          </div>
          <Tabs.Panel value="preview" className="blk-panel" keepMounted>
            <div className="blk-grid">
              <HeaderStatusBlock />
              <UsageSummaryBlock />
              <BudgetCardBlock />
              <CostSummaryBlock />
              <CoverageBlock />
              <UsageTableBlock />
              <ExceptionsBlock />
            </div>
          </Tabs.Panel>
          <Tabs.Panel value="code" className="blk-panel">
            <CodeView />
          </Tabs.Panel>
        </Tabs.Root>
        <p className="blk-more">
          Together they make a shadcn dashboard for usage and costs. See all {registryBlocks.length}{" "}
          blocks in the{" "}
          <a className="link" href="/docs/#components">
            component index
          </a>
          .
        </p>
      </div>
    </section>
  );
}
