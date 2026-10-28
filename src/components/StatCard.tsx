import { useEffect, useId, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { Tooltip } from './ds/controls';

export function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  delta,
  spark,
  onClick,
  tone = 'orange',
  delay = 0,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  delta?: number;
  spark?: number[];
  onClick?: () => void;
  tone?: 'orange' | 'navy' | 'green' | 'red';
  delay?: number;
}) {
  const shown = useCountUp(value);
  const gid = 'sp' + useId().replace(/:/g, '');
  const toneCls = {
    orange: 'bg-brand-50 text-rust ring-brand-100',
    navy: 'bg-navy-50 text-heading ring-navy-100',
    green: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    red: 'bg-red-50 text-red-600 ring-red-100',
  }[tone];
  const sparkColor = { orange: '#FBA51E', navy: '#2A4F5C', green: '#16A34A', red: '#DC2626' }[tone];
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        'group relative flex animate-fade-up flex-col overflow-hidden rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition duration-300 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lift sm:p-5',
        onClick && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset transition group-hover:scale-105', toneCls)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        {delta !== undefined && (
          <Tooltip content="Compared with last month">
          <span tabIndex={0} className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand/60', delta >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500')}>
            {delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
          </Tooltip>
        )}
      </div>
      <div className="mt-3 text-[12.5px] font-medium leading-tight text-ink-soft">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="font-display text-[26px] font-semibold leading-none tracking-tight text-heading">{shown.toLocaleString()}</div>
        {spark && (
          <div className="h-8 w-16 shrink-0 opacity-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={spark.map((v, i) => ({ i, v }))}>
                <defs>
                  <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparkColor} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={1.6} fill={`url(#${gid})`} isAnimationActive />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Comp>
  );
}
