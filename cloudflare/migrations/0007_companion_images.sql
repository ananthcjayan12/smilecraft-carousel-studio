CREATE TABLE companion_jobs_new (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL REFERENCES companion_devices(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  request_key TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('codex','antigravity')),
  task TEXT NOT NULL CHECK(task IN ('draft','revise','image')),
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
INSERT INTO companion_jobs_new SELECT * FROM companion_jobs;
DROP TABLE companion_jobs;
ALTER TABLE companion_jobs_new RENAME TO companion_jobs;
CREATE INDEX companion_jobs_pending ON companion_jobs(device_id,status,created_at);
