/**
 * D1-compatible adapter over node:sqlite for tests (same SQLite engine family
 * as D1). Applies the real migrations; batch() is a real transaction.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { D1Like, D1Stmt } from '../../worker/src/db';

const MIGRATIONS = resolve(__dirname, '../../migrations');

export function migratedDb(): { db: D1Like; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS)
    .filter((x) => x.endsWith('.sql'))
    .sort())
    raw.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return { db: adapt(raw), raw };
}

function adapt(raw: DatabaseSync): D1Like {
  const stmt = (
    sql: string,
    args: unknown[] = [],
  ): D1Stmt & { exec(): { results: unknown[]; meta: { changes: number } } } => {
    const norm = args.map((a) =>
      a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a,
    ) as SQLInputValue[];
    const exec = () => {
      const s = raw.prepare(sql);
      if (/^\s*(SELECT|WITH)/i.test(sql))
        return { results: s.all(...norm) as unknown[], meta: { changes: 0 } };
      const r = s.run(...norm);
      return { results: [], meta: { changes: Number(r.changes) } };
    };
    return {
      bind: (...v: unknown[]) => stmt(sql, v),
      all: async <T>() => ({ results: exec().results as T[] }),
      first: async <T>() => (exec().results[0] as T | undefined) ?? null,
      run: async () => ({ meta: exec().meta }),
      exec,
    };
  };
  return {
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => {
      raw.exec('BEGIN');
      try {
        const out = stmts.map((s) => (s as ReturnType<typeof stmt>).exec());
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
