-- V4 weekly content planning and global anti-repetition tracker.
CREATE TABLE IF NOT EXISTS v4_weekly_plans (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  plan_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, client_id, week_start),
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_v4_weekly_plans_client
  ON v4_weekly_plans(account_id, client_id, week_start DESC);

CREATE TABLE IF NOT EXISTS v4_content_usage (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  angle_key TEXT NOT NULL,
  format TEXT NOT NULL,
  week_start TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_v4_usage_client_card
  ON v4_content_usage(client_id, card_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_v4_usage_global_combo
  ON v4_content_usage(card_id, angle_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_v4_usage_week
  ON v4_content_usage(account_id, client_id, week_start);
