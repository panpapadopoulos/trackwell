import { describe, expect, it } from 'vitest';
import { classSuggestions, rankClasses } from './suggestions';
import type { WorkDay } from './types';

const day = (date: string, p: Partial<WorkDay>): WorkDay => ({
  id: date,
  date,
  status: 'worked',
  employmentType: 'regular',
  role: 'teacher',
  format: 'single',
  schoolName: 'Synthetic High',
  district: 'Synthetic',
  dayType: 1,
  startTime: '08:00',
  endTime: '15:00',
  hours: 7,
  coverage: [],
  ...p,
});

const days: WorkDay[] = [
  day('2026-09-01', { className: 'Mathematics', teacherName: 'Mr. Alpha' }),
  day('2026-09-02', { className: '  mathematics ', teacherName: 'Ms. Beta' }),
  day('2026-09-03', { className: 'Mathematics' }),
  day('2026-09-04', {
    format: 'multiple',
    coverage: [
      { id: 'a', status: 'covered', teacherName: 'Ms. Beta', subject: 'Business  Law' },
      { id: 'b', status: 'covered', teacherName: 'Mr. Gamma', subject: 'English' },
      { id: 'c', status: 'free' },
    ],
  }),
  day('2026-09-05', { className: 'business law', teacherName: 'Mr. Alpha' }),
  day('2026-09-06', { className: 'Science' }),
];

describe('classSuggestions', () => {
  const all = classSuggestions(days);
  it('merges case and whitespace variants into one suggestion', () => {
    expect(all.map((c) => c.value.toLowerCase()).sort()).toEqual([
      'business law',
      'english',
      'mathematics',
      'science',
    ]);
  });
  it('shows the most-used original spelling (then most recent), never a rewritten one', () => {
    expect(all.find((c) => c.value === 'Mathematics')!.count).toBe(3);
    // "Business  Law" (block) and "business law" (single) each once: the most recent spelling wins.
    expect(all.find((c) => c.value.toLowerCase() === 'business law')!.value).toBe('business law');
  });
  it('reads single-assignment classes and coverage subjects, and leaves the saved days untouched', () => {
    const before = JSON.stringify(days);
    classSuggestions(days);
    expect(JSON.stringify(days)).toBe(before);
    expect(all.some((c) => c.value === 'English')).toBe(true);
  });
});

describe('rankClasses', () => {
  const all = classSuggestions(days);
  it('puts classes previously recorded with the selected teacher first', () => {
    expect(rankClasses(all, 'mr. alpha')).toEqual([
      { value: 'Mathematics', withTeacher: true },
      { value: 'business law', withTeacher: true },
      { value: 'Science', withTeacher: false },
      { value: 'English', withTeacher: false },
    ]);
  });
  it('filters as the user types, ignoring case and extra spaces, prefix matches first', () => {
    expect(rankClasses(all, undefined, '  ENG').map((c) => c.value)).toEqual(['English']);
    expect(rankClasses(all, undefined, 'law').map((c) => c.value)).toEqual(['business law']);
    expect(rankClasses(all, undefined, 'xyz')).toEqual([]);
  });
  it('without a teacher, orders by use then recency, and respects the limit', () => {
    expect(rankClasses(all, '', '', 2).map((c) => c.value)).toEqual(['Mathematics', 'business law']);
  });
});
