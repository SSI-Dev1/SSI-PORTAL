import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { FocusScope } from '@radix-ui/react-focus-scope';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2, Search, X, type LucideIcon } from 'lucide-react';
import { avatarColor, cn, initials, type Tone } from '../lib/utils';
import { Tooltip } from './ds/controls';
import { DatePicker } from './ds/datetime';
import { floatingPanel, PortalContainerContext, usePortalContainer } from './ds/layer';
import { useConfirm } from './feedback';

export { Select, FilterSelect, SelectMenu, type SelectOption } from './ds/select';
export { DatePicker, DateRangePicker, TimePicker, Calendar } from './ds/datetime';
export { Tooltip, Checkbox, Switch, Slider } from './ds/controls';

/* ------------------------------------------------------------------ Button */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'navy' | 'soft';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary:
    'bg-gradient-to-r from-rust to-[#D9671A] text-white shadow-glow hover:brightness-110 active:brightness-95',
  navy: 'bg-navy text-white hover:bg-navy-700 shadow-card dark:bg-navy-500 dark:hover:bg-navy-400',
  secondary: 'bg-surface text-ink border border-line hover:border-navy-200 hover:bg-canvas shadow-sm',
  soft: 'bg-brand-50 text-rust hover:bg-brand-100',
  ghost: 'text-ink-soft hover:bg-canvas hover:text-ink',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon: Icon, loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" strokeWidth={2.2} /> : null}
      {children}
    </button>
  );
});

export function IconButton({
  icon: Icon,
  label,
  className,
  badge,
  ...rest
}: { icon: LucideIcon; label: string; badge?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Tooltip content={label}>
    <button
      type="button"
      aria-label={label}
      className={cn(
        'relative inline-flex h-10 w-10 items-center justify-center rounded-xl text-ink-soft transition hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60',
        className,
      )}
      {...rest}
    >
      <Icon className="h-[18px] w-[18px]" />
      {!!badge && (
        <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rust px-1 text-[10px] font-bold text-white ring-2 ring-surface">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
    </Tooltip>
  );
}

/* -------------------------------------------------------------------- Card */

export function Card({ className, children, hover }: { className?: string; children: ReactNode; hover?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-line bg-surface shadow-card',
        hover && 'transition duration-300 hover:-translate-y-0.5 hover:shadow-lift',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pt-5', className)}>
      <div className="min-w-0">
        <h3 className="font-display text-[15px] font-semibold text-heading">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-ink-mute">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------- Badge */

const tones: Record<Tone, string> = {
  navy: 'bg-navy-50 text-heading ring-navy-100',
  orange: 'bg-brand-50 text-brand-700 ring-brand-100',
  rust: 'bg-rust-50 text-rust ring-rust-100',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  red: 'bg-red-50 text-red-700 ring-red-100',
  blue: 'bg-blue-50 text-blue-700 ring-blue-100',
  violet: 'bg-violet-50 text-violet-700 ring-violet-100',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  teal: 'bg-teal-50 text-teal-700 ring-teal-100',
};
const dots: Record<Tone, string> = {
  navy: 'bg-navy dark:bg-navy-300', orange: 'bg-brand', rust: 'bg-rust', green: 'bg-emerald-500', red: 'bg-red-500', blue: 'bg-blue-500',
  violet: 'bg-violet-500', slate: 'bg-slate-400', amber: 'bg-amber-500', teal: 'bg-teal-500',
};

export function Badge({ tone = 'slate', dot, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset', tones[tone], className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dots[tone])} />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ Avatar */

export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  const bg = avatarColor(name);
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white', className)}
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, ${bg}, ${bg}cc)` }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/* ------------------------------------------------------------------ Inputs */

const fieldBase =
  'w-full rounded-xl border border-line bg-surface dark:bg-canvas/50 px-3.5 text-sm text-ink placeholder:text-ink-mute transition focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 disabled:bg-canvas';

export function Field({ label, error, hint, children, required, className }: { label?: string; error?: string; hint?: string; children: ReactNode; required?: boolean; className?: string }) {
  return (
    <label className={cn('block', className)}>
      {label && (
        <span className="mb-1.5 block text-[13px] font-semibold text-heading">
          {label} {required && <span className="text-rust">*</span>}
        </span>
      )}
      {children}
      {error ? (
        <span role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-red-600 animate-fade-in">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-mute">{hint}</span>
      ) : null}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: LucideIcon; invalid?: boolean }>(
  function Input({ icon: Icon, invalid, className, ...rest }, ref) {
    // Dates use the branded calendar instead of the browser's date popup.
    if (rest.type === 'date') {
      return (
        <DatePicker
          value={String(rest.value ?? '')}
          onChange={(v) => rest.onChange?.({ target: { value: v } } as ChangeEvent<HTMLInputElement>)}
          min={rest.min as string | undefined}
          max={rest.max as string | undefined}
          disabled={rest.disabled}
          invalid={invalid}
          aria-label={rest['aria-label']}
          placeholder={rest.placeholder ?? 'Select date'}
          className={className}
        />
      );
    }
    return (
      <div className="relative">
        {Icon && <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />}
        <input ref={ref} className={cn(fieldBase, 'h-11', Icon && 'pl-10', invalid && 'border-red-400 focus:border-red-400 focus:ring-red-100', className)} {...rest} />
      </div>
    );
  },
);

export function Textarea({ className, invalid, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea className={cn(fieldBase, 'min-h-[96px] py-2.5', invalid && 'border-red-400', className)} {...rest} />;
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(fieldBase, 'h-10 pl-10 pr-8')}
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-ink-mute hover:text-ink">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Modal */

/** Asks before closing a dialog that has unsaved changes. */
function useGuardedClose(onClose: () => void, dirty?: boolean) {
  const confirm = useConfirm();
  return async () => {
    if (
      dirty &&
      !(await confirm({ title: 'Discard unsaved changes?', message: 'You have changes that haven’t been saved. If you close now they will be lost.', confirmLabel: 'Discard changes', danger: true }))
    )
      return;
    onClose();
  };
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  dirty,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** When true, closing (×, Esc, backdrop) asks for confirmation first. */
  dirty?: boolean;
}) {
  const titleId = useId();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const requestClose = useGuardedClose(onClose, dirty);
  useEscape(open, requestClose, container);
  useLockScroll(open);
  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return createPortal(
    <div ref={setContainer} className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="absolute inset-0 animate-fade-in bg-navy/40 backdrop-blur-[3px] dark:bg-black/60" onClick={requestClose} aria-hidden />
      <PortalContainerContext.Provider value={container}>
        <FocusScope trapped loop asChild>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={cn('relative flex max-h-[92vh] w-full animate-scale-in flex-col overflow-hidden rounded-t-3xl bg-surface shadow-2xl outline-none sm:rounded-3xl', width)}
            tabIndex={-1}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
              <div>
                <h2 id={titleId} className="font-display text-lg font-semibold text-heading">
                  {title}
                </h2>
                {subtitle && <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p>}
              </div>
              <IconButton icon={X} label="Close" onClick={requestClose} className="-mr-2 -mt-1" />
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && <div className="flex flex-wrap justify-end gap-2.5 border-t border-line bg-canvas/60 px-6 py-4">{footer}</div>}
          </div>
        </FocusScope>
      </PortalContainerContext.Provider>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, subtitle, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const titleId = useId();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  useEscape(open, onClose, container);
  useLockScroll(open);
  if (!open) return null;
  return createPortal(
    <div ref={setContainer} className="fixed inset-0 z-[55]">
      <div className="absolute inset-0 animate-fade-in bg-navy/30 backdrop-blur-[2px] dark:bg-black/55" onClick={onClose} aria-hidden />
      <PortalContainerContext.Provider value={container}>
        <FocusScope trapped loop asChild>
          <aside role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="absolute right-0 top-0 flex h-full w-full max-w-xl animate-slide-in flex-col bg-surface shadow-2xl outline-none">
            <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
              <div className="min-w-0">
                <div id={titleId} className="font-display text-lg font-semibold text-heading">{title}</div>
                {subtitle && <div className="mt-0.5 text-sm text-ink-soft">{subtitle}</div>}
              </div>
              <IconButton icon={X} label="Close" onClick={onClose} className="-mr-2" />
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && <div className="flex flex-wrap justify-end gap-2.5 border-t border-line px-6 py-4">{footer}</div>}
          </aside>
        </FocusScope>
      </PortalContainerContext.Provider>
    </div>,
    document.body,
  );
}

function useEscape(active: boolean, fn: () => void, container?: HTMLElement | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Only the top-most dialog closes, and not while a menu/picker inside it is open.
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      const top = dialogs[dialogs.length - 1];
      if (container && top && !container.contains(top)) return;
      if (container?.querySelector('[data-radix-popper-content-wrapper] [data-state="open"]')) return;
      ref.current();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [active, container]);
}

function useLockScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

/* -------------------------------------------------------------------- Menu */

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  danger?: boolean;
}

export function Menu({
  trigger,
  items,
  align = 'right',
  width = 'w-48',
  side = 'bottom',
}: {
  trigger: (open: boolean) => ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
  width?: string;
  side?: 'top' | 'bottom' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const container = usePortalContainer();
  return (
    // Portalled and collision-aware, so it is never clipped by tables or the sidebar.
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger asChild>{trigger(open)}</DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container}>
        <DropdownMenu.Content
          side={side}
          align={align === 'right' ? 'end' : 'start'}
          sideOffset={6}
          collisionPadding={12}
          className={cn(floatingPanel, width)}
        >
          {items.map((it) => (
            <DropdownMenu.Item
              key={it.label}
              onSelect={() => it.onClick()}
              className={cn(
                'flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium outline-none transition-colors',
                it.danger ? 'text-red-600 data-[highlighted]:bg-red-50' : 'text-ink-soft data-[highlighted]:bg-canvas data-[highlighted]:text-heading',
              )}
            >
              {it.icon && <it.icon className="h-4 w-4" />}
              {it.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function useClickOutside<T extends HTMLElement>(fn: () => void, active = true) {
  const ref = useRef<T>(null);
  const cb = useRef(fn);
  cb.current = fn;
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [active]);
  return ref;
}

/* -------------------------------------------------------------------- Tabs */

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line', className)} role="tablist">
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(t.value)}
            className={cn(
              'relative flex items-center gap-2 whitespace-nowrap px-3.5 pb-3 pt-1 text-sm font-semibold transition',
              active ? 'text-rust' : 'text-ink-soft hover:text-heading',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cn('rounded-full px-1.5 py-px text-[11px]', active ? 'bg-brand-100 text-rust' : 'bg-canvas text-ink-mute')}>{t.count}</span>
            )}
            {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-rust" />}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-xl bg-canvas p-1 ring-1 ring-line">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn('rounded-lg px-3 py-1.5 text-xs font-semibold transition', o.value === value ? 'bg-surface text-heading shadow-sm' : 'text-ink-mute hover:text-heading')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- Page furniture */

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-[26px] font-semibold tracking-tight text-heading">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="relative mb-4">
        <div className="absolute inset-0 rotate-45 rounded-2xl bg-brand-100" />
        <div className="relative flex h-14 w-14 items-center justify-center">
          <Icon className="h-6 w-6 text-rust" />
        </div>
      </div>
      <h4 className="font-display text-base font-semibold text-heading">{title}</h4>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-soft">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-slate-100', className)} />;
}

export function Progress({ value, className, color = 'bg-gradient-to-r from-brand to-rust' }: { value: number; className?: string; color?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <div className={cn('h-full rounded-full transition-all duration-700', color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

/** Simple responsive table shell. */
export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-line bg-canvas/70">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-5 py-3 text-[11.5px] font-semibold uppercase tracking-wider text-ink-mute">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pages, onPage, total, label }: { page: number; pages: number; onPage: (p: number) => void; total: number; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-ink-mute">
      <span>
        {total} {total === 1 ? label.replace(/s$/, '') : label}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            Previous
          </Button>
          <span className="px-2 font-semibold text-heading">
            {page} / {pages}
          </span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

export function usePaged<T>(rows: T[], perPage = 10, resetKey?: unknown) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [resetKey]);
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const safe = Math.min(page, pages);
  return { page: safe, pages, setPage, rows: rows.slice((safe - 1) * perPage, safe * perPage) };
}

/* ------------------------------------------------------------------- Alert */

const alertStyles = {
  error: { icon: AlertCircle, cls: 'border-red-200 bg-red-50 text-red-700' },
  warning: { icon: AlertTriangle, cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  success: { icon: CheckCircle2, cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  info: { icon: Info, cls: 'border-blue-200 bg-blue-50 text-blue-700' },
} as const;

/** Inline banner for form-level and page-level messages. */
export function Alert({ tone = 'info', title, children, className }: { tone?: keyof typeof alertStyles; title?: ReactNode; children?: ReactNode; className?: string }) {
  const { icon: Icon, cls } = alertStyles[tone];
  return (
    <div role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'} className={cn('flex animate-fade-in items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm', cls, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title && 'mt-0.5 opacity-90')}>{children}</div>}
      </div>
    </div>
  );
}
