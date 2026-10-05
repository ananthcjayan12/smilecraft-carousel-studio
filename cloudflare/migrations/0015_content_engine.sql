-- Content Engine: SmileCraft's own Instagram content, planned from a preloaded content bank.
-- Images are stored in v4_assets (clinic_id holds the engine brand id); AI task mapping is shared
-- with the studio through v4_provider_settings.
CREATE TABLE IF NOT EXISTS engine_brands (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL,
 profile_json TEXT NOT NULL DEFAULT '{}', brand_json TEXT NOT NULL DEFAULT '{}',
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS engine_brands_account ON engine_brands(account_id,created_at);
CREATE TABLE IF NOT EXISTS engine_styles (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, brand_id TEXT NOT NULL REFERENCES engine_brands(id),
 name TEXT NOT NULL, reference_id TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', asset_id TEXT,
 status TEXT NOT NULL DEFAULT 'generating', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS engine_styles_brand ON engine_styles(account_id,brand_id,created_at);
CREATE TABLE IF NOT EXISTS engine_templates (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, brand_id TEXT NOT NULL REFERENCES engine_brands(id),
 slug TEXT NOT NULL, name TEXT NOT NULL, format TEXT NOT NULL, ratio TEXT NOT NULL,
 roles_json TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '', visual TEXT NOT NULL DEFAULT '',
 style_id TEXT, position INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(brand_id,slug)
);
CREATE TABLE IF NOT EXISTS engine_ideas (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, brand_id TEXT NOT NULL REFERENCES engine_brands(id),
 number INTEGER NOT NULL, pillar TEXT NOT NULL, format TEXT NOT NULL, region TEXT NOT NULL DEFAULT 'all',
 hook TEXT NOT NULL, show TEXT NOT NULL DEFAULT '', angle TEXT NOT NULL DEFAULT '', keyword TEXT NOT NULL DEFAULT '',
 notes TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'bank', archived INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS engine_ideas_brand ON engine_ideas(account_id,brand_id,number);
CREATE TABLE IF NOT EXISTS engine_magnets (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, brand_id TEXT NOT NULL REFERENCES engine_brands(id),
 keyword TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', how TEXT NOT NULL DEFAULT '',
 star INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(brand_id,keyword)
);
CREATE TABLE IF NOT EXISTS engine_plans (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, brand_id TEXT NOT NULL REFERENCES engine_brands(id),
 title TEXT NOT NULL, plan_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS engine_plans_brand ON engine_plans(account_id,brand_id,plan_date);
CREATE TABLE IF NOT EXISTS engine_content (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, brand_id TEXT NOT NULL REFERENCES engine_brands(id),
 plan_id TEXT REFERENCES engine_plans(id), position INTEGER NOT NULL DEFAULT 0, slot_json TEXT NOT NULL DEFAULT '{}',
 idea_id TEXT, template_id TEXT NOT NULL, style_id TEXT NOT NULL, format TEXT NOT NULL, ratio TEXT NOT NULL,
 region TEXT NOT NULL DEFAULT 'all', keyword TEXT NOT NULL DEFAULT '', topic TEXT NOT NULL,
 brief_json TEXT NOT NULL DEFAULT '{}', frames_json TEXT NOT NULL DEFAULT '[]', caption TEXT NOT NULL DEFAULT '',
 extras_json TEXT NOT NULL DEFAULT '{}', copy_status TEXT NOT NULL DEFAULT 'draft',
 validation_json TEXT NOT NULL DEFAULT '{}', auto_artwork INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'planned', revision INTEGER NOT NULL DEFAULT 1, posted_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS engine_content_plan ON engine_content(account_id,plan_id,position);
CREATE INDEX IF NOT EXISTS engine_content_library ON engine_content(account_id,brand_id,created_at);
CREATE INDEX IF NOT EXISTS engine_content_idea ON engine_content(account_id,idea_id,created_at);
CREATE TABLE IF NOT EXISTS engine_jobs (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, brand_id TEXT NOT NULL, plan_id TEXT, content_id TEXT,
 kind TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'queued',
 progress INTEGER NOT NULL DEFAULT 0, input_json TEXT NOT NULL, result_json TEXT NOT NULL DEFAULT '{}', error TEXT,
 created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, lease_until INTEGER,
 request_key TEXT NOT NULL, UNIQUE(account_id,request_key)
);
CREATE INDEX IF NOT EXISTS engine_jobs_pending ON engine_jobs(status,priority,created_at);
CREATE INDEX IF NOT EXISTS engine_jobs_content ON engine_jobs(account_id,content_id,created_at);
CREATE INDEX IF NOT EXISTS engine_jobs_plan ON engine_jobs(account_id,plan_id,created_at);
CREATE INDEX IF NOT EXISTS engine_jobs_brand ON engine_jobs(account_id,brand_id,created_at);
