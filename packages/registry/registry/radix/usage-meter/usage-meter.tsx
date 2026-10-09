"use client";

import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { severerLevel, usageProgress } from "@/components/usagekit/usage-progress";
import type { UsageProgress } from "@/components/usagekit/usage-progress";

export type UsageLevel = "ok" | "warning" | "exceeded";
export type UsageMeterSize = "lg" | "md" | "sm";

/** Fill tone per budget level, shared by every meter. */
export const usageFill: Record<UsageLevel, string> = {
  ok: "bg-primary",
  warning: "bg-chart-4",
  exceeded: "bg-destructive",
};
const hatchTone: Record<UsageLevel, string> = {
  ok: "text-primary",
  warning: "text-chart-4",
  exceeded: "text-destructive",
};
// Track shape, colour and heights come from the host's shadcn style, like its progress bar.
const height: Record<UsageMeterSize, string> = {
  lg: "cn-usage-track-lg",
  md: "cn-usage-track-md",
  sm: "cn-usage-track-sm",
};
const tail: Record<UsageMeterSize, string> = { lg: "2.5rem", md: "1rem", sm: "0.5rem" };
const hatch = "bg-[repeating-linear-gradient(-45deg,currentColor_0_1px,transparent_1px_4px)]";
// Layers are full-width and translated, so their ends keep the track's shape and motion stays on
// the compositor.
const layer =
  "absolute inset-0 rounded-[inherit] transition-[translate,background-color] duration-700 ease-out delay-[var(--usage-delay)] starting:-translate-x-full motion-reduce:transition-none";

export type UsageTrackProps = Omit<ComponentProps<"span">, "children"> & {
  size?: UsageMeterSize;
  level: UsageLevel;
  /** Confirmed extent as CSS percent text, for example "28%" or "12.5%". */
  fill: string;
  /** Reserved extent continuing after the fill, as CSS percent text. */
  reserved?: string;
  /** Lower-bound reading: a hatched tail shows that the total may be higher. */
  partial?: boolean;
  /** The reading passed its limit; a notch past the end of the scale marks the overflow. */
  over?: boolean;
  /** Scale marks such as thresholds; drawn above the fill and never clipped. */
  marks?: ReactNode;
  /** Settle delay in milliseconds, used to stagger related meters. */
  delay?: number;
  /** A nonzero reading keeps a visible trace even when it rounds to an empty bar. */
  trace?: boolean;
};

/**
 * Meter geometry only. Callers own the semantics: role="meter" or decorative with nearby text.
 * The track is a block: it fills block containers, and flex rows give it an explicit width.
 */
export function UsageTrack({
  size = "md",
  level,
  fill,
  reserved,
  partial = false,
  over = false,
  marks,
  delay = 0,
  trace = false,
  className = "",
  style,
  ...props
}: UsageTrackProps) {
  return (
    <span
      {...props}
      data-usage-track={level}
      className={`relative block min-w-0 ${height[size]} ${className}`}
      style={
        {
          "--usage-fill": fill,
          "--usage-reserved": reserved ?? "0%",
          "--usage-tail": tail[size],
          "--usage-delay": `${delay}ms`,
          "--usage-min": trace ? "0.25rem" : "0px",
          ...style,
        } as CSSProperties
      }
    >
      <span className="cn-usage-track absolute inset-0 overflow-hidden">
        {reserved && (
          <span
            className={`${layer} ${usageFill[level]} opacity-35 translate-x-[calc(var(--usage-fill)_+_var(--usage-reserved)_-_100%)]`}
          />
        )}
        {partial && (
          <span
            className={`${layer} ${hatchTone[level]} ${hatch} opacity-80 [mask-image:linear-gradient(to_left,transparent,black_var(--usage-tail))] translate-x-[calc(max(var(--usage-fill),var(--usage-min))_+_var(--usage-tail)_-_100%)]`}
          />
        )}
        <span
          className={`${layer} ${usageFill[level]} translate-x-[calc(max(var(--usage-fill),var(--usage-min))_-_100%)]`}
        />
      </span>
      {over && (
        <span
          aria-hidden
          data-usage-over
          className="cn-usage-notch absolute -right-1 -top-[3px] h-[calc(100%+6px)] w-[3px] bg-destructive transition-[opacity,scale] delay-500 duration-300 ease-out starting:scale-y-0 starting:opacity-0 motion-reduce:transition-none"
        />
      )}
      {marks}
    </span>
  );
}

/**
 * A threshold on the scale, such as the 80 percent warning point or an alert. A ring in the
 * surface color cuts it into the fill, so a mark stays visible in a fill of its own tone.
 */
export function UsageMark({
  at,
  label,
  tone = "bg-foreground/40",
}: {
  /** Position as CSS percent text. */
  at: string;
  /** Accessible description; omit when the threshold is described in nearby text. */
  label?: string;
  tone?: string;
}) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`absolute -top-[3px] h-[calc(100%+6px)] w-px -translate-x-1/2 ring-1 ring-card ${tone}`}
      style={{ left: at }}
    />
  );
}

/** Track for a reading that is not known: hatched and empty, never a zero fill. */
export function UsageUnknownTrack({
  size = "md",
  className = "",
}: {
  size?: UsageMeterSize;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-usage-track="unknown"
      className={`cn-usage-track block min-w-0 overflow-hidden text-muted-foreground/30 ${hatch} ${height[size]} ${className}`}
    />
  );
}

/** Baseline for an uncapped reading: there is no scale to fill. */
export function UsageNoCapTrack({
  size = "md",
  className = "",
}: {
  size?: UsageMeterSize;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-usage-track="none"
      className={`relative block min-w-0 ${height[size]} ${className}`}
    >
      <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-muted-foreground/40" />
    </span>
  );
}

export type UsageMeterProps = {
  /** Host-observed percent of the limit; null means there is no limit to measure against. */
  percent: number | null;
  /** The percent is a confirmed lower bound while some usage is still unmeasured. */
  partial?: boolean;
  size?: UsageMeterSize;
  /** Accessible name. Without it the meter is decorative and nearby text carries the reading. */
  label?: string;
  /** Localized reading announced for the meter, such as "At least 62%". */
  valueText?: string;
  /** Severity the host knows beyond the percent, such as reserved usage; the severer level shows. */
  level?: UsageProgress["level"];
  marks?: ReactNode;
  delay?: number;
  className?: string;
};

/** Host observation meter: known, partial, unknown, uncapped and over-limit readings. */
export function UsageMeter({
  percent,
  partial = false,
  size = "md",
  label,
  valueText,
  level: host,
  marks,
  delay,
  className = "",
}: UsageMeterProps) {
  const progress = usageProgress(percent, partial);
  const level = severerLevel(progress.level, host);
  if (progress.kind === "none") return <UsageNoCapTrack size={size} className={className} />;
  if (progress.percent === null) return <UsageUnknownTrack size={size} className={className} />;
  const value = Math.min(100, Math.max(0, progress.percent));
  const track = {
    size,
    level,
    fill: `${value}%`,
    partial: progress.kind === "partial",
    over: progress.percent > 100,
    marks,
    delay,
    trace: progress.percent > 0,
    className,
  };
  if (!label) return <UsageTrack {...track} aria-hidden data-level={level} />;
  return (
    <UsageTrack
      {...track}
      role="meter"
      aria-label={label}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-valuemin={0}
      aria-valuemax={100}
      data-kind={progress.kind}
      data-level={level}
    />
  );
}
