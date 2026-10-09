"use client";
import type { Figure } from "@usagekit/views";
import type { useProviderAction } from "@usagekit/react";
import { Button } from "@/components/ui/button";
import { UsageNotice, UsageSpinner, usageMotion } from "@/components/usagekit/usage-motion";
import type { UsageNoticeTone } from "@/components/usagekit/usage-motion";

export const providerFeedbackLabels = {
  readOnly: "View only. Connection changes are managed by your administrator.",
  pending: "Applying change…",
  success: "Change applied.",
  forbidden: "You cannot make this change.",
  conflict: "This connection changed elsewhere. Reload its latest settings before editing.",
  unknown: "The result is unknown. Check its status before making another change.",
  reconcile: "Check change status",
  notApplied: "The previous change was not applied.",
  unavailable: "Connection management is unavailable.",
  loading: "Loading connection evidence…",
  empty: "No evidence is available yet.",
  reload: "Reload evidence",
  unknownValue: "Unknown",
  estimated: "Estimated",
  unavailableValue: "Unavailable",
  own: "Own key",
  platform: "Platform funded",
  cents: "cents",
};
export type ProviderFeedbackLabels = typeof providerFeedbackLabels;
export function fundingLabel(
  value: "byok" | "platform",
  labels: Pick<ProviderFeedbackLabels, "own" | "platform"> = providerFeedbackLabels,
) {
  return value === "byok" ? labels.own : labels.platform;
}
export function figureText(
  figure: Figure,
  labels: Pick<
    ProviderFeedbackLabels,
    "unavailableValue" | "unknownValue" | "estimated" | "cents"
  > = providerFeedbackLabels,
) {
  return figure === "unavailable"
    ? labels.unavailableValue
    : figure.certainty === "unknown"
      ? labels.unknownValue
      : `${figure.certainty === "estimated" ? `${labels.estimated} ` : ""}${figure.text} ${figure.unit === "customer_cents" ? labels.cents : figure.unit}`;
}
/** ISO instants read as "2026-10-07 10:00 UTC"; any other host text is shown unchanged. */
export function ProviderTime({ value }: { value: string }) {
  const iso = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2}(\.\d+)?)?Z$/.exec(value);
  return <time dateTime={value}>{iso ? `${iso[1]} ${iso[2]} UTC` : value}</time>;
}
export function ProviderActionFeedback({
  action,
  labels: custom,
}: {
  action: ReturnType<typeof useProviderAction>;
  labels?: Partial<ProviderFeedbackLabels>;
}) {
  const labels = { ...providerFeedbackLabels, ...custom };
  const result = action.result;
  const message = action.ambiguous
    ? labels.unknown
    : result?.outcome === "success"
      ? (result.message ?? labels.success)
      : result?.outcome === "invalid"
        ? `${result.field}: ${result.reason}`
        : result?.outcome === "conflict"
          ? `${labels.conflict} ${result.reason}`
          : result?.outcome === "forbidden"
            ? labels.forbidden
            : result?.outcome === "unavailable"
              ? result.message
              : null;
  const tone: UsageNoticeTone =
    result?.outcome === "success" && !action.ambiguous
      ? "positive"
      : action.ambiguous || result?.outcome === "conflict"
        ? "warning"
        : "error";
  if (action.canWrite && !action.pending && !message && !action.ambiguous) return null;
  return (
    <div className="min-w-0 space-y-2.5">
      {!action.canWrite && (
        <p role="status" className="text-sm text-muted-foreground">
          {labels.readOnly}
        </p>
      )}
      {action.pending ? (
        <p
          role="status"
          className={`text-sm flex items-center gap-2 text-muted-foreground ${usageMotion.enter}`}
        >
          <UsageSpinner />
          {labels.pending}
        </p>
      ) : (
        message && (
          <UsageNotice key={message} tone={tone}>
            {message}
          </UsageNotice>
        )
      )}
      {action.ambiguous && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={action.pending}
          className={usageMotion.enter}
          onClick={() => void action.reconcile()}
        >
          {labels.reconcile}
        </Button>
      )}
    </div>
  );
}
export function ProviderReadFeedback({
  state,
  error,
  refresh,
  disabled = false,
  labels: custom,
}: {
  state: string;
  error?: { message?: string; kind?: string } | null;
  refresh: () => void;
  disabled?: boolean;
  labels?: Partial<ProviderFeedbackLabels>;
}) {
  const labels = { ...providerFeedbackLabels, ...custom };
  return (
    <div
      role="status"
      className={`rounded-lg border border-dashed px-4 py-3.5 text-sm flex min-w-0 flex-wrap items-center justify-between gap-3 border-border ${usageMotion.enter}`}
    >
      <p className="flex min-w-0 items-center gap-2 text-muted-foreground">
        {state === "loading" && <UsageSpinner />}
        {state === "loading"
          ? labels.loading
          : state === "forbidden"
            ? labels.forbidden
            : state === "empty"
              ? labels.empty
              : (error?.message ?? labels.unavailable)}
      </p>
      {state !== "loading" && (
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={refresh}>
          {labels.reload}
        </Button>
      )}
    </div>
  );
}
