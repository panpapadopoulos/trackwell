/**
 * The subset of Cloudflare D1 that Trackwell uses. The real `D1Database`
 * satisfies it; tests supply an adapter over node:sqlite (same SQL dialect).
 * All SQL is parameterized via bind(); no string-built values ever reach SQL.
 */
export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface D1Like {
  prepare(sql: string): D1Stmt;
  /** Executes atomically: all statements commit or none do. */
  batch(stmts: D1Stmt[]): Promise<Array<{ results?: unknown[]; meta: { changes: number } }>>;
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
}

export function isForeignKeyViolation(e: unknown): boolean {
  return e instanceof Error && /FOREIGN KEY constraint failed/i.test(e.message);
}
