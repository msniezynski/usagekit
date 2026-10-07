"use client";
import type { Figure } from "@usagekit/views";
import type { useProviderAction } from "@usagekit/react";
import { Button } from "@/components/ui/button";

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
export function fundingLabel(value: "byok" | "platform") {
  return value === "byok" ? providerFeedbackLabels.own : providerFeedbackLabels.platform;
}
export function figureText(figure: Figure) {
  return figure === "unavailable"
    ? providerFeedbackLabels.unavailableValue
    : figure.certainty === "unknown"
      ? providerFeedbackLabels.unknownValue
      : `${figure.certainty === "estimated" ? "Estimated · " : ""}${figure.text} ${figure.unit === "customer_cents" ? "cents" : figure.unit}`;
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
  const message = action.pending
    ? labels.pending
    : action.ambiguous
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
  return (
    <div className="space-y-2">
      {!action.canWrite && (
        <p role="status" className="text-sm text-muted-foreground">
          {labels.readOnly}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm break-words">
          {message}
        </p>
      )}
      {action.ambiguous && (
        <Button
          type="button"
          variant="outline"
          disabled={action.pending}
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
  labels: custom,
}: {
  state: string;
  error?: { message?: string; kind?: string } | null;
  refresh: () => void;
  labels?: Partial<ProviderFeedbackLabels>;
}) {
  const labels = { ...providerFeedbackLabels, ...custom };
  return (
    <div className="space-y-2" role="status">
      <p>
        {state === "loading"
          ? labels.loading
          : state === "forbidden"
            ? labels.forbidden
            : state === "empty"
              ? labels.empty
              : (error?.message ?? labels.unavailable)}
      </p>
      {state !== "loading" && (
        <Button type="button" variant="outline" onClick={refresh}>
          {labels.reload}
        </Button>
      )}
    </div>
  );
}
