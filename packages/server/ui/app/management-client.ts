import { decodeMeterJson } from "@usagekit/core";
import { serialize } from "@usagekit/react";
import type { Budget } from "@usagekit/core";
import type { BudgetWriter, BudgetSaveResult, BudgetReconciliation } from "@usagekit/react";
import type {
  ProviderBinding,
  ProviderManagementPort,
  ProviderReadResult,
  ProviderActionResult,
  ProviderReconciliation,
} from "@usagekit/views";
import type { Session } from "./session";

const encode = (value: unknown) =>
  JSON.stringify(value, (_, part: unknown) => (typeof part === "bigint" ? String(part) : part));
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

async function request(session: Session, path: string, body?: unknown, method = "POST") {
  const response = await session.fetch(session.baseUrl + path, {
    method: body === undefined ? "GET" : method,
    headers: {
      Authorization: `Bearer ${session.token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: encode(body) }),
    cache: "no-store",
    redirect: "error",
  });
  let value: unknown;
  try {
    value = decodeMeterJson(await response.text());
  } catch {
    value = null;
  }
  return { response, value };
}

/** UI identity comes from this authenticated host; it is never submitted as authorization. */
export async function loadProviderBinding(session: Session): Promise<ProviderBinding> {
  const { response, value } = await request(session, "/providers/management/binding");
  if (
    !response.ok ||
    !record(value) ||
    ![value.scopeKey, value.principalKey, value.authRevision].every(
      (part) => typeof part === "string" && part.length > 0,
    ) ||
    typeof value.canManage !== "boolean"
  )
    throw new Error("Could not verify the local server session.");
  return {
    scopeKey: value.scopeKey as string,
    principalKey: value.principalKey as string,
    authRevision: value.authRevision as string,
    canManage: value.canManage,
  };
}

/** No automatic retries, provider probes, credential persistence or error-body display. */
export function createProviderPort(session: Session): ProviderManagementPort {
  return {
    async read(_binding, query) {
      try {
        const { response, value } = await request(session, "/providers/management/read", { query });
        if (response.status === 401 || response.status === 403) return { outcome: "forbidden" };
        if (response.status === 400 && record(value) && value.outcome === "invalid")
          return { outcome: "invalid", field: "query", reason: "Invalid provider query." };
        if (
          response.ok &&
          record(value) &&
          value.outcome === "ok" &&
          record(value.value) &&
          value.value.kind === query.kind
        )
          return value as ProviderReadResult;
      } catch {}
      return { outcome: "unavailable", message: "Provider information is unavailable." };
    },
    async execute(_binding, command, secrets) {
      try {
        const { response, value } = await request(session, "/providers/management/commands", {
          command,
          ...(secrets ? { secrets } : {}),
        });
        if (response.status === 401 || response.status === 403)
          return { outcome: "forbidden", commandId: command.commandId };
        if (response.status === 400 && record(value) && value.outcome === "invalid")
          return {
            outcome: "invalid",
            commandId: command.commandId,
            field: "command",
            reason: "The local server rejected the command before applying it.",
          };
        if (
          response.ok &&
          record(value) &&
          value.commandId === command.commandId &&
          ["success", "conflict", "invalid", "forbidden", "unavailable"].includes(
            String(value.outcome),
          )
        )
          return value as ProviderActionResult;
      } catch {}
      return {
        outcome: "unavailable",
        commandId: command.commandId,
        message: "The command result is unknown. Check its status before another change.",
        ambiguous: true,
      };
    },
    async reconcile(_binding, command) {
      try {
        const { response, value } = await request(session, "/providers/management/reconcile", {
          command,
        });
        if (response.status === 401 || response.status === 403)
          return { outcome: "forbidden", commandId: command.commandId };
        if (
          response.ok &&
          record(value) &&
          value.commandId === command.commandId &&
          ["success", "conflict", "invalid", "forbidden", "unavailable", "not_applied"].includes(
            String(value.outcome),
          )
        )
          return value as ProviderReconciliation;
      } catch {}
      return {
        outcome: "unavailable",
        commandId: command.commandId,
        message: "The original command has no confirmed result.",
        ambiguous: true,
      };
    },
  };
}

export function createBudgetWriter(session: Session): BudgetWriter {
  const write = async (budget: Budget, reconcile: boolean): Promise<BudgetReconciliation> => {
    try {
      const { response, value } = await request(
        session,
        reconcile ? "/budgets/reconcile" : "/budgets",
        budget,
        reconcile ? "POST" : "PUT",
      );
      if (response.status === 401 || response.status === 403) return { outcome: "forbidden" };
      if (response.status === 409) return { outcome: "conflict", reason: "budget_version" };
      if (response.status === 400)
        return { outcome: "invalid", field: "budget", reason: "Invalid budget definition." };
      if (response.ok && record(value)) {
        if (!reconcile && serialize(value) === serialize(budget))
          return { outcome: "saved", budget };
        if (reconcile && value.outcome === "saved" && record(value.budget))
          return { outcome: "saved", budget: value.budget as Budget };
        if (reconcile && value.outcome === "conflict")
          return { outcome: "conflict", reason: "budget_version" };
      }
    } catch {}
    return {
      outcome: "unavailable",
      message: "The budget result is unknown. Check its status before another change.",
      ambiguous: true,
    };
  };
  return {
    save: (budget) => write(budget, false) as Promise<BudgetSaveResult>,
    reconcile: (budget) => write(budget, true),
  };
}
