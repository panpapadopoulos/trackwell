/**
 * Writes .local/seed.sql: the SYNTHETIC demo dataset as SQL for the LOCAL D1.
 * Apply with: npm run db:seed:synthetic
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { todayISO } from '../src/domain/dates';
import { syntheticDataset } from '../src/demo/synthetic';
import { expenseDataSql, paymentSql, workDaySql } from '../src/domain/migration/sqlgen';

const ds = syntheticDataset(todayISO());
const o = { source: 'trackwell' as const, now: Date.now() };
const lines = [
  '-- SYNTHETIC demo data (not real records).',
  ...ds.work.days.flatMap((d) => workDaySql(d, o)),
  ...ds.work.payments.map((p) => paymentSql(p, o)),
  ...expenseDataSql(ds.expenses, o),
];
mkdirSync('.local', { recursive: true });
writeFileSync('.local/seed.sql', `${lines.join('\n')}\n`);
console.log(`Wrote .local/seed.sql (${lines.length - 1} statements, synthetic).`);
