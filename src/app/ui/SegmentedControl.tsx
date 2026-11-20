import { useRef } from 'react';

interface Option<T extends string> {
  value: T;
  label: string;
  /** Shorter label used on narrow screens. */
  short?: string;
}

/**
 * Radio-group semantics (one choice, arrow keys move it). Selection is shown by
 * fill and weight, never by the accent hue (taste: accent stays on data).
 * No animation: it changes many times a day (emil).
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
  size = 'md',
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Option<T>[];
  size?: 'sm' | 'md';
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (dir: 1 | -1) => {
    const i = options.findIndex((o) => o.value === value);
    const next = (i + dir + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex rounded-[6px] bg-raised p-0.5"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={[
              'rounded-ctl whitespace-nowrap',
              size === 'sm' ? 'h-7 px-2.5 text-[0.78125rem]' : 'h-8 px-3 text-[0.8125rem]',
              on ? 'bg-surface font-semibold text-ink' : 'text-muted hover:text-ink',
            ].join(' ')}
          >
            {o.short ? (
              <>
                <span className="hidden lg:inline">{o.label}</span>
                <span className="lg:hidden" aria-hidden="true">
                  {o.short}
                </span>
                <span className="sr-only lg:hidden">{o.label}</span>
              </>
            ) : (
              o.label
            )}
          </button>
        );
      })}
    </div>
  );
}
