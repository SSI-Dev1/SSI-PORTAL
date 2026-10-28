// Branded calendar, date / date-range pickers and time picker (no native browser popups).
// Dates are exchanged as 'YYYY-MM-DD' strings and times as 24h 'HH:MM', matching the
// values the native inputs produced, so form logic is unchanged.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { floatingPanel, usePortalContainer } from './layer';

/* ------------------------------------------------------------------ helpers */

const pad = (n: number) => String(n).padStart(2, '0');
export const toISODate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISODate = (s?: string | null) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 ? dt : null;
};
const sameDay = (a?: Date | null, b?: Date | null) => !!a && !!b && a.toDateString() === b.toDateString();
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => {
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
};
const fmt = (d: Date, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }) => d.toLocaleDateString('en-GB', opts);
const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleString('en-GB', { month: 'short' }));
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const fieldTrigger =
  'flex h-11 w-full items-center gap-2.5 rounded-xl border border-line bg-surface pl-3.5 pr-9 text-left text-sm text-ink transition dark:bg-canvas/50 ' +
  'hover:border-navy-200 focus:outline-none focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/15 ' +
  'data-[state=open]:border-brand data-[state=open]:ring-4 data-[state=open]:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-60';

/* ----------------------------------------------------------------- Calendar */

type Range = { from: Date | null; to: Date | null };

export interface CalendarProps {
  mode?: 'single' | 'range';
  selected?: Date | null;
  range?: Range;
  onSelect: (d: Date) => void;
  min?: Date | null;
  max?: Date | null;
  isDisabled?: (d: Date) => boolean;
  footer?: ReactNode;
}

export function Calendar({ mode = 'single', selected, range, onSelect, min, max, isDisabled, footer }: CalendarProps) {
  const anchor = mode === 'range' ? range?.from ?? range?.to : selected;
  const [focus, setFocus] = useState<Date>(() => anchor ?? new Date());
  const [view, setView] = useState<'days' | 'months' | 'years'>('days');
  const [hover, setHover] = useState<Date | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const today = new Date();
  const month = focus.getMonth();
  const year = focus.getFullYear();

  const disabled = (d: Date) =>
    (min && d < new Date(min.getFullYear(), min.getMonth(), min.getDate())) || (max && d > new Date(max.getFullYear(), max.getMonth(), max.getDate())) || !!isDisabled?.(d);

  // 6-week grid starting on Monday.
  const days = useMemo(() => {
    const first = new Date(year, month, 1);
    const start = addDays(first, -((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [year, month]);

  // Keep DOM focus on the focused day when navigating with the keyboard.
  const keyNav = useRef(false);
  useEffect(() => {
    if (!keyNav.current) return;
    keyNav.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${toISODate(focus)}"]`)?.focus();
  }, [focus]);

  const onKeyDown = (e: KeyboardEvent) => {
    const moves: Record<string, () => Date> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      Home: () => addDays(focus, -((focus.getDay() + 6) % 7)),
      End: () => addDays(focus, 6 - ((focus.getDay() + 6) % 7)),
      PageUp: () => addMonths(focus, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focus, e.shiftKey ? 12 : 1),
    };
    if (moves[e.key]) {
      e.preventDefault();
      keyNav.current = true;
      setFocus(moves[e.key]());
    }
  };

  const inRange = (d: Date) => {
    if (mode !== 'range' || !range?.from) return false;
    const end = range.to ?? hover;
    if (!end) return false;
    const [a, b] = range.from <= end ? [range.from, end] : [end, range.from];
    return d >= a && d <= b;
  };

  const navBtn = 'flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-canvas hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60';

  return (
    <div className="w-[296px] p-2">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          className={navBtn}
          aria-label={view === 'years' ? 'Previous years' : view === 'months' ? 'Previous year' : 'Previous month'}
          onClick={() => setFocus(view === 'days' ? addMonths(focus, -1) : addMonths(focus, view === 'months' ? -12 : -144))}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setView(view === 'days' ? 'months' : view === 'months' ? 'years' : 'days')}
          className="rounded-lg px-2.5 py-1 font-display text-sm font-semibold text-heading transition hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          aria-live="polite"
        >
          {view === 'days' ? fmt(focus, { month: 'long', year: 'numeric' }) : view === 'months' ? year : `${year - (year % 12)} – ${year - (year % 12) + 11}`}
        </button>
        <button
          type="button"
          className={navBtn}
          aria-label={view === 'years' ? 'Next years' : view === 'months' ? 'Next year' : 'Next month'}
          onClick={() => setFocus(view === 'days' ? addMonths(focus, 1) : addMonths(focus, view === 'months' ? 12 : 144))}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {view === 'days' && (
        <div ref={gridRef} role="grid" aria-label={fmt(focus, { month: 'long', year: 'numeric' })} onKeyDown={onKeyDown} onMouseLeave={() => setHover(null)}>
          <div role="row" className="mb-1 grid grid-cols-7">
            {WEEKDAYS.map((w) => (
              <div key={w} role="columnheader" className="py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-mute">
                {w}
              </div>
            ))}
          </div>
          {Array.from({ length: 6 }, (_, r) => (
            <div role="row" key={r} className="grid grid-cols-7">
              {days.slice(r * 7, r * 7 + 7).map((d) => {
                const outside = d.getMonth() !== month;
                const isDis = disabled(d);
                const isStart = mode === 'range' && sameDay(d, range?.from);
                const isEnd = mode === 'range' && sameDay(d, range?.to);
                const isSel = mode === 'single' ? sameDay(d, selected) : isStart || isEnd;
                const mid = inRange(d) && !isSel;
                return (
                  <div role="gridcell" key={d.toISOString()} aria-selected={isSel || undefined} className={cn('flex h-9 items-center justify-center', mid && 'bg-brand-50')}>
                    <button
                      type="button"
                      data-day={toISODate(d)}
                      tabIndex={sameDay(d, focus) ? 0 : -1}
                      // aria-disabled (not disabled) keeps unavailable days focusable for keyboard users.
                      aria-disabled={isDis || undefined}
                      aria-label={fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + (isDis ? ' (unavailable)' : '')}
                      aria-current={sameDay(d, today) ? 'date' : undefined}
                      onClick={() => {
                        setFocus(d);
                        if (!isDis) onSelect(d);
                      }}
                      onMouseEnter={() => setHover(d)}
                      className={cn(
                        'relative flex h-9 w-9 items-center justify-center rounded-lg text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60',
                        outside ? 'text-ink-mute/60' : 'text-ink',
                        !isSel && !isDis && 'hover:bg-canvas hover:text-heading',
                        isSel && 'bg-gradient-to-br from-rust to-[#D9671A] font-semibold text-white shadow-glow',
                        mid && 'text-rust',
                        isDis && 'cursor-not-allowed text-ink-mute/40 line-through',
                      )}
                    >
                      {d.getDate()}
                      {sameDay(d, today) && !isSel && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-rust" />}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {view === 'months' && (
        <div className="grid grid-cols-3 gap-1.5 py-1">
          {MONTHS.map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setFocus(new Date(year, i, 1));
                setView('days');
              }}
              className={cn(
                'rounded-lg py-3 text-sm font-medium transition hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60',
                i === month ? 'bg-brand-50 font-semibold text-rust' : 'text-ink-soft',
              )}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {view === 'years' && (
        <div className="grid grid-cols-3 gap-1.5 py-1">
          {Array.from({ length: 12 }, (_, i) => year - (year % 12) + i).map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => {
                setFocus(new Date(y, month, 1));
                setView('months');
              }}
              className={cn(
                'rounded-lg py-3 text-sm font-medium transition hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60',
                y === year ? 'bg-brand-50 font-semibold text-rust' : 'text-ink-soft',
              )}
            >
              {y}
            </button>
          ))}
        </div>
      )}

      {footer && <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">{footer}</div>}
    </div>
  );
}

const footBtn = 'rounded-lg px-2.5 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60';

/* --------------------------------------------------------------- DatePicker */

export interface DatePickerProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  isDisabled?: (d: Date) => boolean;
  disabled?: boolean;
  invalid?: boolean;
  clearable?: boolean;
  className?: string;
  'aria-label'?: string;
  id?: string;
}

export function DatePicker({ value, onChange, placeholder = 'Select date', min, max, isDisabled, disabled, invalid, clearable = true, className, id, ...rest }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const container = usePortalContainer();
  const date = parseISODate(value);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className="relative">
        <Popover.Trigger asChild disabled={disabled}>
          <button type="button" id={id} aria-label={rest['aria-label'] ?? placeholder} aria-haspopup="dialog" aria-invalid={invalid || undefined} className={cn(fieldTrigger, invalid && 'border-red-400', className)}>
            <CalendarDays className="h-4 w-4 shrink-0 text-ink-mute" />
            <span className={cn('truncate', !date && 'text-ink-mute')}>{date ? fmt(date) : placeholder}</span>
          </button>
        </Popover.Trigger>
        {clearable && date && !disabled && (
          <button type="button" aria-label="Clear date" onClick={() => onChange('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-mute hover:bg-canvas hover:text-heading">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <Popover.Portal container={container}>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={floatingPanel}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[data-day][tabindex="0"]')?.focus();
          }}
        >
          <Calendar
            selected={date}
            min={parseISODate(min)}
            max={parseISODate(max)}
            isDisabled={isDisabled}
            onSelect={(d) => {
              onChange(toISODate(d));
              setOpen(false);
            }}
            footer={
              <>
                <button type="button" className={cn(footBtn, 'text-ink-soft hover:bg-canvas')} onClick={() => { onChange(''); setOpen(false); }}>
                  Clear
                </button>
                <button type="button" className={cn(footBtn, 'text-rust hover:bg-brand-50')} onClick={() => { onChange(toISODate(new Date())); setOpen(false); }}>
                  Today
                </button>
              </>
            }
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ---------------------------------------------------------- DateRangePicker */

export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = 'Select date range',
  className,
  'aria-label': ariaLabel,
}: {
  from: string;
  to: string;
  onChange: (r: { from: string; to: string }) => void;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  const container = usePortalContainer();
  const f = parseISODate(from);
  const t = parseISODate(to);
  const label = f && t ? `${fmt(f)} – ${fmt(t)}` : f ? `${fmt(f)} – …` : placeholder;
  const select = (d: Date) => {
    if (!f || (f && t)) return onChange({ from: toISODate(d), to: '' });
    const [a, b] = d < f ? [d, f] : [f, d];
    onChange({ from: toISODate(a), to: toISODate(b) });
    setOpen(false);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className="relative">
        <Popover.Trigger asChild>
          <button type="button" aria-label={ariaLabel ?? placeholder} aria-haspopup="dialog" className={cn(fieldTrigger, className)}>
            <CalendarDays className="h-4 w-4 shrink-0 text-ink-mute" />
            <span className={cn('truncate', !f && 'text-ink-mute')}>{label}</span>
          </button>
        </Popover.Trigger>
        {(f || t) && (
          <button type="button" aria-label="Clear date range" onClick={() => onChange({ from: '', to: '' })} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-mute hover:bg-canvas hover:text-heading">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <Popover.Portal container={container}>
        <Popover.Content align="start" sideOffset={6} collisionPadding={12} className={floatingPanel}>
          <Calendar
            mode="range"
            range={{ from: f, to: t }}
            onSelect={select}
            footer={
              <>
                <span className="px-1 text-xs text-ink-mute">{f && !t ? 'Pick an end date' : 'Pick a start date'}</span>
                <button type="button" className={cn(footBtn, 'text-ink-soft hover:bg-canvas')} onClick={() => onChange({ from: '', to: '' })}>
                  Clear
                </button>
              </>
            }
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* --------------------------------------------------------------- TimePicker */

export const formatTime12 = (v: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};

export function TimePicker({
  value,
  onChange,
  placeholder = 'Select time',
  minuteStep = 5,
  disabled,
  invalid,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minuteStep?: number;
  disabled?: boolean;
  invalid?: boolean;
  'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  const container = usePortalContainer();
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const h24 = valid ? Number(value.slice(0, 2)) : 9;
  const min = valid ? Number(value.slice(3)) : 0;
  const hour12 = h24 % 12 || 12;
  const pm = h24 >= 12;
  const set = (h12: number, m: number, isPm: boolean) => onChange(`${pad((h12 % 12) + (isPm ? 12 : 0))}:${pad(m)}`);
  const hours = Array.from({ length: 12 }, (_, i) => i + 1);
  const minutes = Array.from({ length: 60 / minuteStep }, (_, i) => i * minuteStep);
  if (valid && !minutes.includes(min)) minutes.push(min), minutes.sort((a, b) => a - b);

  const col = (items: { key: string; label: string; active: boolean; onClick: () => void }[], label: string) => (
    <div role="listbox" aria-label={label} className="flex max-h-56 flex-col gap-0.5 overflow-y-auto overscroll-contain px-1 [scrollbar-width:thin]">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="option"
          aria-selected={it.active}
          onClick={it.onClick}
          ref={(el) => {
            if (el && it.active && open) el.scrollIntoView({ block: 'center' });
          }}
          className={cn(
            'w-14 shrink-0 rounded-lg py-1.5 text-center text-sm font-medium tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60',
            it.active ? 'bg-gradient-to-br from-rust to-[#D9671A] text-white' : 'text-ink-soft hover:bg-canvas hover:text-heading',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className="relative">
        <Popover.Trigger asChild disabled={disabled}>
          <button type="button" aria-label={ariaLabel ?? placeholder} aria-haspopup="dialog" aria-invalid={invalid || undefined} className={cn(fieldTrigger, invalid && 'border-red-400')}>
            <Clock className="h-4 w-4 shrink-0 text-ink-mute" />
            <span className={cn('truncate tabular-nums', !valid && 'text-ink-mute')}>{valid ? formatTime12(value) : placeholder}</span>
          </button>
        </Popover.Trigger>
        {valid && !disabled && (
          <button type="button" aria-label="Clear time" onClick={() => onChange('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-mute hover:bg-canvas hover:text-heading">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <Popover.Portal container={container}>
        <Popover.Content align="start" sideOffset={6} collisionPadding={12} className={cn(floatingPanel, 'p-2')}>
          <div className="flex gap-1">
            {col(hours.map((h) => ({ key: `h${h}`, label: String(h), active: valid && h === hour12, onClick: () => set(h, min, pm) })), 'Hour')}
            {col(minutes.map((m) => ({ key: `m${m}`, label: pad(m), active: valid && m === min, onClick: () => set(hour12, m, pm) })), 'Minute')}
            {col(
              [
                { key: 'am', label: 'AM', active: valid && !pm, onClick: () => set(hour12, min, false) },
                { key: 'pm', label: 'PM', active: valid && pm, onClick: () => set(hour12, min, true) },
              ],
              'AM or PM',
            )}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
            <button type="button" className={cn(footBtn, 'text-ink-soft hover:bg-canvas')} onClick={() => { onChange(''); setOpen(false); }}>
              Clear
            </button>
            <button type="button" className={cn(footBtn, 'text-rust hover:bg-brand-50')} onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
