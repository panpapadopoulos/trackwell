/** The legacy oracle must stay byte-identical to the original repositories (when they're present). */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const pairs: Array<[string, string]> = [
  ['src/domain/legacy/subtrack/utils/payroll.ts', '../subtrack/utils/payroll.ts'],
  ['src/domain/legacy/subtrack/types.ts', '../subtrack/types.ts'],
  ['src/domain/legacy/expenses/utils/recurring.ts', '../expenses/utils/recurring.ts'],
  ['src/domain/legacy/expenses/utils/format.ts', '../expenses/utils/format.ts'],
  ['src/domain/legacy/expenses/types.ts', '../expenses/types.ts'],
];

describe('legacy oracle integrity', () => {
  for (const [copy, original] of pairs) {
    const orig = resolve(root, original);
    it.skipIf(!existsSync(orig))(`${copy} is byte-identical to ${original}`, () => {
      expect(readFileSync(resolve(root, copy))).toEqual(readFileSync(orig));
    });
  }
});
