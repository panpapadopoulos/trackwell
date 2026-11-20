import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Table2, ChartColumn } from 'lucide-react';
import { formatMoney, type Cents } from '@/domain/money';
import { formatMedium, formatShort, type ISODate } from '@/domain/dates';
import { useData } from '../providers/data';

/** The kind of money a figure is. Never conveyed by color alone. */
export type MoneyKind = 'received' | 'expected' | 'projected' | 'spent' | 'net' | 'plain';

const KIND_LABEL: Record<MoneyKind, string> = {
  received: 'received',
  expected: 'expected, not yet received',
  projected: 'projected',
  spent: 'spent',
  net: 'net',
  plain: '',
};

export function Money({
  cents,
  kind = 'plain',
  signed,
  className = '',
  whole,
}: {
  cents: Cents | null;
  kind?: MoneyKind;
  signed?: boolean;
  className?: string;
  whole?: boolean;
}) {
  if (cents === null)
    return (
      <span className={`num text-faint ${className}`} aria-label="not available">
        &mdash;
      </span>
    );
  const text = formatMoney(kind === 'spent' && cents > 0 ? -cents : cents, {
    signed: signed ?? kind === 'net',
    whole: whole ?? false,
  });
  const style =
    kind === 'expected'
      ? 'expected-figure'
      : kind === 'projected'
        ? 'underline decoration-dotted decoration-faint underline-offset-[6px]'
        : '';
  // Amounts are never truncated; very long ones step down in size instead (break-ui #1).
  const fit = text.length > 16 ? '0.62em' : text.length > 12 ? '0.78em' : undefined;
  return (
    <span
      className={`num whitespace-nowrap ${style} ${className}`}
      style={fit ? { fontSize: fit } : undefined}
    >
      {text}
      {KIND_LABEL[kind] && <span className="sr-only"> {KIND_LABEL[kind]}</span>}
    </span>
  );
}

/** The date-stamp: appears ONLY where a real payment record exists (direction contract). */
export function Stamp({ date, compact = false }: { date: ISODate; compact?: boolean }) {
  return (
    <span
      className="inline-flex shrink-0 -rotate-3 select-none items-center whitespace-nowrap rounded-[3px] border-[1.5px] border-stamp px-1.5 py-0.5 text-[0.75rem] font-bold text-stamp-ink"
      title={`Payment recorded ${formatMedium(date)}`}
    >
      <span aria-hidden="true">{compact ? 'Paid' : `Paid ${formatShort(date)}`}</span>
      <span className="sr-only">Paid {formatMedium(date)}</span>
    </span>
  );
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'danger' | 'warning' | 'stamp';
}) {
  const tones = {
    neutral: 'bg-raised text-muted',
    danger: 'bg-danger-tint text-danger',
    warning: 'bg-warning-tint text-warning',
    stamp: 'bg-stamp-tint text-stamp-ink',
  } as const;
  return (
    <span
      className={`inline-flex h-5 flex-none items-center whitespace-nowrap rounded-full px-2 text-[0.71875rem] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
  id,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-h` : undefined;
  return (
    <section
      aria-labelledby={headingId}
      className={`flex min-w-0 flex-col rounded-panel bg-surface p-4 md:p-5 ${className}`}
    >
      <header className="mb-3 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-[0.875rem] font-semibold text-ink">
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-[0.78125rem] text-faint">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** Wraps a block: its own loading skeleton, its own error state with retry. */
export function Block({
  title,
  children,
  skeleton,
  id,
  className,
}: {
  title: string;
  children: ReactNode;
  skeleton?: ReactNode;
  id?: string;
  className?: string;
}) {
  const { status } = useData();
  if (status === 'loading')
    return (
      <Panel title={title} className={className ?? ''} {...(id ? { id } : {})}>
        <div aria-busy="true" aria-label={`Loading ${title}`}>
          {skeleton ?? <SkeletonLines rows={4} />}
        </div>
      </Panel>
    );
  return (
    <BlockBoundary title={title} {...(className ? { className } : {})}>
      {children}
    </BlockBoundary>
  );
}

export function SkeletonLines({ rows = 3, tall = false }: { rows?: number; tall?: boolean }) {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={`skeleton ${tall ? 'h-8' : 'h-4'}`}
          style={{ width: `${92 - ((i * 17) % 40)}%` }}
        />
      ))}
    </div>
  );
}

interface BoundaryState {
  error: Error | null;
}

export class BlockBoundary extends Component<
  { title: string; children: ReactNode; className?: string },
  BoundaryState
> {
  override state: BoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    // No data values are logged, only the failure itself.
    console.error(
      `[${this.props.title}] failed to render`,
      error.message,
      info.componentStack?.split('\n')[1]?.trim(),
    );
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <Panel title={this.props.title} className={this.props.className ?? ''}>
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-ctl bg-danger-tint p-3 text-[0.8125rem] text-ink"
        >
          <span className="inline-flex items-center gap-2 font-semibold text-danger">
            <AlertTriangle size={15} aria-hidden="true" /> Couldn&rsquo;t load this section
          </span>
          <span className="text-muted">
            Nothing was changed or saved. Your records are untouched. Try again; if it keeps failing, the
            server may be unreachable.
          </span>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="pressable inline-flex h-8 items-center gap-1.5 rounded-ctl border border-rule-strong px-3 text-[0.8125rem]"
          >
            <RotateCcw size={14} aria-hidden="true" /> Try again
          </button>
        </div>
      </Panel>
    );
  }
}

export function EmptyNote({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-ctl bg-raised/60 p-3 text-[0.8125rem] text-muted">
      <p>{children}</p>
      {action}
    </div>
  );
}

/** Chart/table toggle: every chart has an accessible table view (dataviz). */
export function useChartOrTable(): [boolean, ReactNode] {
  const [table, setTable] = useState(false);
  const toggle = (
    <button
      type="button"
      onClick={() => setTable((t) => !t)}
      aria-pressed={table}
      className="pressable hoverable inline-flex h-7 items-center gap-1.5 rounded-ctl px-2 text-[0.75rem] text-muted hover:text-ink"
    >
      {table ? <ChartColumn size={14} aria-hidden="true" /> : <Table2 size={14} aria-hidden="true" />}
      {table ? 'Chart' : 'Table'}
    </button>
  );
  return [table, toggle];
}

/** Legend entry drawn as the mark it explains (dataviz: swatch = mark). */
export function LegendSwatch({ form, color }: { form: 'solid' | 'dashed' | 'dotted'; color: string }) {
  const style =
    form === 'solid'
      ? { background: color }
      : { border: `1.5px ${form} ${color}`, background: 'transparent' };
  return <span aria-hidden="true" className="inline-block h-2.5 w-3.5 rounded-[2px]" style={style} />;
}

export function Legend({
  items,
}: {
  items: { label: string; form: 'solid' | 'dashed' | 'dotted'; color: string }[];
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-muted" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <LegendSwatch form={i.form} color={i.color} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
