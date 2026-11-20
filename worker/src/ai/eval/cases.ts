/**
 * Small evaluation set for Smart Assignment Entry. Synthetic names only.
 * Run offline with the mock model (`assistant.eval.test.ts`, every `npm test`)
 * and against genuine Workers AI with `npm run ai:eval` (drafts only, no save).
 * Dates are explicit so the expected bell schedule never depends on the run date.
 */
import type { DraftResponse } from '../../../../src/shared/assistant';
import { surname } from '../../../../src/domain/assistant/extract';

export interface EvalCase {
  id: string;
  covers: string;
  message: string;
  expect: {
    date: string;
    scheduleId: string;
    employmentType: 'permanent' | 'regular';
    /** [periodId, status, teacher surname or undefined] in schedule order. */
    blocks: [string, 'covered' | 'free' | 'planning' | 'other', string?][];
  };
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'traditional-example',
    covers: 'Traditional (Monday), two teachers, a free period, "periods 1 and 3"',
    message:
      'On 2026-11-16 I covered Mr. Smith during periods 1 and 3, had period 5 free, and covered Mrs. Jones during period 7.',
    expect: {
      date: '2026-11-16',
      scheduleId: 'mhs-2026-27-traditional',
      employmentType: 'permanent',
      blocks: [
        ['P1', 'covered', 'smith'],
        ['P3', 'covered', 'smith'],
        ['P5', 'free'],
        ['P7', 'covered', 'jones'],
      ],
    },
  },
  {
    id: 'a-block-ordinals-planning',
    covers: 'A Block (Wednesday), ordinal words, a planning period',
    message:
      'On 2026-11-18 I covered Ms. Patel first period, period 3 was planning, and I covered Mr. Brown during period 7.',
    expect: {
      date: '2026-11-18',
      scheduleId: 'mhs-2026-27-a-block',
      employmentType: 'permanent',
      blocks: [
        ['P1', 'covered', 'patel'],
        ['P3', 'planning'],
        ['P7', 'covered', 'brown'],
      ],
    },
  },
  {
    id: 'b-block-regular',
    covers: 'B Block (Thursday), regular day with an explicit school',
    message:
      'On 2026-11-12 I was a regular sub at Munster High School and covered Mrs. Lee during periods 2 and 4, and had period 6 free.',
    expect: {
      date: '2026-11-12',
      scheduleId: 'mhs-2026-27-b-block',
      employmentType: 'regular',
      blocks: [
        ['P2', 'covered', 'lee'],
        ['P4', 'covered', 'lee'],
        ['P6', 'free'],
      ],
    },
  },
  {
    id: 'mostly-free',
    covers: 'Traditional (Friday), more free periods than covers',
    message: 'On 2026-11-13 I covered Coach Rivera during period 2 and had periods 4 and 6 free.',
    expect: {
      date: '2026-11-13',
      scheduleId: 'mhs-2026-27-traditional',
      employmentType: 'permanent',
      blocks: [
        ['P2', 'covered', 'rivera'],
        ['P4', 'free'],
        ['P6', 'free'],
      ],
    },
  },
  {
    id: 'three-teachers-list',
    covers: 'Traditional (Tuesday, regular default + school given), three teachers in a list',
    message:
      'On 2026-11-17 I was at Munster High School and covered Mr. Adams period 1, Ms. Gomez period 2, and Dr. Chen periods 5 and 6.',
    expect: {
      date: '2026-11-17',
      scheduleId: 'mhs-2026-27-traditional',
      employmentType: 'regular',
      blocks: [
        ['P1', 'covered', 'adams'],
        ['P2', 'covered', 'gomez'],
        ['P5', 'covered', 'chen'],
        ['P6', 'covered', 'chen'],
      ],
    },
  },
];

/** Returns the differences between a draft and the case's expectation (empty = pass). */
export function scoreDraft(c: EvalCase, d: DraftResponse['draft']): string[] {
  const out: string[] = [];
  if (d.date !== c.expect.date) out.push(`date ${d.date} ≠ ${c.expect.date}`);
  if (d.scheduleId !== c.expect.scheduleId) out.push(`schedule ${d.scheduleId} ≠ ${c.expect.scheduleId}`);
  if (d.employmentType !== c.expect.employmentType)
    out.push(`type ${d.employmentType} ≠ ${c.expect.employmentType}`);
  const got = d.coverage.map((b) => [
    b.periodId,
    b.status,
    b.teacherName ? surname(b.teacherName) : undefined,
  ]);
  const want = c.expect.blocks.map(([p, s, t]) => [p, s, t]);
  if (JSON.stringify(got) !== JSON.stringify(want))
    out.push(`blocks ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
  return out;
}
