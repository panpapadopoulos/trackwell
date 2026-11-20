import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { X } from 'lucide-react';

/* ------------------------------ fields ------------------------------ */

const FieldCtx = createContext<{ id: string; describedBy: string | undefined; invalid: boolean } | null>(
  null,
);

/** Label above the control; hint and error are wired with aria-describedby. */
export function Field({
  label,
  hint,
  error,
  children,
  className = '',
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <FieldCtx.Provider value={{ id, describedBy, invalid: Boolean(error) }}>
      <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
        <label htmlFor={id} className="text-[0.8125rem] font-medium text-ink">
          {label}
        </label>
        {children}
        {hint && !error && (
          <p id={hintId} className="text-[0.75rem] text-faint">
            {hint}
          </p>
        )}
        {error && (
          <p id={errId} className="text-[0.75rem] text-danger">
            {error}
          </p>
        )}
      </div>
    </FieldCtx.Provider>
  );
}

const control =
  'h-10 w-full min-w-0 rounded-ctl border bg-ground px-3 text-[0.875rem] text-ink placeholder:text-faint disabled:opacity-60 aria-[invalid=true]:border-danger';

function useFieldProps() {
  const f = useContext(FieldCtx);
  return f ? { id: f.id, 'aria-describedby': f.describedBy, 'aria-invalid': f.invalid || undefined } : {};
}

export function Input({ className = '', ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...useFieldProps()} {...p} className={`${control} border-rule-strong ${className}`} />;
}

export function Select({ className = '', children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...useFieldProps()} {...p} className={`${control} border-rule-strong pr-8 ${className}`}>
      {children}
    </select>
  );
}

export function Textarea({ className = '', ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...useFieldProps()}
      rows={3}
      {...p}
      className={`${control} h-auto border-rule-strong py-2 ${className}`}
    />
  );
}

/**
 * Text input with a searchable list of earlier values (ARIA 1.2 combobox, list
 * autocomplete). Free text is always allowed; a suggestion is never required.
 * Keyboard: ArrowDown/ArrowUp move, Enter picks the highlighted suggestion,
 * Escape closes. Mouse: click a suggestion. Suggestions are computed by the caller.
 */
export function Combobox({
  value,
  onChange,
  options,
  className = '',
  'aria-label': ariaLabel,
  placeholder,
  disabled,
  maxLength,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Already filtered and ordered for `value`. `hint` is shown after the value (e.g. "with Ms. Lee"). */
  options: { value: string; hint?: string }[];
  className?: string;
  'aria-label'?: string;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
}) {
  const field = useFieldProps();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const shown = open && !disabled ? options : [];
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setActive(-1);
  };
  return (
    <div className={`relative min-w-0 ${className}`}>
      <input
        {...field}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        aria-activedescendant={shown.length && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        value={value}
        className={`${control} border-rule-strong`}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) setOpen(true);
            const n = options.length;
            if (!n) return;
            setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : (a <= 0 ? n : a) - 1));
          } else if (e.key === 'Enter' && shown.length && active >= 0) {
            e.preventDefault(); // pick, don't submit the form
            pick(shown[active]!.value);
          } else if (e.key === 'Escape' && shown.length) {
            e.preventDefault();
            e.stopPropagation(); // close the list, not the dialog
            setOpen(false);
            setActive(-1);
          }
        }}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={ariaLabel ? `${ariaLabel} suggestions` : 'Suggestions'}
        hidden={shown.length === 0}
        className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-ctl border border-rule-strong bg-surface py-1 shadow-lg"
      >
        {shown.map((o, i) => (
          <li
            key={o.value}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 text-[0.84375rem] text-ink ${i === active ? 'bg-raised' : 'hoverable'}`}
            onMouseDown={(e) => {
              e.preventDefault(); // keep focus in the input
              pick(o.value);
            }}
          >
            <span className="min-w-0 [overflow-wrap:anywhere]">{o.value}</span>
            {o.hint && <span className="shrink-0 text-[0.75rem] text-faint">{o.hint}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Dollars in, integer cents out. Accepts "$1,234.5", "12", "0.99". Never floats into storage. */
export function parseMoney(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export function MoneyInput({
  value,
  onChange,
  ...p
}: { value: string; onChange: (v: string) => void } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange'
>) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
      >
        $
      </span>
      <Input
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="num pl-7"
        {...p}
      />
    </div>
  );
}

/* ------------------------------ buttons ------------------------------ */

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary-bg text-primary-fg font-semibold',
  secondary: 'border border-rule-strong text-ink hoverable',
  quiet: 'text-muted hover:text-ink hoverable',
  danger: 'border border-danger text-danger hover:bg-danger-tint focus-visible:bg-danger-tint',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  busy,
  className = '',
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; busy?: boolean }) {
  return (
    <button
      type="button"
      {...p}
      disabled={p.disabled || busy}
      aria-busy={busy || undefined}
      className={`pressable inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl disabled:cursor-not-allowed disabled:opacity-60 ${size === 'sm' ? 'h-8 px-2.5 text-[0.8125rem]' : 'h-10 px-4 text-[0.875rem]'} ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/* ------------------------------ dialogs ------------------------------ */

/**
 * Native <dialog> (modal): focus is trapped and restored by the browser, Escape closes.
 * `side` sheets slide from the right on desktop and fill the screen on phones.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={`sheet m-0 ml-auto h-dvh max-h-dvh w-full max-w-full bg-surface p-0 text-ink backdrop:bg-black/55 ${wide ? 'sm:max-w-[min(56rem,100vw)]' : 'sm:max-w-[34rem]'}`}
    >
      {open && (
        <div className="flex h-full flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-rule px-5">
            <h2 id={titleId} className="truncate text-[1rem] font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="pressable hoverable grid size-9 place-items-center rounded-ctl text-muted"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
          {footer && (
            <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-rule px-5 py-3">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}

/** Confirmation for destructive actions. Focus starts on Cancel, so Enter never deletes by accident. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-panel bg-surface p-5 text-ink backdrop:bg-black/55"
    >
      {open && (
        <>
          <h2 id={titleId} className="text-[1rem] font-semibold">
            {title}
          </h2>
          <div className="mt-2 text-[0.875rem] text-muted">{body}</div>
          <div className="mt-5 flex justify-end gap-2">
            <Button autoFocus onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="danger" onClick={onConfirm} busy={busy ?? false}>
              {confirmLabel}
            </Button>
          </div>
        </>
      )}
    </dialog>
  );
}

/* ------------------------------ notices ------------------------------ */

type Notice = { id: number; text: string; tone: 'ok' | 'error' };
const NoticeCtx = createContext<(text: string, tone?: Notice['tone']) => void>(() => undefined);

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Notice[]>([]);
  const push = useCallback((text: string, tone: Notice['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === 'error' ? 8000 : 3500);
  }, []);
  return (
    <NoticeCtx.Provider value={push}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2 md:bottom-6"
      >
        {items.map((n) => (
          <div
            key={n.id}
            className={`notice-in rounded-ctl border px-3.5 py-2 text-[0.8125rem] shadow-[0_8px_24px_rgba(0,0,0,0.28)] ${n.tone === 'error' ? 'border-danger bg-danger-tint text-ink' : 'border-rule-strong bg-surface text-ink'}`}
          >
            {n.text}
          </div>
        ))}
      </div>
    </NoticeCtx.Provider>
  );
}

export const useNotice = () => useContext(NoticeCtx);
