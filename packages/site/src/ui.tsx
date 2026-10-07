import type { ReactNode } from "react";
import type { Certainty as CertaintyValue } from "@usagekit/core";
import type { BudgetBar, Figure } from "@usagekit/views";
import { certaintyLabel, dollarParts, figureText, fineDigits } from "./format.js";

/**
 * The exact amount as ordinary decimal text, "$18.0002". Digits past the cent are set lighter,
 * so "$18.00" reads first and the precision stays visible. Trailing zeros are trimmed.
 */
export function Money({ cents, className }: { cents: string; className?: string }) {
  const { negative, dollars, cents: whole, subcents } = dollarParts(cents);
  const fine = fineDigits(subcents);
  return (
    <span className={className ? `money ${className}` : "money"}>
      {negative ? "−" : ""}${dollars}.{whole}
      {fine ? <span className="money-fine">{fine}</span> : null}
    </span>
  );
}

/** Exact figure text; money keeps its sub-cent digits, unknown and unavailable keep their names. */
export function FigureValue({
  figure,
  className,
}: {
  figure: Figure | undefined;
  className?: string;
}) {
  if (
    figure &&
    figure !== "unavailable" &&
    figure.certainty !== "unknown" &&
    figure.unit === "cents"
  )
    return <Money cents={figure.text} {...(className ? { className } : {})} />;
  const text = figureText(figure);
  const missing = text === "Unknown" || text === "Unavailable";
  return (
    <span
      className={[missing ? "figure-missing" : "", className ?? ""].join(" ").trim() || undefined}
    >
      {text}
    </span>
  );
}

/** Certainty is shape and words, not color: solid measured, half estimated, open unknown. */
export function Certainty({ value }: { value: CertaintyValue | "unavailable" }) {
  return (
    <span className={`certainty is-${value}`}>
      <span className="certainty-mark" aria-hidden="true" />
      {value === "unavailable" ? "Unavailable" : certaintyLabel[value]}
    </span>
  );
}

export type Level = "ok" | "warning" | "exceeded";
/** The registry budget-card labels, so previews and installed blocks say the same thing. */
const levelLabel: Record<Level, string> = {
  ok: "Within budget",
  warning: "Warning",
  exceeded: "Exceeded",
};
export function LevelBadge({ level, children }: { level: Level; children?: ReactNode }) {
  return (
    <span className={`badge level is-${level}`}>
      <span className="badge-dot" aria-hidden="true" />
      {children ?? levelLabel[level]}
    </span>
  );
}

export function SectionHeading({
  id,
  title,
  children,
}: {
  id?: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <h2 className="section-title" {...(id ? { id } : {})}>
        {title}
      </h2>
      {children ? <p className="section-lede">{children}</p> : null}
    </div>
  );
}

export function Brand() {
  return (
    <a className="brand" href="/" aria-label="Usagekit home">
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M5 6v12a11 11 0 0 0 22 0V6M12 6v12a4 4 0 0 0 8 0V6"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        />
      </svg>
      <span>
        usagekit<span className="brand-dot">.</span>
      </span>
    </a>
  );
}

/**
 * Budget geometry from the view model: used is solid ink, reserved is accent hatching, alert
 * thresholds are ticks. Percent texts come from BudgetBar and are only used for layout.
 */
export function MeterBar({
  bar,
  label,
  valueText,
  size = "md",
  className,
}: {
  bar: BudgetBar | null;
  label: string;
  valueText: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const used = bar?.used ?? "0";
  const reserved = bar?.reserved ?? "0";
  return (
    <div
      className={`meter-bar is-${size}${className ? ` ${className}` : ""}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Number(used)}
      aria-valuetext={valueText}
    >
      <span className="meter-used" style={{ width: `${used}%` }} />
      <span
        className="meter-reserved"
        data-active={reserved !== "0"}
        style={{ left: `${used}%`, width: `${reserved}%` }}
      />
      {bar?.alerts.map((at) => (
        <span key={at} className="meter-alert" style={{ left: `${at}%` }} />
      ))}
      {bar?.hardLimit ? <span className="meter-limit" style={{ left: `${bar.limit}%` }} /> : null}
    </div>
  );
}

/** Bisibility's mark, from its brand geometry: the small cut keeps the counter open at 18px and below. */
export function BisibilityMark({ size = 18, className }: { size?: number; className?: string }) {
  const path =
    size <= 18
      ? "M16 0H80A16 16 0 0 1 96 16V80A16 16 0 0 1 80 96H16A16 16 0 0 1 0 80V16A16 16 0 0 1 16 0Z M76 48a28 28 0 1 0-56 0a28 28 0 1 0 56 0"
      : "M22 0H74A22 22 0 0 1 96 22V74A22 22 0 0 1 74 96H22A22 22 0 0 1 0 74V22A22 22 0 0 1 22 0Z M75 48a27 27 0 1 0-54 0a27 27 0 1 0 54 0";
  return (
    <svg
      className={className ? `bisibility-mark ${className}` : "bisibility-mark"}
      width={size}
      height={size}
      viewBox="0 0 96 96"
      aria-hidden="true"
    >
      <path d={path} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/** The lowercase bisibility lockup: mark and wordmark. The wordmark carries the name. */
export function BisibilityLockup({ size = "sm" }: { size?: "sm" | "md" }) {
  const scale = size === "md" ? { mark: 26, gap: 7, type: 20 } : { mark: 18, gap: 5, type: 14 };
  return (
    <span className="bisibility-lockup" style={{ columnGap: scale.gap }}>
      <BisibilityMark size={scale.mark} />
      <span className="bisibility-wordmark" style={{ fontSize: scale.type }}>
        bisibility
      </span>
    </span>
  );
}
