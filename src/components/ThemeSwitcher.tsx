import { useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useClickOutside } from './ui';
import { useTheme, type ThemePref } from '../theme/theme';
import { cn } from '../lib/utils';

const OPTIONS: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/** Icon button with a Light / Dark / System menu, for the top bar and login page. */
export function ThemeMenu({ className }: { className?: string }) {
  const { pref, resolved, setPref } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false), open);
  const Icon = resolved === 'dark' ? Moon : Sun;
  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        type="button"
        aria-label="Change theme"
        title="Theme"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl text-ink-soft transition hover:bg-canvas hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
      >
        <Icon key={resolved} className="h-[18px] w-[18px] animate-scale-in" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-40 animate-scale-in rounded-xl border border-line bg-surface p-1.5 shadow-lift">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={pref === o.value}
              onClick={() => {
                setPref(o.value);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition',
                pref === o.value ? 'bg-brand-50 text-rust' : 'text-ink-soft hover:bg-canvas hover:text-heading',
              )}
            >
              <o.icon className="h-4 w-4" />
              <span className="flex-1">{o.label}</span>
              {pref === o.value && <Check className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Three-way segmented control, used on the Settings / Profile pages. */
export function ThemeSegmented() {
  const { pref, setPref } = useTheme();
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={pref === o.value}
          onClick={() => setPref(o.value)}
          className={cn(
            'flex flex-col items-center gap-2 rounded-xl border px-3 py-3.5 text-sm font-semibold transition',
            pref === o.value ? 'border-rust bg-brand-50 text-rust' : 'border-line text-ink-soft hover:border-navy-200 hover:text-heading',
          )}
        >
          <o.icon className="h-5 w-5" />
          {o.label}
        </button>
      ))}
    </div>
  );
}
