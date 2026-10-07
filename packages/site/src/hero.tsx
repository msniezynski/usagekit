import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { Button } from "@base-ui/react/button";
import { RotateCcw } from "lucide-react";
import { formatMoney } from "@usagekit/core";
import type { AlertAt, BudgetRow, Level } from "@usagekit/views";
import { CopyButton } from "./code.js";
import {
  dollarParts,
  figureText,
  fineDigits,
  isKnown,
  providerLabel,
  usd,
  usdExact,
  utcTime,
} from "./format.js";
import { maxInFlight, useLive, useLiveBudgets, useLiveHeader } from "./live.js";
import type { Live } from "./live.js";
import { fixturePeriod, providers, requestEstimate } from "./meter-fixture.js";
import type { SiteEvent } from "./meter-fixture.js";
import { FigureValue, LevelBadge, MeterBar, Money } from "./ui.js";

const installCommand = "npm i @usagekit/meter";
/** "$1.50": what every sample request reserves before it may dispatch. */
const estimate = usdExact(formatMoney({ units: requestEstimate, currency: "USD" }));
/** "October 2026": the sample's calendar month, fixed in UTC so prerender and client agree. */
const periodText = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
}).format(new Date(fixturePeriod.from));

const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
/** Effects only: motion answers a visitor's action, and stays still when they ask for less. */
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const canAnimate = (node: HTMLElement) =>
  typeof node.animate === "function" && !prefersReducedMotion();

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="container">
        <div className="hero-intro">
          <h1 id="hero-title" className="hero-title">
            Meter every paid call.
          </h1>
          <div className="hero-aside">
            <p className="hero-lede">
              Usagekit reserves budget before every paid API call and settles the exact cost from
              its receipt. Build it into your product, or put it in front of your agents.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="/docs/#getting-started">
                Get started
              </a>
              <a className="btn btn-outline" href="/agents/">
                Spend limits for agents
              </a>
              <div className="hero-command">
                <code className="hero-command-text">
                  <span className="hero-command-verb">npm i</span> @usagekit/meter
                </code>
                <CopyButton text={installCommand} label="install command" />
              </div>
            </div>
          </div>
        </div>
        <Instrument />
      </div>
    </section>
  );
}

/** The live instrument: one real in-memory Meter, driven by the visitor. */
function Instrument() {
  const live = useLive();
  const { view: budgets } = useLiveBudgets();
  const { view: header } = useLiveHeader();
  const [resets, setResets] = useState(0);
  const row = budgets.rows[0];
  const latest = live.events[0];
  const reset = () => {
    setResets((count) => count + 1);
    live.reset();
  };
  return (
    <section className="hero-instrument" aria-labelledby="hero-meter-title">
      <div className="hero-meter-head">
        <div className="hero-meter-name">
          <h2 id="hero-meter-title" className="hero-meter-title">
            Monthly spend
          </h2>
          <span className="hero-meter-period">Sample workspace, {periodText}</span>
        </div>
        <span className="hero-meter-status" aria-live="polite">
          <LevelBadge level={header.level}>
            {levelText(header.level, header.bounds[0]?.warningAt ?? null)}
          </LevelBadge>
        </span>
      </div>
      <div className="hero-gauge" data-flight={live.inFlight > 0}>
        {row ? (
          <>
            <Reading row={row} />
            <Legend row={row} />
            <Scale row={row} refused={latest?.status === "blocked" ? latest : null} />
          </>
        ) : (
          <p className="hero-missing">The sample budget is not available.</p>
        )}
        <Controls live={live} onReset={reset} />
      </div>
      <OperationLog live={live} resets={resets} />
    </section>
  );
}

function levelText(level: Level, warningAt: AlertAt | null): string {
  if (level === "ok") return "Within budget";
  if (level === "exceeded") return "At limit";
  return warningAt && "percent" in warningAt
    ? `Alert at ${warningAt.percent}% crossed`
    : "Alert crossed";
}

function Reading({ row }: { row: BudgetRow }) {
  const limit = typeof row.limit === "object" ? row.limit.text : null;
  return (
    <>
      <div className="hero-reading">
        <p className="hero-amount">
          <span className="sr-only">Used </span>
          {isKnown(row.used) ? (
            <Odometer cents={row.used.text} />
          ) : (
            <span className="figure-missing">{figureText(row.used)}</span>
          )}
        </p>
        <p className="hero-of">
          {limit ? (
            <span className="hero-of-limit">
              of <Money cents={limit} />
            </span>
          ) : null}
          {row.bar ? <span className="hero-of-share">{row.bar.used}% used</span> : null}
        </p>
      </div>
      <p className="hero-precision">Exact to a ten-thousandth of a cent.</p>
    </>
  );
}

/** Reels roll for this long; slots that appear or fold away keep the same pace. */
const rollMs = 760;
const rollEasing = "cubic-bezier(0.22, 1, 0.36, 1)";
/** A strip is one line tall and its ten faces overflow it, so a face is one strip height. */
const faceAt = (digit: number) => `translateY(${digit * -100}%)`;

/**
 * The exact amount as rolling digits, read like <Money>: "$18.00" in ink, then the significant
 * digits past the cent in a lighter color at the same size and baseline, trailing zeros trimmed.
 * A place that becomes a trailing zero keeps its slot while it rolls to 0 and folds away.
 */
function Odometer({ cents }: { cents: string }) {
  const { negative, dollars, cents: whole, subcents } = dollarParts(cents);
  const fine = fineDigits(subcents).length;
  const [kept, setKept] = useState(fine);
  useEffect(() => {
    if (fine >= kept) {
      if (fine > kept) setKept(fine);
      return;
    }
    const timer = setTimeout(() => setKept(fine), prefersReducedMotion() ? 0 : rollMs);
    return () => clearTimeout(timer);
  }, [fine, kept]);
  // False through the first render and its effects, so prerendered digits never animate in.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const slots = Math.max(fine, kept);
  return (
    <>
      <span className="hero-odometer" aria-hidden="true">
        {negative ? "−" : null}$
        <Reels text={dollars} last={subcents.length + whole.length} mounted={mounted} />
        <span className="hero-odo-point">.</span>
        <Reels text={whole} last={subcents.length} mounted={mounted} />
        {slots ? (
          <span className="hero-odo-fine">
            {[...subcents.slice(0, slots)].map((digit, index) => (
              <Reel
                key={index}
                digit={digit}
                place={subcents.length - 1 - index}
                mounted={mounted}
                leaving={index >= fine}
              />
            ))}
          </span>
        ) : null}
      </span>
      <span className="sr-only">{usdExact(cents)}</span>
    </>
  );
}

/** Reels for dollars or cents; `last` is the place of the final character (4th past cent: 0). */
function Reels({
  text,
  last,
  mounted,
}: {
  text: string;
  last: number;
  mounted: RefObject<boolean>;
}) {
  const chars = [...text];
  return (
    <>
      {chars.map((char, index) => {
        const place = last + chars.length - 1 - index;
        return /^\d$/.test(char) ? (
          <Reel key={place} digit={char} place={place} mounted={mounted} />
        ) : (
          <span key={`mark-${place}`} className="hero-odo-mark">
            {char}
          </span>
        );
      })}
    </>
  );
}

/**
 * One digit: a reel of 0 to 9 in a fixed slot as wide as the widest digit, translated to its
 * value. The faces are generated content, so the page text keeps only the exact amount. A slot
 * that appears after the first render opens and rolls in from 0, which is what its trimmed digit
 * was; a leaving slot rolls to 0 and folds, so the reading never jumps in width.
 */
function Reel({
  digit,
  place,
  mounted,
  leaving = false,
}: {
  digit: string;
  place: number;
  mounted: RefObject<boolean>;
  leaving?: boolean;
}) {
  const slot = useRef<HTMLSpanElement>(null);
  const strip = useRef<HTMLSpanElement>(null);
  const face = Number(digit);
  useClientLayoutEffect(() => {
    const node = slot.current;
    if (!mounted.current || !node || !strip.current || !canAnimate(node)) return;
    const timing = { duration: rollMs, easing: rollEasing };
    const width = `${node.getBoundingClientRect().width}px`;
    const opening = node.animate(
      [
        { width: "0px", opacity: 0 },
        { width, opacity: 1 },
      ],
      timing,
    );
    const rolling = strip.current.animate([{ transform: faceAt(0) }, { transform: faceAt(face) }], {
      ...timing,
      delay: place * 22,
      fill: "backwards",
    });
    return () => {
      opening.cancel();
      rolling.cancel();
    };
  }, []);
  useClientLayoutEffect(() => {
    const node = slot.current;
    if (!leaving || !node || !canAnimate(node)) return;
    const width = `${node.getBoundingClientRect().width}px`;
    const folding = node.animate(
      [
        { width, opacity: 1 },
        { width: "0px", opacity: 0 },
      ],
      {
        duration: rollMs,
        easing: rollEasing,
        fill: "forwards",
      },
    );
    return () => folding.cancel();
  }, [leaving]);
  return (
    <span ref={slot} className="hero-reel" style={{ "--hero-place": place } as CSSProperties}>
      <span className="hero-reel-window">
        <span ref={strip} className="hero-reel-strip" style={{ transform: faceAt(face) }} />
      </span>
    </span>
  );
}

function Legend({ row }: { row: BudgetRow }) {
  return (
    <dl className="hero-legend">
      <div className="hero-legend-item">
        <dt>
          <span className="hero-swatch is-used" aria-hidden="true" />
          Used
        </dt>
        <dd>
          <FigureValue figure={row.used} />
        </dd>
      </div>
      <div className="hero-legend-item">
        <dt>
          <span className="hero-swatch is-reserved" aria-hidden="true" />
          Reserved
        </dt>
        <dd>
          <FigureValue figure={row.reserved} />
        </dd>
      </div>
      <div className="hero-legend-item">
        <dt>
          <span className="hero-swatch is-headroom" aria-hidden="true" />
          Remaining
        </dt>
        <dd>
          {row.remaining === "unlimited" ? "Unlimited" : <FigureValue figure={row.remaining} />}
        </dd>
      </div>
    </dl>
  );
}

const ticks = Array.from({ length: 21 }, (_, index) => index * 5);
const quarters = [0n, 1n, 2n, 3n, 4n] as const;
const at = (percent: string): CSSProperties => ({ "--hero-at": `${percent}%` }) as CSSProperties;

/** A non-negative cents text as an exact integer of its four fractional digits. */
function scaledCents(centsText: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(centsText);
  return match ? BigInt(`${match[1] ?? "0"}${(match[2] ?? "").padEnd(4, "0")}`) : null;
}
/** Exact cents text for part/whole of an amount, truncated to four fractional digits. */
function shareOf(centsText: string, part: bigint, whole: bigint): string {
  const units = (((scaledCents(centsText) ?? 0n) * part) / whole).toString().padStart(5, "0");
  return `${units.slice(0, -4)}.${units.slice(-4)}`;
}
/** Percent of the limit that an amount takes, truncated to two decimals. Layout only. */
function percentOfLimit(centsText: string, limitText: string): string | null {
  const amount = scaledCents(centsText);
  const limit = scaledCents(limitText);
  if (amount === null || !limit) return null;
  const hundredths = ((amount * 10_000n) / limit).toString().padStart(3, "0");
  return `${hundredths.slice(0, -2)}.${hundredths.slice(-2)}`;
}

function Scale({ row, refused }: { row: BudgetRow; refused: SiteEvent | null }) {
  const bar = row.bar;
  const limit = typeof row.limit === "object" ? row.limit.text : null;
  const remaining = row.remaining === "unlimited" ? "Unlimited" : figureText(row.remaining);
  const valueText = `${figureText(row.used)} used, ${figureText(row.reserved)} reserved, ${remaining} remaining${limit ? ` of ${usdExact(limit)}` : ""}`;
  // A blocked request shows where its reservation would have gone: past the limit.
  const refusedSize =
    refused && bar?.limit === "100" && limit ? percentOfLimit(refused.estimate, limit) : null;
  return (
    <div className="hero-scale">
      <div className="hero-marks" aria-hidden="true">
        {row.alerts.map((alert, index) => {
          const position = bar?.alerts[index];
          return position ? (
            <span
              key={alert.key}
              className="hero-mark"
              data-crossed={alert.crossed}
              style={at(position)}
            >
              Alert {"percent" in alert.at ? `${alert.at.percent}%` : usdExact(alert.at.text)}
            </span>
          ) : null;
        })}
        {bar ? (
          <span className="hero-mark is-limit" style={at(bar.limit)}>
            Limit
          </span>
        ) : null}
      </div>
      <div className="hero-track">
        <MeterBar
          bar={bar}
          label="Monthly spend"
          valueText={valueText}
          size="lg"
          className="hero-bar"
        />
        {refused && bar && refusedSize ? (
          <span
            key={refused.id}
            className="hero-refused"
            aria-hidden="true"
            style={{ left: `calc(${bar.used}% + ${bar.reserved}%)`, width: `${refusedSize}%` }}
          />
        ) : null}
      </div>
      <div className="hero-ruler" aria-hidden="true">
        <svg className="hero-ticks" width="100%" height="10" focusable="false">
          {ticks.map((tick) => (
            <rect
              key={tick}
              className={tick % 25 ? "hero-tick" : "hero-tick is-major"}
              x={`${tick}%`}
              y="0"
              width="1"
              height={tick % 25 ? 5 : 10}
              {...(tick === 100 ? { transform: "translate(-1 0)" } : {})}
            />
          ))}
          {row.alerts.map((alert, index) => {
            const position = bar?.alerts[index];
            return position ? (
              <rect
                key={alert.key}
                className="hero-tick is-alert"
                data-crossed={alert.crossed}
                x={`${position}%`}
                y="0"
                width="1"
                height="10"
              />
            ) : null;
          })}
        </svg>
        {limit && bar?.limit === "100"
          ? quarters.map((quarter) => (
              <span
                key={String(quarter)}
                className="hero-ruler-label"
                style={at(String(quarter * 25n))}
              >
                {usd(shareOf(limit, quarter, 4n))}
              </span>
            ))
          : null}
      </div>
    </div>
  );
}

function Controls({ live, onReset }: { live: Live; onReset: () => void }) {
  const full = live.inFlight >= maxInFlight;
  const closed = !live.ready || full;
  const pristine = live.events.length === 0 && !live.problem;
  return (
    <div className="hero-controls">
      <div className="hero-buttons">
        <Button
          className="btn btn-primary"
          disabled={closed}
          focusableWhenDisabled
          onClick={() => live.send()}
        >
          Send a request
        </Button>
        <Button
          className="btn btn-outline"
          disabled={closed}
          focusableWhenDisabled
          onClick={() => live.timeout()}
        >
          Simulate a timeout
        </Button>
        <Button
          className="btn btn-ghost btn-icon hero-reset"
          disabled={live.inFlight > 0 || pristine}
          focusableWhenDisabled
          onClick={onReset}
          aria-label="Reset sample"
          title="Reset sample"
        >
          <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </div>
      {/* Always rendered so the count never moves the log; hidden while nothing is in flight. */}
      <p className="hero-flight" data-idle={live.inFlight === 0}>
        <span className="hero-chip is-hatch is-moving" aria-hidden="true" />
        {live.inFlight} of {maxInFlight} in flight
      </p>
      {live.problem ? (
        <p className="hero-problem" role="alert">
          {live.problem}
        </p>
      ) : null}
    </div>
  );
}

const fundingLabel = (event: SiteEvent) =>
  providers[event.provider].fundingSource === "platform" ? "Platform funded" : "Own key";
const exact = (cents: string | null) => (cents === null ? "an unknown amount" : usdExact(cents));

/** One sentence for assistive technology about the newest event. */
function summary(event: SiteEvent): string {
  switch (event.status) {
    case "reserved":
      return `${event.id} reserved ${usdExact(event.estimate)} and awaits its receipt.`;
    case "settled":
      return `${event.id} settled at ${exact(event.actual)} from its receipt.`;
    case "pending":
      return `${event.id} has an unknown outcome. ${usdExact(event.estimate)} stays reserved.`;
    case "evidence":
      return `${event.id} settled from late evidence at ${exact(event.actual)}.`;
    case "blocked":
      return `${event.id} was blocked before dispatch. No provider call was made.`;
  }
}

function OperationLog({ live, resets }: { live: Live; resets: number }) {
  const { events, problem } = live;
  const [settling, setSettling] = useState<ReadonlySet<string>>(() => new Set());
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    setSettling((current) => {
      const pending = new Set(events.flatMap((e) => (e.status === "pending" ? [e.id] : [])));
      const next = new Set([...current].filter((id) => pending.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [events]);
  useEffect(() => {
    if (problem) setSettling(new Set());
  }, [problem]);
  const settle = (id: string) => {
    refocus.current = id;
    setSettling((current) => new Set(current).add(id));
    live.settleEvidence(id);
  };
  const latest = events[0];
  return (
    <div className="hero-log">
      <div className="hero-log-head">
        <h3 className="hero-log-title">Operation log</h3>
        {events.length > 1 ? <span className="hero-log-meta">Newest first</span> : null}
      </div>
      {events.length ? (
        <ol className="hero-log-list">
          {events.map((event) => (
            <LogRow
              key={event.id}
              event={event}
              settling={settling.has(event.id) || !live.ready}
              onSettle={settle}
              refocus={refocus}
            />
          ))}
        </ol>
      ) : (
        <p className="hero-log-empty">
          No requests yet. Send one to watch {estimate} reserved, then settled from its receipt.
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {latest ? summary(latest) : resets ? "Sample reset to its starting monthly spend." : ""}
      </p>
    </div>
  );
}

const enter = { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" } as const;

/** A short entrance for content a visitor's action just created; never on prerendered HTML. */
function useEntrance(ref: RefObject<HTMLElement | null>, keyframes: Keyframe[], enabled = true) {
  const once = useRef(enabled);
  useClientLayoutEffect(() => {
    const node = ref.current;
    if (!once.current || !node || !canAnimate(node)) return;
    const animation = node.animate(keyframes, enter);
    return () => animation.cancel();
  }, []);
}
const rowIn: Keyframe[] = [
  { opacity: 0, transform: "translateY(-6px)" },
  { opacity: 1, transform: "none" },
];
const outcomeIn: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];

function LogRow({
  event,
  settling,
  onSettle,
  refocus,
}: {
  event: SiteEvent;
  settling: boolean;
  onSettle: (id: string) => void;
  refocus: RefObject<string | null>;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const first = useRef(event.status);
  useEntrance(ref, rowIn);
  useEffect(() => {
    if (event.status !== "evidence" || refocus.current !== event.id) return;
    refocus.current = null;
    if (!document.activeElement || document.activeElement === document.body)
      ref.current?.focus({ preventScroll: true });
  }, [event.status, event.id, refocus]);
  return (
    <li ref={ref} className="hero-log-row" data-status={event.status} tabIndex={-1}>
      <time className="hero-log-time" dateTime={event.at}>
        {utcTime(event.at)}
      </time>
      <span className="hero-log-op" id={`hero-op-${event.id}`}>
        {event.id}
      </span>
      <span className="hero-log-provider">{providerLabel(event.provider)}</span>
      <span className="hero-log-funding">{fundingLabel(event)}</span>
      <Outcome
        key={event.status}
        event={event}
        animate={event.status !== first.current}
        settling={settling}
        onSettle={onSettle}
      />
    </li>
  );
}

function Outcome({
  event,
  animate,
  settling,
  onSettle,
}: {
  event: SiteEvent;
  animate: boolean;
  settling: boolean;
  onSettle: (id: string) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEntrance(ref, outcomeIn, animate);
  const chip = (kind: string) => <span className={`hero-chip ${kind}`} aria-hidden="true" />;
  const amount = (cents: string | null) =>
    cents === null ? <span className="figure-missing">Unknown</span> : <Money cents={cents} />;
  let body: ReactNode;
  switch (event.status) {
    case "reserved":
      body = (
        <>
          <span className="hero-outcome-label">
            {chip("is-hatch is-moving")}
            <span>
              Reserved <Money cents={event.estimate} />
            </span>
          </span>
          <span className="hero-outcome-note">awaiting receipt</span>
        </>
      );
      break;
    case "settled":
      body = (
        <>
          <span className="hero-outcome-label">
            {chip("is-ink")}
            <span>Settled {amount(event.actual)}</span>
          </span>
          <span className="hero-outcome-note">
            estimate <Money cents={event.estimate} />
          </span>
        </>
      );
      break;
    case "pending":
      body = (
        <>
          <span className="hero-outcome-label is-warn">
            {chip("is-hatch")}
            Unknown outcome
          </span>
          <span className="hero-outcome-note">
            <Money cents={event.estimate} /> stays reserved
          </span>
          <Button
            className="btn btn-outline btn-sm hero-settle"
            disabled={settling}
            focusableWhenDisabled
            onClick={() => onSettle(event.id)}
            aria-describedby={`hero-op-${event.id}`}
          >
            Settle from evidence
          </Button>
        </>
      );
      break;
    case "evidence":
      body = (
        <span className="hero-outcome-label">
          {chip("is-ink")}
          <span>Settled from late evidence {amount(event.actual)}</span>
        </span>
      );
      break;
    case "blocked":
      body = (
        <>
          <span className="hero-outcome-label is-danger">
            {chip("is-blocked")}
            Blocked before dispatch
          </span>
          <span className="hero-outcome-note">No provider call was made</span>
        </>
      );
      break;
  }
  return (
    <span ref={ref} className="hero-outcome">
      {body}
    </span>
  );
}
