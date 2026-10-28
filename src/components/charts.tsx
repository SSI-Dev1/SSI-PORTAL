import { useMemo, useState, type ComponentProps } from 'react';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip, XAxis, YAxis } from 'recharts';
import type { Application, AppStatus, University } from '../data/types';
import { countryFlag } from '../lib/utils';
import { useChartColors } from '../theme/theme';

const tooltipBase = { borderRadius: 12, boxShadow: '0 12px 32px -12px rgba(6,36,47,.25)', fontSize: 12 };

export function monthlyTrend(apps: Application[], months: number) {
  const now = new Date();
  const buckets = Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString('en-GB', { month: 'short' }), Applications: 0, Offers: 0, Visas: 0 };
  });
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  const keyOf = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth()}`;
  };
  apps.forEach((a) => {
    const i = idx.get(keyOf(a.appliedAt));
    if (i !== undefined) buckets[i].Applications++;
    // Count each application once: the month of its first offer, and of its visa grant.
    const offer = a.timeline.find((t) => t.status === 'Conditional Offer' || t.status === 'Unconditional Offer');
    const visa = a.timeline.find((t) => t.status === 'Visa Granted');
    const j = offer && idx.get(keyOf(offer.at));
    if (j !== undefined) buckets[j].Offers++;
    const k = visa && idx.get(keyOf(visa.at));
    if (k !== undefined) buckets[k].Visas++;
  });
  return buckets;
}

export function TrendChart({ apps, months = 6, height = 260 }: { apps: Application[]; months?: number; height?: number }) {
  const data = useMemo(() => monthlyTrend(apps, months), [apps, months]);
  const c = useChartColors();
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="gApps" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FBA51E" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#FBA51E" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gOffers" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c.navy} stopOpacity={0.18} />
              <stop offset="100%" stopColor={c.navy} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={c.grid} strokeDasharray="4 4" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: c.tick }} dy={6} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: c.tickMute }} allowDecimals={false} />
          <Tooltip contentStyle={{ ...tooltipBase, ...c.tooltip }} cursor={{ stroke: '#FBA51E', strokeDasharray: '4 4' }} />
          <Area type="monotone" dataKey="Applications" stroke="#E58A0E" strokeWidth={2.5} fill="url(#gApps)" dot={{ r: 3.5, fill: c.dot, stroke: '#B94A12', strokeWidth: 2 }} activeDot={{ r: 6, fill: '#B94A12' }} animationDuration={1100} />
          <Area type="monotone" dataKey="Offers" stroke={c.navy} strokeWidth={2} fill="url(#gOffers)" dot={false} animationDuration={1300} />
          <Area type="monotone" dataKey="Visas" stroke="#16A34A" strokeWidth={2} fill="transparent" strokeDasharray="5 4" dot={false} animationDuration={1500} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const donutColors: Record<string, string> = {
  'In Progress': '#94A3B8',
  'Offers Pending': '#FBA51E',
  'Offers Received': '#E58A0E',
  'Visa Lodged': '#B94A12',
  'Visa Granted': '#06242F',
  'Visa Refused': '#DC2626',
};

export function overviewGroups(apps: Application[]) {
  const group = (s: AppStatus) =>
    s === 'Draft' || s === 'Pending Assessment' || s === 'Submitted'
      ? 'In Progress'
      : s === 'Offer Pending'
        ? 'Offers Pending'
        : s === 'Conditional Offer' || s === 'Unconditional Offer'
          ? 'Offers Received'
          : s;
  const counts: Record<string, number> = {};
  Object.keys(donutColors).forEach((k) => (counts[k] = 0));
  apps.forEach((a) => counts[group(a.status)]++);
  return Object.entries(counts).map(([name, value]) => ({ name, value, color: donutColors[name] }));
}

export function StatusDonut({ apps, onSelect }: { apps: Application[]; onSelect?: (group: string) => void }) {
  const c = useChartColors();
  const data = useMemo(() => overviewGroups(apps).map((d) => (d.name === 'Visa Granted' ? { ...d, color: c.navy } : d)), [apps, c.navy]);
  const total = apps.length;
  const [active, setActive] = useState<number | undefined>();
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative h-48 w-48 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius={58}
              outerRadius={86}
              paddingAngle={2}
              stroke="none"
              activeIndex={active}
              activeShape={(p: unknown) => {
                const props = p as ComponentProps<typeof Sector>;
                return <Sector {...props} outerRadius={(props.outerRadius as number) + 6} />;
              }}
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(undefined)}
              onClick={(d) => onSelect?.((d as { name: string }).name)}
              animationDuration={1000}
              cornerRadius={4}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} className={onSelect ? 'cursor-pointer' : undefined} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-3xl font-semibold text-heading">{active !== undefined ? data[active].value : total}</span>
          <span className="text-[11px] font-medium text-ink-mute">{active !== undefined ? data[active].name : 'Total'}</span>
        </div>
      </div>
      <ul className="w-full space-y-2.5">
        {data.map((d, i) => (
          <li key={d.name} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(undefined)} className="flex items-center gap-2.5 text-[13px]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
            <span className="min-w-0 flex-1 truncate text-ink-soft">{d.name}</span>
            <span className="font-semibold text-heading">{d.value}</span>
            <span className="w-9 text-right text-[11px] text-ink-mute">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TopCountries({ apps, universities, onSelect }: { apps: Application[]; universities: University[]; onSelect?: (country: string) => void }) {
  const rows = useMemo(() => {
    const uniCountry = new Map(universities.map((u) => [u.id, u.country]));
    const m = new Map<string, number>();
    apps.forEach((a) => {
      const c = uniCountry.get(a.universityId);
      if (c) m.set(c, (m.get(c) ?? 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [apps, universities]);
  const max = rows[0]?.[1] ?? 1;
  return (
    <ul className="space-y-3.5">
      {rows.map(([country, n], i) => (
        <li key={country}>
          <button type="button" onClick={() => onSelect?.(country)} className="group w-full text-left">
            <div className="mb-1.5 flex items-center gap-2.5 text-sm">
              <span className="text-lg leading-none">{countryFlag[country]}</span>
              <span className="flex-1 font-medium text-heading group-hover:text-rust">{country}</span>
              <span className="font-semibold text-heading">{n}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-canvas">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{ width: `${(n / max) * 100}%`, background: i === 0 ? 'linear-gradient(90deg,#B94A12,#FBA51E)' : i < 3 ? '#FBA51E' : '#FDDBA0' }}
              />
            </div>
          </button>
        </li>
      ))}
      {rows.length === 0 && <li className="text-sm text-ink-mute">No data yet.</li>}
    </ul>
  );
}
