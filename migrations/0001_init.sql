-- Trackwell D1 schema, migration 0001.
-- Money is INTEGER cents. Dates are ISO 'YYYY-MM-DD' TEXT. Timestamps are INTEGER epoch ms.
-- Every importable table carries (source, legacy_id) with a UNIQUE index, so importing
-- the same backup twice inserts nothing (idempotent). Deletes are soft (deleted_at).
PRAGMA foreign_keys = ON;

-- ---------- Reference data ----------
CREATE TABLE districts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 120),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  district_id TEXT REFERENCES districts(id),
  archived_at INTEGER,
  UNIQUE (name, district_id)
);

CREATE TABLE teachers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  normalized_name TEXT NOT NULL,
  school_id TEXT REFERENCES schools(id),
  default_room TEXT CHECK (default_room IS NULL OR length(default_room) <= 40),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  created_at INTEGER NOT NULL
);
CREATE INDEX teachers_lookup ON teachers (normalized_name, school_id);

-- ---------- Bell schedules (configuration as data) ----------
CREATE TABLE bell_schedules (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  school_year TEXT NOT NULL CHECK (school_year GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified', 'pending-reference', 'synthetic')),
  source TEXT NOT NULL,
  lunch_variants TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE bell_schedule_periods (
  schedule_id TEXT NOT NULL REFERENCES bell_schedules(id) ON DELETE CASCADE,
  period_id TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('class','lunch','passing','plc','pd','tutorial','advisory','other')),
  start_time TEXT NOT NULL CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  end_time TEXT NOT NULL CHECK (end_time GLOB '[0-2][0-9]:[0-5][0-9]' AND end_time > start_time),
  lunch_variant TEXT CHECK (lunch_variant IS NULL OR lunch_variant IN ('A','B','C')),
  split_of TEXT,
  PRIMARY KEY (schedule_id, period_id)
);

CREATE TABLE schedule_day_rules (
  school_id TEXT NOT NULL REFERENCES schools(id),
  school_year TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 5),
  schedule_id TEXT NOT NULL REFERENCES bell_schedules(id),
  PRIMARY KEY (school_id, school_year, weekday)
);

CREATE TABLE schedule_overrides (
  school_id TEXT NOT NULL REFERENCES schools(id),
  date TEXT NOT NULL,
  schedule_id TEXT NOT NULL REFERENCES bell_schedules(id),
  PRIMARY KEY (school_id, date)
);

-- ---------- Employment settings & pay rules ----------
CREATE TABLE employment_defaults (
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 5),
  effective_from TEXT NOT NULL,
  employment_type TEXT NOT NULL CHECK (employment_type IN ('permanent','regular')),
  school_id TEXT REFERENCES schools(id),
  PRIMARY KEY (weekday, effective_from)
);

CREATE TABLE pay_rules (
  version TEXT PRIMARY KEY,
  effective_from TEXT NOT NULL,
  rules_json TEXT NOT NULL,           -- constants of the deterministic engine (see src/domain/pay/rules.ts)
  created_at INTEGER NOT NULL
);

CREATE TABLE pay_schedules (
  id TEXT PRIMARY KEY,
  anchor TEXT NOT NULL,
  length_days INTEGER NOT NULL CHECK (length_days > 0),
  payday_offset_days INTEGER NOT NULL,
  effective_from TEXT NOT NULL
);

-- ---------- Work ----------
-- The PAY UNIT: one row per paid work day. Coverage never creates pay.
CREATE TABLE work_days (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('worked','planned','cancelled')),
  employment_type TEXT NOT NULL CHECK (employment_type IN ('permanent','regular')),
  role TEXT NOT NULL CHECK (role IN ('teacher','aide')),
  format TEXT NOT NULL CHECK (format IN ('single','multiple')),
  school_id TEXT REFERENCES schools(id),
  school_name TEXT NOT NULL,          -- verbatim legacy string preserved
  district TEXT NOT NULL,
  day_type REAL NOT NULL CHECK (day_type IN (0.5, 1)),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  hours REAL NOT NULL CHECK (hours >= 0 AND hours <= 24),
  pay_rate REAL,                      -- snapshot; NULL = legacy default for role
  pay_rule_version TEXT NOT NULL REFERENCES pay_rules(version),
  expected_net_cents INTEGER NOT NULL,   -- computed by the engine at write time, verified at import
  expected_gross_cents INTEGER NOT NULL,
  class_name TEXT,
  teacher_name TEXT,
  schedule_id TEXT REFERENCES bell_schedules(id),
  lunch_variant TEXT,
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  source TEXT NOT NULL CHECK (source IN ('subtrack','trackwell')),
  legacy_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX work_days_legacy ON work_days (source, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX work_days_date ON work_days (date) WHERE deleted_at IS NULL;
-- At most one live, worked PERMANENT day per date: a flat-rate day can't be paid twice.
-- (Legacy data has 0 dates with two permanent records; verified by tools/legacy/profile.mjs.)
CREATE UNIQUE INDEX work_days_one_permanent_per_date ON work_days (date)
  WHERE status = 'worked' AND employment_type = 'permanent' AND deleted_at IS NULL;

CREATE TABLE coverage_blocks (
  id TEXT PRIMARY KEY,
  work_day_id TEXT NOT NULL REFERENCES work_days(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  period_id TEXT,
  label TEXT,
  start_time TEXT,
  end_time TEXT,
  status TEXT NOT NULL CHECK (status IN ('covered','free','planning','other')),
  teacher_id TEXT REFERENCES teachers(id),
  teacher_name TEXT,
  room TEXT CHECK (room IS NULL OR length(room) <= 40),
  subject TEXT CHECK (subject IS NULL OR length(subject) <= 160),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  copied_from_block_id TEXT,
  UNIQUE (work_day_id, position)
);
-- deliberately NO money columns on coverage_blocks.

CREATE TABLE income_payments (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,                 -- actual date money arrived
  district TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  pay_period_start TEXT,              -- optional manual link
  source TEXT NOT NULL CHECK (source IN ('subtrack','trackwell')),
  legacy_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX income_payments_legacy ON income_payments (source, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX income_payments_date ON income_payments (date) WHERE deleted_at IS NULL;

-- ---------- Expenses ----------
CREATE TABLE expense_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  color TEXT NOT NULL CHECK (color GLOB '#[0-9a-fA-F]*'),
  archived_at INTEGER,
  source TEXT NOT NULL CHECK (source IN ('expenses','trackwell')),
  legacy_id TEXT
);
CREATE UNIQUE INDEX expense_categories_legacy ON expense_categories (source, legacy_id) WHERE legacy_id IS NOT NULL;

-- Formerly "accounts". No balance column: balances are retired (archived in legacy_archive).
CREATE TABLE payment_methods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  type TEXT NOT NULL,
  archived_at INTEGER,
  source TEXT NOT NULL CHECK (source IN ('expenses','trackwell')),
  legacy_id TEXT
);
CREATE UNIQUE INDEX payment_methods_legacy ON payment_methods (source, legacy_id) WHERE legacy_id IS NOT NULL;

CREATE TABLE recurring_expenses (
  id TEXT PRIMARY KEY,
  merchant TEXT NOT NULL CHECK (length(merchant) BETWEEN 1 AND 160),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  category_id TEXT NOT NULL REFERENCES expense_categories(id),
  payment_method_id TEXT NOT NULL REFERENCES payment_methods(id),
  notes TEXT,
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly','yearly')),
  start_date TEXT NOT NULL,
  occurrences INTEGER CHECK (occurrences IS NULL OR occurrences > 0),
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  show_monthly_equivalent INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL CHECK (source IN ('expenses','trackwell')),
  legacy_id TEXT
);
CREATE UNIQUE INDEX recurring_expenses_legacy ON recurring_expenses (source, legacy_id) WHERE legacy_id IS NOT NULL;

CREATE TABLE recurring_skips (
  recurring_id TEXT NOT NULL REFERENCES recurring_expenses(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  PRIMARY KEY (recurring_id, date)
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  merchant TEXT NOT NULL CHECK (length(merchant) BETWEEN 1 AND 160),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  category_id TEXT NOT NULL REFERENCES expense_categories(id),
  payment_method_id TEXT NOT NULL REFERENCES payment_methods(id),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  recurring_id TEXT REFERENCES recurring_expenses(id),
  source TEXT NOT NULL CHECK (source IN ('expenses','trackwell')),
  legacy_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX expenses_legacy ON expenses (source, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX expenses_date ON expenses (date) WHERE deleted_at IS NULL;
-- A recurring occurrence exists at most once per date (no regeneration duplicates).
CREATE UNIQUE INDEX expenses_recurring_once ON expenses (recurring_id, date) WHERE recurring_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL CHECK (month = '*' OR month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  category_id TEXT REFERENCES expense_categories(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0)
);
CREATE UNIQUE INDEX budgets_unique ON budgets (month, ifnull(category_id, ''));

-- ---------- AI & reports ----------
CREATE TABLE ai_preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),           -- single administrator
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  sharing_level TEXT NOT NULL DEFAULT 'aggregates' CHECK (sharing_level IN ('aggregates','detail')),
  provider TEXT,
  model TEXT,
  consented_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE ai_drafts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('work_day','expense','payment')),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','rejected')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE saved_reports (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  kind TEXT NOT NULL,
  params_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- ---------- Security ----------
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,         -- SHA-256 of the cookie token; the token itself is never stored
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE login_attempts (
  client_key TEXT PRIMARY KEY,         -- hash of the client IP, or 'global'
  window_start INTEGER NOT NULL,
  failures INTEGER NOT NULL,
  locked_until INTEGER
);

-- ---------- Audit & migration ----------
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,                 -- 'user' | 'ai:<tool>' | 'import'
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','update','delete','restore')),
  before_json TEXT,
  after_json TEXT
);

CREATE TABLE import_runs (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  source TEXT NOT NULL CHECK (source IN ('subtrack','expenses')),
  backup_sha256 TEXT NOT NULL,
  dry_run INTEGER NOT NULL CHECK (dry_run IN (0, 1)),
  report_json TEXT
);

-- Write-once raw copy of each legacy document, including retired features
-- (account balances, SubTrack sync state). Never shown in the UI.
CREATE TABLE legacy_archive (
  id TEXT PRIMARY KEY,
  import_run_id TEXT NOT NULL REFERENCES import_runs(id),
  source TEXT NOT NULL,
  kv_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  archived_at INTEGER NOT NULL,
  UNIQUE (source, kv_key, sha256)
);
CREATE TRIGGER legacy_archive_write_once BEFORE UPDATE ON legacy_archive
BEGIN SELECT RAISE(ABORT, 'legacy_archive is write-once'); END;
CREATE TRIGGER legacy_archive_no_delete BEFORE DELETE ON legacy_archive
BEGIN SELECT RAISE(ABORT, 'legacy_archive is write-once'); END;
