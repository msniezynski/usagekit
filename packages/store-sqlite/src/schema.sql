CREATE TABLE IF NOT EXISTS operations (
 operation_pk TEXT PRIMARY KEY, namespace TEXT NOT NULL, principal TEXT NOT NULL,
 operation_id TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL,
 scope_json TEXT NOT NULL, semantic_json TEXT NOT NULL, estimate_json TEXT NOT NULL,
 budget_epochs_json TEXT NOT NULL, lease_id TEXT, lease_holder TEXT, lease_expires_at TEXT,
 lease_kind TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 operation_json TEXT NOT NULL, warnings_json TEXT NOT NULL,
 UNIQUE(namespace,principal,operation_id), UNIQUE(namespace,operation_id)
);
CREATE TABLE IF NOT EXISTS receipts (
 receipt_pk TEXT PRIMARY KEY, operation_pk TEXT NOT NULL REFERENCES operations(operation_pk),
 receipt_id TEXT NOT NULL, supersedes TEXT, receipt_json TEXT NOT NULL,
 occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL, cost_units INTEGER, cost_certainty TEXT NOT NULL,
 sequence INTEGER NOT NULL, UNIQUE(operation_pk,receipt_id)
);
CREATE TABLE IF NOT EXISTS measurements (
 receipt_pk TEXT NOT NULL REFERENCES receipts(receipt_pk), unit TEXT NOT NULL,
 value INTEGER, scale INTEGER, certainty TEXT NOT NULL, PRIMARY KEY(receipt_pk,unit)
);
CREATE TABLE IF NOT EXISTS commands (
 operation_pk TEXT NOT NULL REFERENCES operations(operation_pk), command_id TEXT NOT NULL,
 kind TEXT NOT NULL, input_hash TEXT NOT NULL, input_json TEXT NOT NULL, result_json TEXT NOT NULL,
 PRIMARY KEY(operation_pk,command_id)
);
CREATE TABLE IF NOT EXISTS budgets (
 namespace TEXT NOT NULL, budget_id TEXT NOT NULL, version INTEGER NOT NULL,
 scope_json TEXT NOT NULL, scope_kind TEXT NOT NULL, scope_key TEXT NOT NULL,
 surface TEXT NOT NULL, unit TEXT NOT NULL, limit_value INTEGER, limit_scale INTEGER,
 window_json TEXT NOT NULL, on_exceed TEXT NOT NULL, budget_json TEXT NOT NULL,
 PRIMARY KEY(namespace,budget_id,version)
);
CREATE TABLE IF NOT EXISTS budget_usage (
 namespace TEXT NOT NULL, budget_id TEXT NOT NULL, epoch TEXT NOT NULL,
 settled_value INTEGER NOT NULL, outstanding_value INTEGER NOT NULL, scale INTEGER NOT NULL,
 PRIMARY KEY(namespace,budget_id,epoch)
);
CREATE TABLE IF NOT EXISTS cursors (
 token TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, expires_at INTEGER NOT NULL
);
