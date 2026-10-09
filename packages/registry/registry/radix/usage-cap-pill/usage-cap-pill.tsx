"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { UsageMeter } from "@/components/usagekit/usage-meter";
import { usageMotion } from "@/components/usagekit/usage-motion";
import { usageProgress } from "@/components/usagekit/usage-progress";

export const usageCapPillLabels = { unknown: "Usage unknown", unavailable: "Usage unavailable" };
export type UsageCapPillLabels = typeof usageCapPillLabels;
export type UsageCapLinkProps = {
  href: string;
  "aria-label": string;
  className: string;
  children: ReactNode;
};
export type UsageCapPillProps = {
  state: "hidden" | "unavailable" | "ready";
  label?: string;
  ariaLabel?: string;
  href?: string;
  percent?: number | null;
  partial?: boolean;
  /** "sm" sits beside compact header chips; "md" is the default height. */
  size?: "sm" | "md";
  className?: string;
  labels?: Partial<UsageCapPillLabels>;
  renderLink?: (props: UsageCapLinkProps) => ReactNode;
};

const sizeClass = { sm: "cn-usage-pill-sm", md: "cn-usage-pill-md" } as const;
const levelClass = {
  ok: "border-border",
  warning: "border-chart-4/70",
  exceeded: "border-destructive/50 text-destructive",
} as const;

/** Compact host-authoritative usage. Routing and localized copy belong to the host. */
export function UsageCapPill({
  state,
  label,
  ariaLabel,
  href,
  percent = null,
  partial = false,
  size = "md",
  className = "",
  labels: custom,
  renderLink = (props) => <a {...props} />,
}: UsageCapPillProps) {
  const labels = { ...usageCapPillLabels, ...custom };
  if (state === "hidden") return null;
  if (state === "unavailable")
    return (
      <Badge
        data-usagekit="usage-cap-pill"
        variant="outline"
        role="status"
        className={`cn-usage-pill border-dashed bg-transparent text-muted-foreground ${sizeClass[size]} ${className}`}
      >
        {labels.unavailable}
      </Badge>
    );
  const progress = usageProgress(percent, partial);
  const unknown = progress.kind === "unknown";
  const text = unknown ? labels.unknown : (label ?? labels.unknown);
  const content = (
    <span
      data-usagekit="usage-cap-pill"
      data-coverage={progress.kind}
      data-level={progress.level}
      className="inline-flex min-w-0 items-center gap-[inherit]"
    >
      <UsageMeter
        size="sm"
        percent={percent}
        partial={partial}
        className={progress.kind === "none" ? "w-4" : size === "sm" ? "w-7" : "w-9"}
      />
      <span key={text} className={`min-w-0 truncate ${usageMotion.enter}`}>
        {text}
      </span>
    </span>
  );
  const pillClass = `cn-usage-pill cn-usage-pill-fill inline-flex max-w-full items-center tabular-nums text-foreground ${sizeClass[size]} ${levelClass[unknown ? "ok" : progress.level]} ${className}`;
  return href ? (
    renderLink({
      href,
      "aria-label": unknown ? labels.unknown : (ariaLabel ?? text),
      className: `${pillClass} cn-usage-pill-link cn-usage-focus no-underline ${usageMotion.respond}`,
      children: content,
    })
  ) : (
    <span role="status" className={pillClass}>
      {content}
    </span>
  );
}
