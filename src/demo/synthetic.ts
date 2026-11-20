/**
 * SYNTHETIC DEMONSTRATION DATA. Not real records.
 *
 * Deterministic (seeded) so screenshots and tests are reproducible. Every
 * money figure is DERIVED: payments are computed from the work days they pay
 * for through the real pay engine, recurring expenses come from the real
 * generator, and totals are never typed in. Schools and teachers are fictional
 * (Munster High School appears only because it's the user's configured default
 * permanent school). No value here comes from the private legacy backups.
 */
import { addDays, monthKey, weekday, type ISODate } from '../domain/dates';
import { expectedPay, hoursBetween } from '../domain/pay/engine';
import { payPeriodFor } from '../domain/pay/periods';
import { PAY_RULES_V1 } from '../domain/pay/rules';
import { generateDue } from '../domain/expenses/recurring';
import type { Category, Expense, ExpenseData, PaymentMethod, RecurringPlan } from '../domain/expenses/types';
import type { CoverageBlock, IncomePayment, WorkDay } from '../domain/work/types';

export interface Dataset {
  kind: 'synthetic' | 'empty' | 'worst-case';
  label: string;
  work: { days: WorkDay[]; payments: IncomePayment[] };
  expenses: ExpenseData;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEACHERS = [
  'Ms. Alvarez',
  'Mr. Brennan',
  'Ms. Castillo',
  'Mr. Dubois',
  'Ms. Ellison',
  'Mr. Fairbanks',
  'Ms. Grant',
  'Mr. Hollis',
  'Ms. Ibarra',
  'Mr. Jansen',
  'Ms. Kowalczyk',
  'Mr. Lindqvist',
  'Ms. Moreau',
  'Mr. Novak',
  'Ms. Okafor',
  'Mr. Petrov',
  'Ms. Quintero',
  'Mr. Rasmussen',
  'Ms. Sato',
  'Mr. Thornton',
  'Ms. Whitaker',
  'Mr. Yilmaz',
  'Ms. Zielinski',
];
const MHS_SUBJECTS = [
  'Biology',
  'Algebra II',
  'U.S. History',
  'English 10',
  'Chemistry',
  'Spanish I',
  'Geometry',
  'Health',
  'Physics',
  'Art I',
];
const ROOMS = ['N115', 'N161', 'N204', 'N220', 'S102', 'S118', 'E210', 'W031', 'C140'];
const REGULAR_SCHOOLS: Array<{ name: string; district: string; classes: string[] }> = [
  {
    name: 'Birchwood Elementary',
    district: 'Munster',
    classes: ['Grade 2', 'Grade 3', 'Grade 5', 'Music', 'Kindergarten'],
  },
  { name: 'Harbor Point Middle', district: 'Munster', classes: ['Science 7', 'Math 8', 'ELA 6', 'Band'] },
  { name: 'Elm Street Elementary', district: 'Munster', classes: ['Grade 1', 'Grade 4', 'Art', 'PE'] },
  {
    name: 'Lakeview Demo High School',
    district: 'Munster',
    classes: ['Chemistry', 'World History', 'English 11'],
  },
  { name: 'Prairie View Elementary', district: 'Highland', classes: ['Grade 3', 'Grade 4', 'Resource'] },
  { name: 'Ridgeline Middle', district: 'Highland', classes: ['Math 7', 'Science 6', 'Social Studies 8'] },
];

/** A school-calendar approximation for the fictional schools (not an official calendar). */
function isSchoolDay(d: ISODate): boolean {
  const wd = weekday(d);
  if (wd === 0 || wd === 6) return false;
  const md = d.slice(5);
  if (md >= '06-05' && md <= '08-18') return false; // summer
  if (md >= '12-21' || md <= '01-04') return false; // winter break
  if (md >= '03-23' && md <= '03-29') return false; // spring break
  if (md >= '11-26' && md <= '11-28' && (wd === 4 || wd === 5 || wd === 3)) return false; // Thanksgiving
  return true;
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

export function syntheticDataset(today: ISODate, seed = 20261118): Dataset {
  const r = mulberry32(seed);
  const days: WorkDay[] = [];
  let id = 0;
  const nextId = (p: string) => `${p}-${(++id).toString(36)}`;

  for (let d: ISODate = '2024-08-19'; d < today; d = addDays(d, 1)) {
    if (!isSchoolDay(d)) continue;
    const wd = weekday(d);
    const newArrangement = d >= PAY_RULES_V1.outstandingTrackingStart;
    const permanentDay = newArrangement && (wd === 1 || wd === 3 || wd === 5);

    if (permanentDay) {
      if (r() > 0.94) continue; // occasional absence / no school
      const multiple = r() < 0.4;
      const coverage: CoverageBlock[] = [];
      if (multiple) {
        for (let p = 1; p <= 7; p++) {
          const roll = r();
          const status: CoverageBlock['status'] = roll < 0.55 ? 'covered' : roll < 0.85 ? 'free' : 'planning';
          coverage.push({
            id: nextId('b'),
            periodId: `P${p}`,
            label: `Period ${p}`,
            status,
            ...(status === 'covered'
              ? { teacherName: pick(r, TEACHERS), room: pick(r, ROOMS), subject: pick(r, MHS_SUBJECTS) }
              : {}),
          });
        }
        if (!coverage.some((b) => b.status === 'covered'))
          coverage[0] = {
            ...coverage[0]!,
            status: 'covered',
            teacherName: pick(r, TEACHERS),
            room: pick(r, ROOMS),
            subject: pick(r, MHS_SUBJECTS),
          };
      }
      days.push({
        id: nextId('w'),
        date: d,
        status: 'worked',
        employmentType: 'permanent',
        role: 'teacher',
        format: multiple ? 'multiple' : 'single',
        schoolName: PAY_RULES_V1.permanentDefaultSchool,
        district: 'Munster',
        dayType: 1,
        startTime: PAY_RULES_V1.permanentDefaultStart,
        endTime: PAY_RULES_V1.permanentDefaultEnd,
        hours: hoursBetween(PAY_RULES_V1.permanentDefaultStart, PAY_RULES_V1.permanentDefaultEnd),
        ...(multiple ? {} : { className: pick(r, MHS_SUBJECTS), teacherName: pick(r, TEACHERS) }),
        scheduleId: wd === 3 ? 'mhs-2026-27-a-block' : 'mhs-2026-27-traditional',
        coverage,
        source: { system: 'synthetic' },
      });
      continue;
    }

    const workRate = d < '2025-08-01' ? 0.5 : d < '2026-08-01' ? 0.64 : 0.78;
    if (r() > workRate) continue;
    const school =
      d < '2025-08-01' && r() < 0.3
        ? pick(r, REGULAR_SCHOOLS.slice(4))
        : pick(r, REGULAR_SCHOOLS.slice(0, 4));
    const aide = r() < 0.08;
    const half = !aide && r() < 0.15;
    const start = half ? (r() < 0.5 ? '08:00' : '11:30') : '08:00';
    const end = half ? (start === '08:00' ? '11:30' : '15:00') : '15:00';
    days.push({
      id: nextId('w'),
      date: d,
      status: 'worked',
      employmentType: 'regular',
      role: aide ? 'aide' : 'teacher',
      format: 'single',
      schoolName: school.name,
      district: school.district,
      dayType: half ? 0.5 : 1,
      startTime: start,
      endTime: end,
      hours: hoursBetween(start, end),
      payRate: aide ? PAY_RULES_V1.aideHourlyRate : PAY_RULES_V1.teacherFullDayRate,
      className: pick(r, school.classes),
      teacherName: pick(r, TEACHERS),
      coverage: [],
      source: { system: 'synthetic' },
    });
  }

  // Payments: one per (period, district), on the expected payday, for paydays already passed.
  // Amount = the period's expected net through the real engine; a few carry a small
  // deduction so "received" isn't always identical to "expected".
  const groups = new Map<string, { payday: ISODate; district: string; cents: number }>();
  for (const day of days) {
    const p = payPeriodFor(day.date);
    const key = `${p.start}|${day.district}`;
    const g = groups.get(key) ?? { payday: p.expectedPayday, district: day.district, cents: 0 };
    g.cents += expectedPay(day).netCents;
    groups.set(key, g);
  }
  const payments: IncomePayment[] = [];
  for (const [key, g] of [...groups.entries()].sort()) {
    if (g.payday >= today) continue;
    const adjust = r() < 0.15 ? -Math.round(r() * 1500) : 0;
    payments.push({
      id: `pay-${key}`,
      date: g.payday,
      district: g.district,
      amountCents: g.cents + adjust,
      source: { system: 'synthetic' },
    });
  }
  // Leave the most recent past payday unpaid so the "awaiting payment" state is visible.
  const lastPaid = payments.filter((p) => p.district === 'Munster').at(-1);
  const work = { days, payments: payments.filter((p) => p !== lastPaid) };

  return { kind: 'synthetic', label: 'Synthetic demo data', work, expenses: syntheticExpenses(today, r) };
}

const CATEGORIES: Category[] = [
  { id: 'cat-groceries', name: 'Groceries', color: '#4f9d69' },
  { id: 'cat-dining', name: 'Dining out', color: '#c9733a' },
  { id: 'cat-transport', name: 'Transport', color: '#5b86c5' },
  { id: 'cat-housing', name: 'Housing', color: '#8a6fb5' },
  { id: 'cat-utilities', name: 'Utilities', color: '#3f9aa0' },
  { id: 'cat-subscriptions', name: 'Subscriptions', color: '#b5677e' },
  { id: 'cat-health', name: 'Health', color: '#a08c3a' },
  { id: 'cat-other', name: 'Other', color: '#7d7a75' },
];
const METHODS: PaymentMethod[] = [
  { id: 'pm-debit', name: 'Debit card', type: 'Debit card' },
  { id: 'pm-credit', name: 'Credit card', type: 'Credit card' },
  { id: 'pm-cash', name: 'Cash', type: 'Cash' },
];
const PLANS: RecurringPlan[] = [
  {
    id: 'rp-rent',
    merchant: 'Rent (shared apartment)',
    amountCents: 55000,
    categoryId: 'cat-housing',
    paymentMethodId: 'pm-debit',
    frequency: 'monthly',
    startDate: '2024-09-01',
    active: true,
  },
  {
    id: 'rp-phone',
    merchant: 'Mobile phone plan',
    amountCents: 4500,
    categoryId: 'cat-utilities',
    paymentMethodId: 'pm-credit',
    frequency: 'monthly',
    startDate: '2024-09-12',
    active: true,
  },
  {
    id: 'rp-internet',
    merchant: 'Home internet',
    amountCents: 4999,
    categoryId: 'cat-utilities',
    paymentMethodId: 'pm-credit',
    frequency: 'monthly',
    startDate: '2024-09-20',
    active: true,
  },
  {
    id: 'rp-stream',
    merchant: 'Streaming service',
    amountCents: 1549,
    categoryId: 'cat-subscriptions',
    paymentMethodId: 'pm-credit',
    frequency: 'monthly',
    startDate: '2025-01-08',
    active: true,
  },
  {
    id: 'rp-gym',
    merchant: 'Gym membership',
    amountCents: 2999,
    categoryId: 'cat-health',
    paymentMethodId: 'pm-credit',
    frequency: 'monthly',
    startDate: '2025-02-01',
    active: true,
  },
  {
    id: 'rp-insurance',
    merchant: 'Renters insurance',
    amountCents: 16800,
    categoryId: 'cat-housing',
    paymentMethodId: 'pm-debit',
    frequency: 'yearly',
    startDate: '2024-12-02',
    active: true,
    showMonthlyEquivalent: true,
  },
  {
    id: 'rp-course',
    merchant: 'Certification course',
    amountCents: 22500,
    categoryId: 'cat-other',
    paymentMethodId: 'pm-credit',
    frequency: 'monthly',
    startDate: '2026-01-15',
    occurrences: 4,
    active: false,
  },
];
const VARIABLE: Array<{
  cat: string;
  merchants: string[];
  perWeek: number;
  min: number;
  max: number;
  method: string;
}> = [
  {
    cat: 'cat-groceries',
    merchants: ['Corner Market', 'Fresh Fields Grocery', 'Bulk Barn'],
    perWeek: 1.1,
    min: 1800,
    max: 7200,
    method: 'pm-debit',
  },
  {
    cat: 'cat-dining',
    merchants: ['Lakeside Diner', 'Noodle House', 'Campus Coffee', 'Pizza Corner'],
    perWeek: 0.8,
    min: 600,
    max: 2800,
    method: 'pm-credit',
  },
  {
    cat: 'cat-transport',
    merchants: ['Fuel stop', 'Parking garage', 'Car wash'],
    perWeek: 0.7,
    min: 1000,
    max: 4200,
    method: 'pm-credit',
  },
  {
    cat: 'cat-health',
    merchants: ['Pharmacy', 'Dental co-pay'],
    perWeek: 0.1,
    min: 1000,
    max: 6000,
    method: 'pm-debit',
  },
  {
    cat: 'cat-other',
    merchants: ['Bookstore', 'Hardware store', 'Gift shop', 'Classroom supplies'],
    perWeek: 0.35,
    min: 600,
    max: 4000,
    method: 'pm-cash',
  },
];

function syntheticExpenses(today: ISODate, r: () => number): ExpenseData {
  const expenses: Expense[] = [];
  let n = 0;
  for (let d: ISODate = '2024-09-01'; d <= today; d = addDays(d, 1)) {
    for (const v of VARIABLE) {
      if (r() < v.perWeek / 7) {
        expenses.push({
          id: `ex-${(++n).toString(36)}`,
          date: d,
          merchant: pick(r, v.merchants),
          amountCents: v.min + Math.round(r() * (v.max - v.min)),
          categoryId: v.cat,
          paymentMethodId: v.method,
          source: { system: 'synthetic' },
        });
      }
    }
    if (d.slice(8) === '18') {
      expenses.push({
        id: `ex-${(++n).toString(36)}`,
        date: d,
        merchant: 'Electric utility',
        amountCents: 3500 + Math.round(r() * 3500),
        categoryId: 'cat-utilities',
        paymentMethodId: 'pm-debit',
        source: { system: 'synthetic' },
      });
    }
  }
  const plans = PLANS.map((p) => (p.id === 'rp-course' ? { ...p, active: true } : p));
  const gen = generateDue(plans, [], [], today, (pid, date) => `${pid}:${date}`);
  const all = [
    ...expenses,
    ...gen.newExpenses.map((e) => ({ ...e, source: { system: 'synthetic' as const } })),
  ];
  return {
    expenses: all.sort((a, b) => a.date.localeCompare(b.date)),
    categories: CATEGORIES,
    paymentMethods: METHODS,
    recurringPlans: plans.map((p) => (gen.completedPlanIds.includes(p.id) ? { ...p, active: false } : p)),
    recurringSkips: [],
    budgets: [
      { id: 'bu-all', month: '*', categoryId: null, amountCents: 140000 },
      { id: 'bu-groceries', month: '*', categoryId: 'cat-groceries', amountCents: 32000 },
      { id: 'bu-dining', month: '*', categoryId: 'cat-dining', amountCents: 11000 },
      { id: 'bu-transport', month: '*', categoryId: 'cat-transport', amountCents: 16000 },
      { id: 'bu-other', month: '*', categoryId: 'cat-other', amountCents: 8000 },
    ],
  };
}

export function emptyDataset(): Dataset {
  return {
    kind: 'empty',
    label: 'Empty (first run)',
    work: { days: [], payments: [] },
    expenses: {
      expenses: [],
      categories: [],
      paymentMethods: [],
      recurringPlans: [],
      recurringSkips: [],
      budgets: [],
    },
  };
}

/** Worst-case data for break-ui: extreme names, amounts and volumes. */
export function worstCaseDataset(today: ISODate): Dataset {
  const base = syntheticDataset(today, 7);
  const longSchool =
    'Dr. Martin Luther King Jr. Memorial Intermediate School for the Performing and Visual Arts';
  const longTeacher = 'Ms. Maximiliana Wolfeschlegelsteinhausenbergerdorff-Featherstonehaugh';
  const days = base.work.days.map((d, i) =>
    i % 3 === 0
      ? {
          ...d,
          schoolName: longSchool,
          teacherName: longTeacher,
          className: 'Advanced Placement Comparative Government and Politics (Honors, Section 4B)',
        }
      : d,
  );
  const lastDay = days.filter((d) => d.status === 'worked').at(-1)!;
  days.push({
    ...lastDay,
    id: 'worst-multi',
    date: lastDay.date === today ? addDays(today, -1) : lastDay.date,
    format: 'multiple',
    coverage: Array.from({ length: 12 }, (_, i) => ({
      id: `wb${i}`,
      label: `Period ${i + 1}`,
      status: 'covered' as const,
      teacherName: `${longTeacher} ${i}`,
      room: 'Annex Building West, Room 1104-B (portable)',
      subject: 'Interdisciplinary Studies: Science, Technology, Engineering, Arts & Mathematics',
    })),
  });
  const bigPayment: IncomePayment = {
    id: 'worst-big',
    date: addDays(today, -40),
    district: 'A district with an unusually long official name',
    amountCents: 123_456_789_00,
  };
  const hugeExpense: Expense = {
    id: 'worst-huge',
    date: today,
    merchant: `${'Extraordinarily Long Merchant Name '.repeat(4)}LLC`,
    amountCents: 98_765_432_10,
    categoryId: 'cat-long',
    paymentMethodId: 'pm-debit',
  };
  const many: Expense[] = [];
  for (let i = 0; i < 3000; i++) {
    const d = addDays(today, -(i % 700));
    many.push({
      id: `bulk-${i}`,
      date: d,
      merchant: 'Bulk',
      amountCents: 1 + (i % 97),
      categoryId: 'cat-groceries',
      paymentMethodId: 'pm-cash',
    });
  }
  return {
    kind: 'worst-case',
    label: 'Worst case (stress test)',
    work: { days, payments: [...base.work.payments, bigPayment] },
    expenses: {
      ...base.expenses,
      categories: [
        ...base.expenses.categories,
        {
          id: 'cat-long',
          name: 'Professional development, licensure renewals and classroom materials',
          color: '#a05a8c',
        },
      ],
      expenses: [...base.expenses.expenses, hugeExpense, ...many],
      budgets: [{ id: 'b-tiny', month: monthKey(today), categoryId: null, amountCents: 1 }],
    },
  };
}

/** break-ui "One" state: a single record of everything, so every count is exactly 1. */
export function oneDataset(today: ISODate): Dataset {
  const day = addDays(today, -((weekday(today) + 6) % 7) - 7); // Monday last week
  const work: WorkDay = {
    id: 'one-w',
    date: day,
    status: 'worked',
    employmentType: 'permanent',
    role: 'teacher',
    format: 'multiple',
    schoolName: PAY_RULES_V1.permanentDefaultSchool,
    district: 'Munster',
    dayType: 1,
    startTime: PAY_RULES_V1.permanentDefaultStart,
    endTime: PAY_RULES_V1.permanentDefaultEnd,
    hours: hoursBetween(PAY_RULES_V1.permanentDefaultStart, PAY_RULES_V1.permanentDefaultEnd),
    coverage: [
      { id: 'one-b', label: 'Period 1', status: 'covered', teacherName: 'Jo', room: 'N1', subject: 'Art' },
    ],
    source: { system: 'synthetic' },
  };
  const prior = payPeriodFor(addDays(day, -14));
  return {
    kind: 'synthetic',
    label: 'One of each',
    work: {
      days: [
        work,
        { ...work, id: 'one-w0', date: prior.start, format: 'single', coverage: [], className: 'Art' },
      ],
      payments: [
        {
          id: 'one-p',
          date: prior.expectedPayday,
          district: 'Munster',
          amountCents: 11427,
          source: { system: 'synthetic' },
        },
      ],
    },
    expenses: {
      expenses: [
        {
          id: 'one-e',
          date: today,
          merchant: 'Café',
          amountCents: 450,
          categoryId: 'c1',
          paymentMethodId: 'm1',
        },
      ],
      categories: [{ id: 'c1', name: 'Dining out', color: '#c9733a' }],
      paymentMethods: [{ id: 'm1', name: 'Cash', type: 'Cash' }],
      recurringPlans: [
        {
          id: 'r1',
          merchant: 'Phone',
          amountCents: 4500,
          categoryId: 'c1',
          paymentMethodId: 'm1',
          frequency: 'monthly',
          startDate: addDays(today, 3),
          active: true,
        },
      ],
      recurringSkips: [],
      budgets: [{ id: 'b1', month: '*', categoryId: 'c1', amountCents: 100 }],
    },
  };
}
