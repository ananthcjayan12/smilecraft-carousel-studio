-- Preserve existing content while allowing content outside a weekly plan.
CREATE TABLE v4_content_next (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, clinic_id TEXT NOT NULL REFERENCES v4_clinics(id),
 week_id TEXT REFERENCES v4_weeks(id), position INTEGER NOT NULL, type TEXT NOT NULL,
 knowledge_card_id TEXT NOT NULL, angle_id TEXT NOT NULL, recipe_id TEXT NOT NULL,
 style_id TEXT NOT NULL, topic TEXT NOT NULL, caption TEXT NOT NULL, frames_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'planned', revision INTEGER NOT NULL DEFAULT 1,
 scheduled_at TEXT, destination TEXT, feedback_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL,
 brief_json TEXT NOT NULL DEFAULT '{}', language TEXT NOT NULL DEFAULT 'English',
 copy_status TEXT NOT NULL DEFAULT 'draft', validation_json TEXT NOT NULL DEFAULT '{}',
 copy_approved_at TEXT, context_json TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO v4_content_next(id,account_id,clinic_id,week_id,position,type,knowledge_card_id,angle_id,recipe_id,style_id,topic,caption,frames_json,status,revision,scheduled_at,destination,feedback_json,created_at,language,copy_status)
SELECT id,account_id,clinic_id,week_id,position,type,knowledge_card_id,angle_id,recipe_id,style_id,topic,caption,frames_json,status,revision,scheduled_at,destination,feedback_json,created_at,
 COALESCE((SELECT json_extract(profile_json,'$.language') FROM v4_clinics WHERE id=clinic_id),'English'),
 CASE WHEN status IN ('ready','approved') THEN 'approved' ELSE 'draft' END FROM v4_content;
DROP TABLE v4_content;
ALTER TABLE v4_content_next RENAME TO v4_content;
CREATE INDEX v4_content_week ON v4_content(account_id,week_id,position);
CREATE INDEX v4_content_library ON v4_content(account_id,clinic_id,created_at);
CREATE TABLE v4_provider_settings (
 account_id TEXT PRIMARY KEY, tasks_json TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
