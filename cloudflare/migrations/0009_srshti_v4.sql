CREATE TABLE IF NOT EXISTS v4_clinics (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL,
 profile_json TEXT NOT NULL DEFAULT '{}', brand_json TEXT NOT NULL DEFAULT '{}',
 style_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'onboarding',
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS v4_clinics_account ON v4_clinics(account_id,updated_at);
CREATE TABLE IF NOT EXISTS v4_weeks (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, clinic_id TEXT NOT NULL REFERENCES v4_clinics(id),
 week_start TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned', approved_at TEXT, scheduled_at TEXT,
 created_at TEXT NOT NULL, UNIQUE(clinic_id,week_start)
);
CREATE TABLE IF NOT EXISTS v4_content (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, clinic_id TEXT NOT NULL REFERENCES v4_clinics(id),
 week_id TEXT NOT NULL REFERENCES v4_weeks(id), position INTEGER NOT NULL, type TEXT NOT NULL,
 knowledge_card_id TEXT NOT NULL, angle_id TEXT NOT NULL, recipe_id TEXT NOT NULL,
 style_id TEXT NOT NULL, topic TEXT NOT NULL, caption TEXT NOT NULL, frames_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'planned', revision INTEGER NOT NULL DEFAULT 1,
 scheduled_at TEXT, destination TEXT, feedback_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS v4_content_week ON v4_content(account_id,week_id,position);
CREATE TABLE IF NOT EXISTS v4_usage (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, clinic_id TEXT NOT NULL, content_id TEXT NOT NULL,
 knowledge_card_id TEXT NOT NULL, angle_id TEXT NOT NULL, recipe_id TEXT NOT NULL,
 region TEXT, headline TEXT NOT NULL, status TEXT NOT NULL, generated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS v4_usage_cooldown ON v4_usage(knowledge_card_id,angle_id,generated_at);
CREATE TABLE IF NOT EXISTS v4_jobs (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, clinic_id TEXT NOT NULL, week_id TEXT,
 content_id TEXT, kind TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'queued', progress INTEGER NOT NULL DEFAULT 0,
 input_json TEXT NOT NULL, result_json TEXT NOT NULL DEFAULT '{}', error TEXT,
 created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, lease_until INTEGER,
 request_key TEXT NOT NULL, UNIQUE(account_id,request_key)
);
CREATE INDEX IF NOT EXISTS v4_jobs_pending ON v4_jobs(status,priority,created_at);
CREATE TABLE IF NOT EXISTS v4_assets (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, clinic_id TEXT NOT NULL,
 mime TEXT NOT NULL, original_key TEXT NOT NULL, preview_key TEXT NOT NULL, thumbnail_key TEXT NOT NULL,
 width INTEGER, height INTEGER, size INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v4_styles (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, clinic_id TEXT NOT NULL,
 reference_id TEXT NOT NULL, name TEXT NOT NULL, asset_id TEXT, status TEXT NOT NULL DEFAULT 'generating',
 created_at TEXT NOT NULL, UNIQUE(clinic_id,reference_id)
);
CREATE TABLE IF NOT EXISTS v4_leads (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, email TEXT NOT NULL, plan TEXT NOT NULL,
 created_at TEXT NOT NULL, UNIQUE(account_id,email)
);
