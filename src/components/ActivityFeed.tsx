import { useNavigate } from 'react-router-dom';
import { Award, Building2, ClipboardCheck, FilePlus2, FileText, ListTodo, Megaphone, RefreshCw, ShieldCheck, UserPlus, Wallet } from 'lucide-react';
import type { Activity } from '../data/types';
import { cn, timeAgo } from '../lib/utils';

const meta: Record<Activity['kind'], { icon: typeof Award; cls: string; to: string }> = {
  application: { icon: FilePlus2, cls: 'bg-brand-50 text-rust', to: 'applications' },
  status: { icon: RefreshCw, cls: 'bg-navy-50 text-heading', to: 'applications' },
  student: { icon: UserPlus, cls: 'bg-emerald-50 text-emerald-600', to: 'students' },
  document: { icon: FileText, cls: 'bg-blue-50 text-blue-600', to: 'documents' },
  partner: { icon: Building2, cls: 'bg-violet-50 text-violet-600', to: 'partners' },
  update: { icon: Megaphone, cls: 'bg-amber-50 text-amber-600', to: 'updates' },
  assessment: { icon: ClipboardCheck, cls: 'bg-teal-50 text-teal-600', to: 'assessments' },
  payment: { icon: Wallet, cls: 'bg-emerald-50 text-emerald-600', to: 'finance' },
  task: { icon: ListTodo, cls: 'bg-navy-50 text-heading', to: 'tasks' },
  account: { icon: ShieldCheck, cls: 'bg-violet-50 text-violet-600', to: 'users' },
};

export function ActivityFeed({ items, base }: { items: Activity[]; base: string }) {
  const navigate = useNavigate();
  if (!items.length) return <p className="px-5 py-8 text-center text-sm text-ink-mute">No recent activity.</p>;
  return (
    <ul className="p-3">
      {items.map((a) => {
        const m = meta[a.kind];
        const Icon = a.title.includes('Visa Granted') ? Award : m.icon;
        return (
          <li key={a.id}>
            <button type="button" onClick={() => navigate(`${base}/${m.to}`)} className="flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-canvas">
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', a.title.includes('Visa Granted') ? 'bg-emerald-50 text-emerald-600' : a.title.includes('Refused') ? 'bg-red-50 text-red-600' : m.cls)}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-heading">{a.title}</span>
                <span className="block truncate text-xs text-ink-mute">{a.detail}</span>
              </span>
              <span className="shrink-0 pt-0.5 text-[11px] text-ink-mute">{timeAgo(a.at)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
