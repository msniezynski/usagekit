import type { ConnectionInput } from "@usagekit/views";
import { ConnectionList } from "@/components/usagekit/connection-list";

export function ConnectionsPage({ connections }: { connections: readonly ConnectionInput[] }) {
  return <ConnectionList connections={connections} />;
}
