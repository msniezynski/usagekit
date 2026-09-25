import type { AccessContext, UsageScope, BudgetScope, BudgetOwner } from "@usagekit/core";
/** Host-supplied ownership lookup. Missing resolver or owner denies resource-scoped reads. */
export type OwnershipResolver = (
  scope: Extract<BudgetScope, { kind: "connection" | "access_credential" }>,
) => Promise<BudgetOwner | null>;
export const includes = (list: readonly string[] | "*", id: string) =>
  list === "*" || list.includes(id);
export function canRead(access: AccessContext, scope: UsageScope): boolean {
  if (access.namespace !== scope.namespace) return false;
  switch (scope.kind) {
    case "principal":
      return includes(access.readablePrincipals, scope.principal);
    case "group":
      return includes(access.readableGroups, scope.group);
    case "namespace":
      return access.readablePrincipals === "*";
    case "platform_pool":
      return access.canManageBudgets || includes(access.readablePools, scope.poolId);
  }
}
/** Pools and tags span principals: their figures are shared, so unreadable ones are redacted, not forbidden. */
export const isShared = (scope: BudgetScope) =>
  scope.kind === "platform_pool" || scope.kind === "tag";
export function canReadShared(access: AccessContext, scope: BudgetScope): boolean {
  if (access.namespace !== scope.namespace) return false;
  if (scope.kind === "platform_pool") return canRead(access, scope);
  return access.canManageBudgets || access.readablePrincipals === "*";
}
export async function canReadBudget(
  resolveOwnership: OwnershipResolver | undefined,
  access: AccessContext,
  scope: BudgetScope,
): Promise<boolean> {
  if (access.namespace !== scope.namespace) return false;
  if (isShared(scope)) return canReadShared(access, scope);
  if (scope.kind !== "connection" && scope.kind !== "access_credential")
    return canRead(access, scope);
  const owner = await resolveOwnership?.(scope);
  return owner != null && canRead(access, owner);
}
