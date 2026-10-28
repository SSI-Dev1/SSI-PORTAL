// Small branded controls built on Radix primitives (keyboard, ARIA and focus handled there).
import type { ReactNode } from 'react';
import * as RTooltip from '@radix-ui/react-tooltip';
import * as RCheckbox from '@radix-ui/react-checkbox';
import * as RSwitch from '@radix-ui/react-switch';
import * as RSlider from '@radix-ui/react-slider';
import { Check, Minus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { usePortalContainer } from './layer';

export const TooltipProvider = RTooltip.Provider;

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  const container = usePortalContainer();
  if (!content) return <>{children}</>;
  return (
    <RTooltip.Root delayDuration={300}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal container={container}>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-[90] max-w-xs rounded-lg bg-navy px-2.5 py-1.5 text-xs font-medium text-white shadow-lift data-[state=closed]:animate-pop-out data-[state=delayed-open]:animate-pop-in data-[state=instant-open]:animate-pop-in dark:bg-[#1d3a46]"
        >
          {content}
          <RTooltip.Arrow className="fill-navy dark:fill-[#1d3a46]" width={10} height={5} />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className,
  id,
}: {
  checked: boolean | 'indeterminate';
  onCheckedChange: (v: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const box = (
    <RCheckbox.Root
      id={id}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      className={cn(
        'peer flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border border-line bg-surface transition',
        'hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-1',
        'data-[state=checked]:border-rust data-[state=checked]:bg-rust data-[state=indeterminate]:border-rust data-[state=indeterminate]:bg-rust',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      <RCheckbox.Indicator className="text-white">
        {checked === 'indeterminate' ? <Minus className="h-3 w-3" strokeWidth={3} /> : <Check className="h-3 w-3" strokeWidth={3} />}
      </RCheckbox.Indicator>
    </RCheckbox.Root>
  );
  if (!label) return box;
  return (
    <label className={cn('flex cursor-pointer select-none items-start gap-2.5', disabled && 'cursor-not-allowed opacity-60', className)}>
      <span className="mt-[1px]">{box}</span>
      <span>
        <span className="block text-sm text-ink-soft">{label}</span>
        {description && <span className="block text-xs text-ink-mute">{description}</span>}
      </span>
    </label>
  );
}

export function Switch({ checked, onCheckedChange, label, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative h-6 w-11 shrink-0 rounded-full bg-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 disabled:opacity-50 data-[state=checked]:bg-rust"
    >
      <RSwitch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
    </RSwitch.Root>
  );
}

export function Slider({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  label,
  format,
}: {
  value: number;
  onValueChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  format?: (v: number) => string;
}) {
  return (
    <RSlider.Root
      value={[value]}
      onValueChange={([v]) => onValueChange(v)}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      className="relative flex h-6 w-full touch-none select-none items-center"
    >
      <RSlider.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-slate-200">
        <RSlider.Range className="absolute h-full rounded-full bg-gradient-to-r from-brand to-rust" />
      </RSlider.Track>
      <RSlider.Thumb
        aria-valuetext={format?.(value)}
        className="block h-5 w-5 rounded-full border-2 border-rust bg-surface shadow-card transition hover:scale-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25"
      />
    </RSlider.Root>
  );
}
