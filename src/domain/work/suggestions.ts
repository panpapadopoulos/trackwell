import type { WorkDay } from './types';

/** Case- and whitespace-insensitive key: "  Business   Law " and "business law" match. */
export const suggestionKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export interface ClassSuggestion {
  /** The spelling shown and inserted: the one used most often (then most recently). Saved data is never rewritten. */
  value: string;
  count: number;
  lastDate: string;
  /** Teacher keys this class was recorded with. */
  teachers: Set<string>;
}

/**
 * Distinct class/subject names from saved work days: single-assignment `className`
 * and every coverage block's `subject`. Only worked/planned/cancelled records the
 * user saved; nothing is invented.
 */
export function classSuggestions(days: readonly WorkDay[]): ClassSuggestion[] {
  const groups = new Map<
    string,
    { variants: Map<string, { n: number; last: string }>; s: ClassSuggestion }
  >();
  const add = (raw: string | undefined, date: string, teacher: string | undefined) => {
    const name = raw?.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const key = suggestionKey(name);
    let g = groups.get(key);
    if (!g) {
      g = { variants: new Map(), s: { value: name, count: 0, lastDate: date, teachers: new Set() } };
      groups.set(key, g);
    }
    const v = g.variants.get(name) ?? { n: 0, last: date };
    v.n += 1;
    if (date > v.last) v.last = date;
    g.variants.set(name, v);
    g.s.count += 1;
    if (date > g.s.lastDate) g.s.lastDate = date;
    if (teacher?.trim()) g.s.teachers.add(suggestionKey(teacher));
  };
  for (const d of days) {
    add(d.className, d.date, d.teacherName);
    for (const b of d.coverage) add(b.subject, d.date, b.teacherName);
  }
  return [...groups.values()].map(({ variants, s }) => {
    const [best] = [...variants.entries()].sort(
      (a, b) => b[1].n - a[1].n || b[1].last.localeCompare(a[1].last),
    );
    return { ...s, value: best![0] };
  });
}

export interface RankedClass {
  value: string;
  /** True when this class was previously recorded with the selected teacher. */
  withTeacher: boolean;
}

/**
 * Suggestions for an input: classes recorded with `teacher` first, then by use
 * and recency; filtered by `query` (contains, ignoring case and extra spaces).
 * An exact match of the query is still listed so it can be confirmed with Enter.
 */
export function rankClasses(
  all: readonly ClassSuggestion[],
  teacher: string | undefined,
  query = '',
  limit = 8,
): RankedClass[] {
  const t = teacher?.trim() ? suggestionKey(teacher) : null;
  const q = suggestionKey(query);
  return all
    .filter((c) => !q || suggestionKey(c.value).includes(q))
    .map((c) => ({ c, withTeacher: t !== null && c.teachers.has(t) }))
    .sort(
      (a, b) =>
        Number(b.withTeacher) - Number(a.withTeacher) ||
        Number(suggestionKey(b.c.value).startsWith(q)) - Number(suggestionKey(a.c.value).startsWith(q)) ||
        b.c.count - a.c.count ||
        b.c.lastDate.localeCompare(a.c.lastDate) ||
        a.c.value.localeCompare(b.c.value),
    )
    .slice(0, limit)
    .map(({ c, withTeacher }) => ({ value: c.value, withTeacher }));
}
