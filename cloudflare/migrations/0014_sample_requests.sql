-- Free-carousel leads from /free-carousel/, reviewed by the administrator in the studio.
CREATE TABLE IF NOT EXISTS sample_requests(
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  name TEXT NOT NULL,
  clinic TEXT NOT NULL,
  email TEXT NOT NULL,
  instagram TEXT NOT NULL,
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  utm_content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'New',
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sample_requests_created ON sample_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sample_requests_email ON sample_requests(email,instagram);
