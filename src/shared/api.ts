/**
 * The API contract, shared by the browser and the Worker. Every write is
 * validated with these schemas on the server (and before sending on the client).
 * Limits mirror the CHECK constraints in migrations/0001_init.sql.
 */
import { z } from 'zod';
import { isISODate } from '../domain/dates';

export const isoDate = z.string().refine(isISODate, 'Enter a real date (YYYY-MM-DD)');
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 08:00');
const cents = z
  .number()
  .int('Amount must be in whole cents')
  .positive('Amount must be more than $0')
  .max(1_000_000_000_00);
const name = (max: number) => z.string().trim().min(1, 'Required').max(max, `At most ${max} characters`);
const optText = (max: number) => z.string().trim().max(max, `At most ${max} characters`).optional();

export const CoverageBlockInput = z
  .object({
    periodId: z.string().max(20).optional(),
    label: optText(40),
    startTime: hhmm.optional(),
    endTime: hhmm.optional(),
    status: z.enum(['covered', 'free', 'planning', 'other']),
    teacherName: optText(120),
    room: optText(40),
    subject: optText(160),
    notes: optText(1000),
    copiedFromBlockId: z.string().max(64).optional(),
  })
  .refine((b) => !b.startTime || !b.endTime || b.endTime > b.startTime, {
    message: 'End time must be after start time',
    path: ['endTime'],
  });

export const WorkDayInput = z
  .object({
    date: isoDate,
    status: z.enum(['worked', 'planned', 'cancelled']).default('worked'),
    employmentType: z.enum(['permanent', 'regular']),
    role: z.enum(['teacher', 'aide']),
    format: z.enum(['single', 'multiple']),
    schoolName: name(160),
    district: name(120),
    dayType: z.union([z.literal(1), z.literal(0.5)]),
    startTime: hhmm,
    endTime: hhmm,
    hours: z.number().min(0).max(24),
    payRate: z.number().positive().max(10_000).optional(),
    className: optText(160),
    teacherName: optText(120),
    scheduleId: z.string().max(64).optional(),
    lunchVariant: z.enum(['A', 'B', 'C']).optional(),
    notes: optText(2000),
    coverage: z.array(CoverageBlockInput).max(16).default([]),
  })
  .superRefine((d, ctx) => {
    if (d.format === 'single' && d.coverage.length > 1)
      ctx.addIssue({
        code: 'custom',
        path: ['coverage'],
        message: 'A single assignment has at most one coverage entry',
      });
    if (d.format === 'multiple' && d.coverage.length === 0)
      ctx.addIssue({ code: 'custom', path: ['coverage'], message: 'Add at least one period' });
    const ids = d.coverage.map((b) => b.periodId).filter(Boolean);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', path: ['coverage'], message: 'Each period can appear only once' });
  });
export type WorkDayInput = z.infer<typeof WorkDayInput>;

export const PaymentInput = z.object({
  date: isoDate,
  district: name(120),
  amountCents: cents,
  payPeriodStart: isoDate.optional(),
});
export type PaymentInput = z.infer<typeof PaymentInput>;

export const PayPeriodOverrideInput = z.object({ payday: isoDate, note: optText(200) });

export const ExpenseInput = z.object({
  date: isoDate,
  merchant: name(160),
  amountCents: cents,
  categoryId: z.string().min(1, 'Choose a category'),
  paymentMethodId: z.string().min(1, 'Choose a payment method'),
  notes: optText(2000),
});
export type ExpenseInput = z.infer<typeof ExpenseInput>;

export const CategoryInput = z.object({
  name: name(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a color'),
});
export const PaymentMethodInput = z.object({ name: name(80), type: name(40) });

export const RecurringInput = z.object({
  merchant: name(160),
  amountCents: cents,
  categoryId: z.string().min(1, 'Choose a category'),
  paymentMethodId: z.string().min(1, 'Choose a payment method'),
  notes: optText(2000),
  frequency: z.enum(['monthly', 'yearly']),
  startDate: isoDate,
  occurrences: z.number().int().positive().max(600).optional(),
  active: z.boolean().default(true),
  showMonthlyEquivalent: z.boolean().default(false),
});
export type RecurringInput = z.infer<typeof RecurringInput>;

export const BudgetInput = z.object({
  month: z.union([z.literal('*'), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)]),
  categoryId: z.string().min(1).nullable(),
  amountCents: z.number().int().min(0).max(1_000_000_000_00),
});
export type BudgetInput = z.infer<typeof BudgetInput>;

export const ScheduleOverrideInput = z.object({
  schoolName: name(160),
  date: isoDate,
  scheduleId: z.string().min(1).max(64),
});

/** Every update carries the version it was based on (optimistic concurrency). */
export const Versioned = z.object({ updatedAt: z.number().int().nonnegative() });

export type ApiErrorBody = { error: string; message?: string; fields?: Record<string, string> };

export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = i.path.join('.') || '_';
    out[k] ??= i.message;
  }
  return out;
}

/* ------------------------------ Phase 4 ------------------------------ */

const WeekdayDefaultInput = z
  .object({
    employmentType: z.enum(['permanent', 'regular']),
    schoolName: z.string().trim().max(160).nullable(),
    district: z.string().trim().max(120).nullable(),
  })
  .transform((d) => ({
    employmentType: d.employmentType,
    schoolName: d.schoolName ? d.schoolName : null,
    district: d.district ? d.district : null,
  }))
  .refine((d) => d.employmentType !== 'permanent' || d.schoolName !== null, {
    message: 'A permanent day needs a school',
    path: ['schoolName'],
  });

/** PUT /api/v1/settings/employment-defaults: all five weekdays at once. */
export const EmploymentDefaultsInput = z.object({
  1: WeekdayDefaultInput,
  2: WeekdayDefaultInput,
  3: WeekdayDefaultInput,
  4: WeekdayDefaultInput,
  5: WeekdayDefaultInput,
});
export type EmploymentDefaultsInput = z.infer<typeof EmploymentDefaultsInput>;

/** PUT /api/v1/settings/assistant */
export const AssistantPrefsInput = z.object({ usualLunch: z.enum(['A', 'B', 'C']) });

export const ASSISTANT_MAX_CHARS = 500;
/** POST /api/v1/assistant/assignment and /assistant/ask */
export const AssistantRequest = z.object({
  message: z
    .string()
    .trim()
    .min(3, 'Say a little more')
    .max(ASSISTANT_MAX_CHARS, `At most ${ASSISTANT_MAX_CHARS} characters`),
});

/** POST /api/v1/assistant/drafts/:id/confirm. `input` = the user's edited draft (optional). */
export const ConfirmDraftInput = z.object({ input: WorkDayInput.optional() });
