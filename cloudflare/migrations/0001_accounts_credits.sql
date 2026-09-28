PRAGMA foreign_keys = ON;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  identity_provider TEXT NOT NULL,
  identity_subject TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(identity_provider, identity_subject)
);
CREATE TABLE memberships (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('owner','admin','member')),
  PRIMARY KEY(account_id, user_id)
);
CREATE TABLE plans (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  monthly_credits INTEGER NOT NULL CHECK(monthly_credits >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(id, version)
);
CREATE TABLE subscriptions (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL,
  payment_customer_id TEXT UNIQUE,
  payment_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  FOREIGN KEY(plan_id, plan_version) REFERENCES plans(id, version)
);
CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  amount INTEGER NOT NULL CHECK(amount != 0),
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_id, source_id)
);
CREATE INDEX idx_credit_ledger_account ON credit_ledger(account_id, created_at);
CREATE TABLE payment_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE generation_jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  project_id TEXT NOT NULL,
  action TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
  idempotency_key TEXT NOT NULL,
  quoted_credits INTEGER NOT NULL CHECK(quoted_credits >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  UNIQUE(account_id, idempotency_key)
);
CREATE INDEX idx_generation_jobs_account ON generation_jobs(account_id, created_at);
CREATE TABLE credit_reservations (
  job_id TEXT PRIMARY KEY REFERENCES generation_jobs(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  amount INTEGER NOT NULL CHECK(amount >= 0),
  status TEXT NOT NULL CHECK(status IN ('reserved','settled','released')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_credit_reservations_account ON credit_reservations(account_id, status);
