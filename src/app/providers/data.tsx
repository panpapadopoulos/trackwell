import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { todayISO, type ISODate } from '@/domain/dates';
import { rangeFor, type DateRange, type PeriodPreset } from '@/domain/filters';
import { schoolYearKey } from '@/domain/schoolYear';
import { PAY_SCHEDULE_V1, type PayScheduleConfig } from '@/domain/pay/rules';
import { DEFAULT_REGISTRY } from '@/domain/schedule/registry';
import { DEFAULT_WEEK, type WeeklyDefaults } from '@/domain/work/defaults';
import type { ScheduleRegistry } from '@/domain/schedule/types';
import { emptyDataset, oneDataset, syntheticDataset, worstCaseDataset, type Dataset } from '@/demo/synthetic';
import type { Snapshot } from '@/shared/snapshot';
import { ApiError, api, setCsrf } from '../api/client';

/**
 * Data source.
 *  - 'api' (default): the real Worker + D1 backend.
 *  - synthetic states: demo/testing only. Selectable with ?data= in DEVELOPMENT builds.
 * A failed load is an ERROR state, never an empty dataset (legacy defect D1).
 */
export type DatasetChoice = 'api' | 'synthetic' | 'one' | 'empty' | 'worst-case' | 'loading' | 'error';
const DEMO: DatasetChoice[] = ['synthetic', 'one', 'empty', 'worst-case', 'loading', 'error'];
export const DEMO_TOGGLES = import.meta.env.DEV;

function choiceFromUrl(): DatasetChoice | null {
  if (!DEMO_TOGGLES || typeof location === 'undefined') return null;
  const v = new URLSearchParams(location.search).get('data');
  return DEMO.includes(v as DatasetChoice) ? (v as DatasetChoice) : null;
}

export type PeriodKind = 'all' | 'schoolYear' | 'month' | 'last30';
export type Status = 'signed-out' | 'loading' | 'ready' | 'error';

interface DataCtx {
  today: ISODate;
  choice: DatasetChoice;
  setChoice: (c: DatasetChoice) => void;
  /** null until ready. */
  dataset: Dataset | null;
  status: Status;
  loadError: string | null;
  period: PeriodKind;
  setPeriod: (p: PeriodKind) => void;
  preset: PeriodPreset;
  range: DateRange;
  /** Pay schedule incl. the user's manual payday overrides. */
  payConfig: PayScheduleConfig;
  /** Bell schedules incl. per-date overrides. */
  registry: ScheduleRegistry;
  /** Weekday employment defaults: saved settings when live, the built-in week otherwise. */
  weekDefaults: WeeklyDefaults;
  snapshot: Snapshot | null;
  /** True when writes go to the real backend. */
  live: boolean;
  reload: () => Promise<void>;
  /** Runs a write, then refreshes from the server. Errors propagate to the caller (forms show them). */
  mutate: <T>(fn: () => Promise<T>) => Promise<T>;
  signIn: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<DataCtx | null>(null);

function datasetFromSnapshot(s: Snapshot): Dataset {
  return {
    kind: 'synthetic',
    label: 'Your records',
    work: { days: s.workDays, payments: s.payments },
    expenses: {
      expenses: s.expenses,
      categories: s.categories,
      paymentMethods: s.paymentMethods,
      recurringPlans: s.recurringPlans,
      recurringSkips: s.recurringSkips,
      budgets: s.budgets,
    },
  };
}

export function DataProvider({
  children,
  initial = 'api',
  today: todayOverride,
}: {
  children: ReactNode;
  initial?: DatasetChoice;
  today?: ISODate;
}) {
  const [choice, setChoiceState] = useState<DatasetChoice>(() => choiceFromUrl() ?? initial);
  const [period, setPeriod] = useState<PeriodKind>('all');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<Status>(choice === 'api' ? 'loading' : 'ready');
  const [loadError, setLoadError] = useState<string | null>(null);
  const synced = useRef(false);
  const live = choice === 'api';
  const today = todayOverride ?? snapshot?.serverToday ?? todayISO();

  const reload = useCallback(async () => {
    try {
      const s = await api.get<Snapshot>('/api/v1/snapshot');
      setSnapshot(s);
      setLoadError(null);
      setStatus('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setStatus('signed-out');
        return;
      }
      setLoadError(e instanceof Error ? e.message : 'Couldn’t load your data.');
      setStatus('error');
    }
  }, []);

  const start = useCallback(async () => {
    setStatus('loading');
    try {
      const s = await api.get<{ csrfToken: string }>('/api/auth/session');
      setCsrf(s.csrfToken);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setStatus('signed-out');
        return;
      }
      setLoadError(e instanceof Error ? e.message : 'Couldn’t reach Trackwell.');
      setStatus('error');
      return;
    }
    if (!synced.current) {
      synced.current = true;
      // Generate recurring expenses that came due (idempotent, server-dated). A failure here
      // doesn't block loading; the data simply shows what's stored.
      await api.post('/api/v1/recurring/sync').catch(() => undefined);
    }
    await reload();
  }, [reload]);

  useEffect(() => {
    // Subscribing to an external system (the API) on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (live) void start();
  }, [live, start]);

  const setChoice = useCallback((c: DatasetChoice) => {
    setChoiceState(c);
    setStatus(c === 'api' ? 'loading' : 'ready');
    if (DEMO_TOGGLES && typeof history !== 'undefined') {
      const url = new URL(location.href);
      if (c === 'api') url.searchParams.delete('data');
      else url.searchParams.set('data', c);
      history.replaceState(history.state, '', url);
    }
  }, []);

  const signIn = useCallback(
    async (password: string) => {
      const r = await api.post<{ csrfToken: string }>('/api/auth/login', { password });
      setCsrf(r.csrfToken);
      synced.current = false;
      await start();
    },
    [start],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setSnapshot(null);
      setCsrf('');
      setStatus('signed-out');
    }
  }, []);

  const mutate = useCallback(
    async <T,>(fn: () => Promise<T>) => {
      if (!live)
        throw new ApiError(400, {
          error: 'demo',
          message: 'Demo data is read-only. Switch to your records to make changes.',
        });
      try {
        const r = await fn();
        await reload();
        return r;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) setStatus('signed-out');
        throw e;
      }
    },
    [live, reload],
  );

  const dataset = useMemo<Dataset | null>(() => {
    switch (choice) {
      case 'api':
        return snapshot ? datasetFromSnapshot(snapshot) : null;
      case 'synthetic':
        return syntheticDataset(today);
      case 'one':
        return oneDataset(today);
      case 'empty':
        return emptyDataset();
      case 'worst-case':
        return worstCaseDataset(today);
      default:
        return null;
    }
  }, [choice, snapshot, today]);

  const preset = useMemo<PeriodPreset>(() => {
    switch (period) {
      case 'all':
        return { kind: 'all' };
      case 'schoolYear':
        return { kind: 'schoolYear', key: schoolYearKey(today) };
      case 'month':
        return { kind: 'month', key: today.slice(0, 7) };
      case 'last30':
        return { kind: 'last30' };
    }
  }, [period, today]);

  const payConfig = useMemo<PayScheduleConfig>(
    () => ({
      ...PAY_SCHEDULE_V1,
      paydayOverrides: Object.fromEntries(
        (snapshot?.payPeriodOverrides ?? []).map((o) => [o.periodStart, o.payday]),
      ),
    }),
    [snapshot],
  );
  const registry = useMemo<ScheduleRegistry>(
    () => ({
      ...DEFAULT_REGISTRY,
      overrides: (snapshot?.scheduleOverrides ?? []).map((o) => ({
        schoolName: o.schoolName,
        date: o.date,
        scheduleId: o.scheduleId,
      })),
    }),
    [snapshot],
  );

  const weekDefaults = useMemo<WeeklyDefaults>(
    () => (live && snapshot?.employmentDefaults ? snapshot.employmentDefaults : DEFAULT_WEEK),
    [live, snapshot],
  );

  const effectiveStatus: Status =
    choice === 'loading' ? 'loading' : choice === 'error' ? 'error' : live ? status : 'ready';

  const value = useMemo<DataCtx>(
    () => ({
      today,
      choice,
      setChoice,
      dataset,
      status: effectiveStatus,
      loadError: choice === 'error' ? 'The data could not be loaded.' : loadError,
      period,
      setPeriod,
      preset,
      range: rangeFor(preset, today),
      payConfig,
      registry,
      weekDefaults,
      snapshot,
      live,
      reload,
      mutate,
      signIn,
      signOut,
    }),
    [
      today,
      choice,
      setChoice,
      dataset,
      effectiveStatus,
      loadError,
      period,
      preset,
      payConfig,
      registry,
      weekDefaults,
      snapshot,
      live,
      reload,
      mutate,
      signIn,
      signOut,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData outside DataProvider');
  return v;
}

/** For blocks: throws on load failure so the nearest boundary shows an error, never $0. */
export function useDatasetOrThrow(): Dataset | null {
  const { dataset, status, loadError } = useData();
  if (status === 'error') throw new Error(loadError ?? 'The data could not be loaded.');
  return dataset;
}
