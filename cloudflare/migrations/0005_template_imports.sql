CREATE TABLE template_imports (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  business_pack_id TEXT NOT NULL,
  status TEXT NOT NULL,
  object_key TEXT NOT NULL,
  preview_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_template_imports_account ON template_imports(account_id, client_id, status);
