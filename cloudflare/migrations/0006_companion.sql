ALTER TABLE accounts ADD COLUMN companion_enabled INTEGER NOT NULL DEFAULT 0;
CREATE TABLE companion_pairs (
  code_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE TABLE companion_devices (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL DEFAULT 0,
  capabilities TEXT NOT NULL DEFAULT '{}',
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX companion_devices_account ON companion_devices(account_id,revoked,last_seen);
CREATE TABLE companion_jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL REFERENCES companion_devices(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  request_key TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('codex','antigravity')),
  task TEXT NOT NULL CHECK(task IN ('draft','revise')),
  slide_index INTEGER,
  project_revision INTEGER NOT NULL,
  input TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled','expired')),
  lease TEXT,
  lease_until INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  error TEXT,
  UNIQUE(account_id,request_key)
);
CREATE INDEX companion_jobs_pending ON companion_jobs(device_id,status,created_at);
