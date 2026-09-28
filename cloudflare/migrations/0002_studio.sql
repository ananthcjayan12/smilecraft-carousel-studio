CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  business_pack_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  profile_json TEXT NOT NULL,
  brand_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_clients_account ON clients(account_id, archived, updated_at);
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  revision INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  business_pack_id TEXT NOT NULL,
  business_pack_version TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  context_json TEXT NOT NULL,
  project_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_projects_account_client ON projects(account_id, client_id, archived, updated_at);
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_assets_account_client ON assets(account_id, client_id);
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  business_pack_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_templates_account_client ON templates(account_id, client_id);
ALTER TABLE generation_jobs ADD COLUMN provider TEXT;
ALTER TABLE generation_jobs ADD COLUMN slide_index INTEGER;
ALTER TABLE generation_jobs ADD COLUMN error TEXT;
ALTER TABLE generation_jobs ADD COLUMN started_at TEXT;
