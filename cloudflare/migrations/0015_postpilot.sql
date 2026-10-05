CREATE TABLE IF NOT EXISTS v4_postpilot (
 account_id TEXT NOT NULL, content_id TEXT NOT NULL, revision INTEGER NOT NULL,
 post_id TEXT, status TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}',
 result_json TEXT NOT NULL DEFAULT '{}', error TEXT, updated_at TEXT NOT NULL,
 PRIMARY KEY(account_id,content_id)
);
