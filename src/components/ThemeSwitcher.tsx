import { Check, Monitor, Moon, Sun } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Tooltip } from './ds/controls';
import { floatingPanel } from './ds/layer';
import { useTheme, type ThemePref } from '../theme/theme';
import { stopPortalBubble } from './ds/layer';
import { cn } from '../lib/utils';

const OPTIONS: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/** Icon button with a Light / Dark / System menu, for the top bar and login page. */
export function ThemeMenu({ className }: { className?: string }) {
  const { pref, resolved, setPref } = useTheme();
  const Icon = resolved === 'dark' ? Moon : Sun;
  return (
    <DropdownMenu.Root modal={false}>
      <Tooltip content="Theme">
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label="Change theme"
            className={cn(
              'relative inline-flex h-10 w-10 items-center justify-center rounded-xl text-ink-soft transition hover:bg-canvas hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 data-[state=open]:bg-canvas',
              className,
            )}
          >
            <Icon key={resolved} className="h-[18px] w-[18px] animate-scale-in" />
          </button>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content onClick={stopPortalBubble} align="end" sideOffset={6} collisionPadding={12} className={cn(floatingPanel, 'w-40')}>
          <DropdownMenu.RadioGroup value={pref} onValueChange={(v) => setPref(v as ThemePref)}>
            {OPTIONS.map((o) => (
              <DropdownMenu.RadioItem
                key={o.value}
                value={o.value}
                className="flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft outline-none transition-colors data-[highlighted]:bg-canvas data-[highlighted]:text-heading data-[state=checked]:text-rust"
              >
                <o.icon className="h-4 w-4" />
                <span className="flex-1">{o.label}</span>
                <DropdownMenu.ItemIndicator>
                  <Check className="h-3.5 w-3.5" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
