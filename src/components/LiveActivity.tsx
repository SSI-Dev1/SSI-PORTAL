// Live Activity for the Admin Dashboard. Entries are written by database triggers (and the
// admin-users function for account events) and stamped server-side with who acted, so
// nothing here comes from browser-supplied descriptions. New rows arrive via Realtime.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity as ActivityIcon, CheckCircle2 } from 'lucide-react';
import type { Activity } from '../data/types';
import { Badge, Card, CardHeader, Segmented } from './ui';
import { ROLE_LABEL, isStaffRole } from '../auth/roles';
import type { UserRole } from '../data/types';
import { cn, formatDateTime, timeAgo } from '../lib/utils';

const TARGET: Record<Activity['kind'], string> = {
  application: 'applications',
  status: 'applications',
  student: 'students',
  document: 'documents',
  partner: 'partners',
  update: 'updates',
  assessment: 'assessments',
  payment: 'finance',
  task: 'tasks',
  account: 'users',
};

export function LiveActivity({ items, base = '/admin' }: { items: Activity[]; base?: string }) {
  const navigate = useNavigate();
  const [who, setWho] = useState<'all' | 'partner' | 'staff'>('all');
  // Highlight entries that arrive after the dashboard opened.
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ids = items.map((a) => String(a.id));
    if (known.current) {
      const added = ids.filter((id) => !known.current!.has(id));
      if (added.length) {
        setFresh((f) => new Set([...f, ...added]));
        const t = window.setTimeout(() => setFresh((f) => new Set([...f].filter((id) => !added.includes(id)))), 4000);
        known.current = new Set(ids);
        return () => window.clearTimeout(t);
      }
    }
    known.current = new Set(ids);
  }, [items]);

  const rows = items
    .filter((a) => {
      if (who === 'all') return true;
      const r = a.actorRole as UserRole | undefined;
      return who === 'partner' ? r === 'partner_admin' || r === 'partner_staff' : !!r && isStaffRole(r);
    })
    .slice(0, 15);

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Live Activity
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
          </span>
        }
        subtitle="What partners and staff are doing right now, recorded by the server"
        action={<Segmented value={who} onChange={setWho} options={[{ value: 'all', label: 'All' }, { value: 'partner', label: 'Partners' }, { value: 'staff', label: 'Staff' }]} />}
      />
      {rows.length === 0 ? (
        <div className="flex flex-col items-center px-5 py-10 text-center text-sm text-ink-mute">
          <ActivityIcon className="mb-2 h-5 w-5" />
          No activity yet. Actions by partners and staff will appear here instantly.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-y border-line bg-canvas/60 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-mute">
                <th className="px-5 py-2.5">Who</th>
                <th className="px-5 py-2.5">Organisation</th>
                <th className="px-5 py-2.5">Activity</th>
                <th className="px-5 py-2.5">Related</th>
                <th className="px-5 py-2.5">When</th>
                <th className="px-5 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((a) => {
                const role = a.actorRole as UserRole | undefined;
                const partnerSide = role === 'partner_admin' || role === 'partner_staff';
                return (
                  <tr
                    key={a.id}
                    onClick={() => navigate(`${base}/${TARGET[a.kind]}`)}
                    className={cn('cursor-pointer transition-colors duration-1000 hover:bg-canvas', fresh.has(String(a.id)) && 'animate-fade-in bg-brand-50/60 dark:bg-brand-500/10')}
                  >
                    <td className="px-5 py-3">
                      <div className="font-semibold text-heading">{a.actorName ?? 'System'}</div>
                      {role && <Badge tone={partnerSide ? 'orange' : 'navy'} className="mt-0.5">{ROLE_LABEL[role] ?? role}</Badge>}
                    </td>
                    <td className="px-5 py-3 text-ink-soft">{a.actorOrg ?? '—'}</td>
                    <td className="px-5 py-3 font-medium text-heading">{a.title}</td>
                    <td className="max-w-[220px] px-5 py-3 text-ink-soft">
                      <span className="block truncate">{a.studentName ? `${a.studentName}${a.detail && a.detail !== a.studentName ? ` · ${a.detail}` : ''}` : a.detail || '—'}</span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-xs text-ink-soft" title={formatDateTime(a.at)}>{timeAgo(a.at)}</td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
