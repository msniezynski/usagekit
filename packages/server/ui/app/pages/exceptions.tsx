import { ExceptionsListPanel } from "@/components/usagekit/exceptions-list";
import { monthWindow } from "@/components/usagekit/usage-filters";
import { localScope } from "../session";

/** Operations created since the start of last month that need recovery or evidence. */
export function ExceptionsPage({ now = new Date() }: { now?: Date }) {
  return (
    <div className="space-y-4">
      <details className="text-sm">
        <summary>Record a sample for an unknown operation</summary>
        <p className="mt-2">
          Add <code>X-Usagekit-Record-Fixture: true</code> to your next proxy request. This saves a
          redacted response under your local fixtures directory. The request is billed normally;
          recording does not send an extra call. Review the file before sharing it.
        </p>
      </details>
      <ExceptionsListPanel
        scope={localScope}
        from={monthWindow(now, -1).from}
        to={monthWindow(now, 0).to}
        limit={200}
      />
    </div>
  );
}
