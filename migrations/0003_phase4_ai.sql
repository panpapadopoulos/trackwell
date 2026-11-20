-- Phase 4: editable weekday employment defaults + in-app assistant bookkeeping.
-- Additive only. No existing row or pay figure changes.

-- Weekday defaults are history-preserving: an edit adds rows effective from the
-- edit date; earlier rows stay, so past projections can still be explained.
-- Defaults only pre-fill forms; they never create a worked day.
CREATE TABLE weekday_defaults (
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 5),
  effective_from TEXT NOT NULL,
  employment_type TEXT NOT NULL CHECK (employment_type IN ('permanent','regular')),
  school_name TEXT CHECK (school_name IS NULL OR length(school_name) BETWEEN 1 AND 160),
  district TEXT CHECK (district IS NULL OR length(district) BETWEEN 1 AND 120),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (weekday, effective_from)
);
INSERT INTO weekday_defaults (weekday, effective_from, employment_type, school_name, district, updated_at) VALUES
  (1, '2024-01-01', 'permanent', 'Munster High School', 'Munster', 0),
  (2, '2024-01-01', 'regular', NULL, NULL, 0),
  (3, '2024-01-01', 'permanent', 'Munster High School', 'Munster', 0),
  (4, '2024-01-01', 'regular', NULL, NULL, 0),
  (5, '2024-01-01', 'permanent', 'Munster High School', 'Munster', 0);

-- Assistant preferences (persistent context the assistant reads every request).
ALTER TABLE ai_preferences ADD COLUMN usual_lunch TEXT CHECK (usual_lunch IS NULL OR usual_lunch IN ('A','B','C'));
INSERT OR IGNORE INTO ai_preferences (id, enabled, sharing_level, provider, model, consented_at, updated_at, usual_lunch)
  VALUES (1, 1, 'aggregates', NULL, NULL, NULL, 0, 'A');

-- Draft bookkeeping: what produced it and what it became.
ALTER TABLE ai_drafts ADD COLUMN prompt_version TEXT;
ALTER TABLE ai_drafts ADD COLUMN mode TEXT;              -- 'mock' | 'workers-ai'
ALTER TABLE ai_drafts ADD COLUMN model TEXT;
ALTER TABLE ai_drafts ADD COLUMN trace_json TEXT;        -- tool trace, no money from the model
ALTER TABLE ai_drafts ADD COLUMN result_id TEXT;         -- saved work_days.id after confirmation

-- Daily usage counters (server date, America/Chicago). Enforces the daily cap.
CREATE TABLE ai_usage (
  day TEXT PRIMARY KEY,
  requests INTEGER NOT NULL DEFAULT 0,
  model_calls INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0
);
