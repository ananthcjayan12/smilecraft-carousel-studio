-- Support clinic/week polling and review queries without scanning all jobs.
CREATE INDEX IF NOT EXISTS v4_jobs_account_week ON v4_jobs(account_id,week_id,priority,created_at);
CREATE INDEX IF NOT EXISTS v4_jobs_account_content ON v4_jobs(account_id,content_id,created_at);
CREATE INDEX IF NOT EXISTS v4_jobs_account_clinic ON v4_jobs(account_id,clinic_id,created_at);
CREATE INDEX IF NOT EXISTS v4_usage_account_content ON v4_usage(account_id,content_id,status);
CREATE INDEX IF NOT EXISTS v4_weeks_account_clinic ON v4_weeks(account_id,clinic_id,week_start);
