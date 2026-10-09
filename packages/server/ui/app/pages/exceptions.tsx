import { ExceptionsListPanel } from "@/components/usagekit/exceptions-list";
import { monthWindow } from "@/components/usagekit/usage-filters";
import { UsageChevron } from "@/components/usagekit/usage-motion";
import { localScope } from "../session";

/** Operations created since the start of last month that need recovery or evidence. */
export function ExceptionsPage({ now = new Date() }: { now?: Date }) {
  return (
    <section aria-label="Exceptions" className="min-w-0 space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Needs attention</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Operations since the start of last month that still need evidence or recovery.
        </p>
      </div>
      <ExceptionsListPanel
        scope={localScope}
        from={monthWindow(now, -1).from}
        to={monthWindow(now, 0).to}
        limit={200}
      />
      <details className="group rounded-lg border border-border text-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
          Record a sample for an unknown operation
          <UsageChevron open={false} className="text-muted-foreground group-open:rotate-180" />
        </summary>
        <p className="px-4 pb-3 text-muted-foreground">
          Add <code>X-Usagekit-Record-Fixture: true</code> to your next proxy request. This saves a
          redacted response under your local fixtures directory. The request is billed normally;
          recording does not send an extra call. Review the file before sharing it.
        </p>
      </details>
    </section>
  );
}
