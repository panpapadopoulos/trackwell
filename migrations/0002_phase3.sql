-- Trackwell D1 schema, migration 0002 (Phase 3).

-- Rollback support: every imported row records the import run that created it.
ALTER TABLE work_days ADD COLUMN import_run_id TEXT REFERENCES import_runs(id);
ALTER TABLE income_payments ADD COLUMN import_run_id TEXT REFERENCES import_runs(id);
ALTER TABLE expenses ADD COLUMN import_run_id TEXT REFERENCES import_runs(id);
ALTER TABLE expense_categories ADD COLUMN import_run_id TEXT REFERENCES import_runs(id);
ALTER TABLE payment_methods ADD COLUMN import_run_id TEXT REFERENCES import_runs(id);
ALTER TABLE recurring_expenses ADD COLUMN import_run_id TEXT REFERENCES import_runs(id);

-- Recurring plans are soft-deleted (their generated expenses stay in history).
ALTER TABLE recurring_expenses ADD COLUMN deleted_at INTEGER;
ALTER TABLE recurring_expenses ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE expense_categories ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_methods ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

-- Manual payday override for one pay period (e.g. holiday shift).
CREATE TABLE pay_period_overrides (
  period_start TEXT PRIMARY KEY CHECK (period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  payday TEXT NOT NULL CHECK (payday GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  note TEXT CHECK (note IS NULL OR length(note) <= 200),
  updated_at INTEGER NOT NULL
);

-- Bell-schedule definitions live in versioned code (src/domain/schedule); only the
-- per-date manual overrides are data. Keyed by school name (schools are free text).
CREATE TABLE schedule_date_overrides (
  school_name TEXT NOT NULL,
  date TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (school_name, date)
);

CREATE INDEX coverage_teacher ON coverage_blocks (teacher_name) WHERE teacher_name IS NOT NULL;
CREATE INDEX expenses_category ON expenses (category_id) WHERE deleted_at IS NULL;

INSERT OR IGNORE INTO pay_rules (version, effective_from, rules_json, created_at)
VALUES ('subtrack-legacy-v1', '2024-01-01', '{"source":"src/domain/pay/rules.ts PAY_RULES_V1"}', 0);

INSERT OR IGNORE INTO pay_schedules (id, anchor, length_days, payday_offset_days, effective_from)
VALUES ('biweekly-v1', '2024-01-01', 14, 5, '2024-01-01');

-- Bell-schedule ids registered for referential integrity (work_days.schedule_id).
-- Period times are the versioned code in src/domain/schedule (verified against the official image).
INSERT OR IGNORE INTO schools (id, name, district_id, archived_at) VALUES ('school-mhs', 'Munster High School', NULL, NULL);
INSERT OR IGNORE INTO schools (id, name, district_id, archived_at) VALUES ('school-demo', 'Lakeview Demo High School', NULL, NULL);
INSERT OR IGNORE INTO bell_schedules (id, school_id, school_year, name, status, source, lunch_variants) VALUES
  ('mhs-2026-27-traditional', 'school-mhs', '2026-27', 'Traditional', 'verified', 'src/domain/schedule/mhs-2026-27.ts', '["A","B","C"]'),
  ('mhs-2026-27-a-block', 'school-mhs', '2026-27', 'A Block', 'verified', 'src/domain/schedule/mhs-2026-27.ts', '["A","B","C"]'),
  ('mhs-2026-27-b-block', 'school-mhs', '2026-27', 'B Block', 'verified', 'src/domain/schedule/mhs-2026-27.ts', '["A","B","C"]'),
  ('demo-traditional', 'school-demo', '2026-27', 'Traditional (demo)', 'synthetic', 'src/domain/schedule/registry.ts', '["A","B","C"]');
