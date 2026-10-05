CREATE TABLE IF NOT EXISTS v4_postpilot_connections (
 account_id TEXT NOT NULL,
 clinic_id TEXT NOT NULL,
 base_url TEXT NOT NULL,
 api_key TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(account_id,clinic_id)
);
