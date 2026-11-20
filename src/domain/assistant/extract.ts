export interface ParsedDay {
  dateWords: string;
  employmentType?: 'permanent' | 'regular';
  schoolName?: string;
  role?: 'aide';
  dayType?: 0.5;
  blocks: { period: string; status: 'covered' | 'free' | 'planning' | 'other'; teacherName?: string }[];
  teachers: string[];
}

const HONORIFIC = /\b(Mr|Mrs|Ms|Miss|Dr|Coach)\./g;
const NAME = /\b(Mr|Mrs|Ms|Miss|Dr|Coach)\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?)/u;
const PERIOD_TOKEN =
  /\b(\d{1,2})(?:st|nd|rd|th)?\b|\b(first|second|third|fourth|fifth|sixth|seventh|eighth)\b|\b(plc|tutorial|pd)\b/gi;

function periodsIn(clause: string): string[] {
  const out: string[] = [];
  for (const m of clause.matchAll(PERIOD_TOKEN)) out.push((m[1] ?? m[2] ?? m[3])!);
  return out;
}

/**
 * Deterministic extraction of the periods a sentence names. Two uses:
 * 1. the MOCK model's "language understanding";
 * 2. the cross-check that compares a model's proposed draft with the user's own
 *    words (omitted, duplicated or misassigned periods), when the words make it
 *    identifiable. It only recognises common phrasings; anything it can't read
 *    produces no expectation, so it never blocks a draft it doesn't understand.
 */
export function parseDay(text: string): ParsedDay {
  const t = text.replace(HONORIFIC, '$1');
  const date =
    /\b(\d{4}-\d{2}-\d{2})\b/.exec(t)?.[1] ??
    /\b(yesterday|today)\b/i.exec(t)?.[1] ??
    /\b((?:last\s+)?(?:monday|tuesday|wednesday|thursday|friday))\b/i.exec(t)?.[1] ??
    'today';
  const parsed: ParsedDay = { dateWords: date.toLowerCase(), blocks: [], teachers: [] };
  if (/\bregular\b/i.test(t)) parsed.employmentType = 'regular';
  else if (/\bpermanent\b/i.test(t)) parsed.employmentType = 'permanent';
  const school =
    /\bat\s+([A-Z][\p{L}'-]*(?:\s+[A-Z][\p{L}'-]*)*\s+(?:High School|Middle School|Elementary|School|HS))/u.exec(
      t,
    );
  if (school) parsed.schoolName = school[1];
  if (/\b(as an? )?(assistant|aide)\b/i.test(t)) parsed.role = 'aide';
  if (/\bhalf[- ]day\b/i.test(t)) parsed.dayType = 0.5;

  for (const clause of t.split(/[,;.]|\band then\b|\band (?=(?:I |covered|had|was|then))/i)) {
    const c = clause.trim();
    if (!c) continue;
    const ps = periodsIn(
      c
        .replace(NAME, '')
        .replace(/\d{4}-\d{2}-\d{2}/g, '')
        .replace(/\b(room|rm)\s*#?\d+\w*|\b[NSEW]\d{2,}\b/gi, ''), // room numbers aren't periods
    );
    if (!ps.length) continue;
    const name = NAME.exec(c);
    let status: ParsedDay['blocks'][number]['status'] | null = null;
    if (/\b(free|off|prep)\b/i.test(c)) status = 'free';
    else if (/\bplanning\b/i.test(c)) status = 'planning';
    else if (name) status = 'covered'; // "Ms. Gomez period 2" in a list of covers
    if (!status) continue;
    const teacher = status === 'covered' && name ? `${name[1]}. ${name[2]}` : undefined;
    if (teacher && !parsed.teachers.includes(teacher)) parsed.teachers.push(teacher);
    for (const p of ps)
      parsed.blocks.push({ period: p, status, ...(teacher ? { teacherName: teacher } : {}) });
  }
  return parsed;
}

/** Surname used to compare teacher names ("Mr. Smith" ≈ "Smith" ≈ "mr smith"). */
export function surname(name: string | undefined): string {
  const words = (name ?? '')
    .replace(/\b(mr|mrs|ms|miss|mx|dr|coach)\b\.?/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return (words[words.length - 1] ?? '').toLowerCase();
}
