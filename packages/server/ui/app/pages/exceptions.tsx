import { ExceptionsListPanel } from "@/components/usagekit/exceptions-list";
import { monthWindow } from "@/components/usagekit/usage-filters";
import { localScope } from "../session";

/** Operations created since the start of last month that need recovery or evidence. */
export function ExceptionsPage({ now = new Date() }: { now?: Date }) {
  return (
    <ExceptionsListPanel
      scope={localScope}
      from={monthWindow(now, -1).from}
      to={monthWindow(now, 0).to}
      limit={200}
    />
  );
}
