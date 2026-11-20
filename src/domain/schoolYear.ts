import type { ISODate } from './dates';

/** School year runs Aug 1 – Jul 31; key "2026-27" (legacy-compatible). */
export type SchoolYearKey = string;

export function schoolYearKey(date: ISODate): SchoolYearKey {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const start = month >= 8 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

export function schoolYearRange(key: SchoolYearKey): { from: ISODate; to: ISODate } {
  const start = Number(key.slice(0, 4));
  return { from: `${start}-08-01`, to: `${start + 1}-07-31` };
}

export function schoolYearLabel(key: SchoolYearKey): string {
  return `${key.slice(0, 4)}–${key.slice(5)}`;
}
