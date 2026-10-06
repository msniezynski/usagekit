import type { Database } from "./database.js";
import type { BillingImportRecord, BillingImportInput, Operation } from "@usagekit/core";
import type { Store, Clock, StoredBillingImport } from "@usagekit/store";
import {
  InvalidInput,
  billingFamilyId,
  prepareBillingImport,
  readBillingImports,
  validateBillingImportInput,
  validateBillingImportsQuery,
} from "@usagekit/store";
import { encode, decode } from "./serialize.js";
import { key, identity } from "./util.js";
import { appendReceipt, event, hydrate, updateOperation } from "./records.js";
import type { OperationRow } from "./records.js";
import { updateUsage, recordAlerts, reachedBySettlement } from "./budgets.js";

type ImportRow = { identity_json: string; record_json: string };

/** Caller holds the same write transaction that stores the immutable import journal. */
function candidates(db: Database, input: BillingImportInput): Operation[] {
  const ids = input.lines.flatMap((line) =>
    line.providerRequestId === undefined ? [] : [line.providerRequestId],
  );
  const rows = db
    .prepare(
      `SELECT o.* FROM operations o
       WHERE o.namespace=? AND o.principal=?
       AND json_extract(o.operation_json,'$.scope.connection')=?
       AND json_extract(o.operation_json,'$.provider')=?
       AND (EXISTS(SELECT 1 FROM receipts r WHERE r.operation_pk=o.operation_pk
         AND julianday(r.occurred_at)>=julianday(?) AND julianday(r.occurred_at)<julianday(?))
        OR (julianday(o.created_at)>=julianday(?) AND julianday(o.created_at)<julianday(?))
        OR EXISTS(SELECT 1 FROM receipts r WHERE r.operation_pk=o.operation_pk
         AND json_extract(r.receipt_json,'$.providerRequestId') IN (SELECT value FROM json_each(?))))
       ORDER BY o.operation_pk`,
    )
    .all(
      input.scope.namespace,
      input.scope.principal,
      input.scope.connection,
      input.provider,
      input.window.from,
      input.window.to,
      input.window.from,
      input.window.to,
      JSON.stringify(ids),
    ) as OperationRow[];
  return rows.map((row) => hydrate(db, row));
}

function insertOperation(db: Database, op: Operation): void {
  const {
    state,
    version,
    budgetEpochs,
    createdAt,
    updatedAt,
    reservationExpiresAt,
    receipts: _,
    lease: __,
    ...input
  } = op;
  db.prepare(
    "INSERT INTO operations(operation_pk,namespace,principal,operation_id,state,version,semantic_json,budget_epochs_json,created_at,updated_at,operation_json,warnings_json,reservation_expires_at,alerts_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    key(op.scope.namespace, op.operationId),
    op.scope.namespace,
    op.scope.principal,
    op.operationId,
    state,
    version,
    identity(input),
    encode(budgetEpochs),
    createdAt,
    updatedAt,
    encode(input),
    "[]",
    reservationExpiresAt,
    "[]",
  );
}

export function billing(
  db: Database,
  clock: Clock,
  hook?: () => void,
): Pick<Store, "importBilling" | "billingImports"> {
  return {
    importBilling: async (input) =>
      db
        .transaction(() => {
          const invalid = validateBillingImportInput(input);
          if (invalid) return invalid;
          const familyId = billingFamilyId(input);
          const family = db
            .prepare("SELECT latest_import_id FROM billing_import_families WHERE family_id=?")
            .get(familyId) as { latest_import_id: string } | undefined;
          const imports = (
            db
              .prepare("SELECT identity_json,record_json FROM billing_imports WHERE family_id=?")
              .all(familyId) as ImportRow[]
          ).map(
            (row): StoredBillingImport => ({
              identity: row.identity_json,
              record: decode<BillingImportRecord>(row.record_json),
            }),
          );
          const prepared = prepareBillingImport(
            input,
            {
              operations: candidates(db, input),
              imports,
              latestImportId: family?.latest_import_id ?? null,
            },
            clock.now(),
          );
          if (!prepared.stored) return structuredClone(prepared.result);
          for (const { before, after, receipt } of prepared.changes) {
            if (before) updateOperation(db, before, after, null);
            else insertOperation(db, after);
            hook?.();
            appendReceipt(db, after, receipt);
            updateUsage(db, before, after);
            event(db, after);
          }
          const { record, identity: inputIdentity } = prepared.stored;
          record.alerts = recordAlerts(
            db,
            input.scope.namespace,
            prepared.changes.flatMap(({ after }) => reachedBySettlement(db, after)),
            clock.now(),
          );
          db.prepare(
            "INSERT INTO billing_import_families VALUES(?,?) ON CONFLICT(family_id) DO UPDATE SET latest_import_id=excluded.latest_import_id",
          ).run(prepared.familyId, record.id);
          db.prepare("INSERT INTO billing_imports VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
            record.id,
            prepared.familyId,
            record.scope.namespace,
            record.scope.principal,
            record.scope.connection,
            record.provider,
            record.window.from,
            record.window.to,
            record.recordedAt,
            inputIdentity,
            encode(record),
          );
          return structuredClone(prepared.result);
        })
        .immediate(),
    billingImports: async (query) =>
      db
        .transaction(() => {
          const invalid = validateBillingImportsQuery(query);
          if (invalid) throw new InvalidInput(invalid.field, invalid.reason);
          const records = (
            db
              .prepare(
                "SELECT record_json FROM billing_imports WHERE namespace=? AND principal=? AND connection=? AND window_from<? AND window_to>?",
              )
              .all(
                query.scope.namespace,
                query.scope.principal,
                query.connection,
                new Date(query.to).toISOString(),
                new Date(query.from).toISOString(),
              ) as { record_json: string }[]
          ).map((row) => decode<BillingImportRecord>(row.record_json));
          return readBillingImports(records, query, clock.now());
        })
        .deferred(),
  };
}
