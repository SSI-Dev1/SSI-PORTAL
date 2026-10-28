import type { ReactNode } from 'react';
import { BellRing, CalendarHeart, FileCheck2, GraduationCap, Plane, Settings2, type LucideIcon } from 'lucide-react';
import { Badge } from './ui';
import type { Announcement, Priority, UpdateCategory } from '../data/types';
import { cn, formatDate, updateStatus, type Tone } from '../lib/utils';

export const categoryMeta: Record<UpdateCategory, { icon: LucideIcon; bg: string; fg: string }> = {
  Admissions: { icon: GraduationCap, bg: 'from-brand-100 to-brand-50', fg: 'text-rust' },
  'Visa Updates': { icon: Plane, bg: 'from-blue-100 to-sky-50', fg: 'text-blue-600' },
  Documentation: { icon: FileCheck2, bg: 'from-emerald-100 to-emerald-50', fg: 'text-emerald-600' },
  Scholarships: { icon: BellRing, bg: 'from-amber-100 to-orange-50', fg: 'text-amber-600' },
  'System Updates': { icon: Settings2, bg: 'from-violet-100 to-indigo-50', fg: 'text-violet-600' },
  Events: { icon: CalendarHeart, bg: 'from-rose-100 to-pink-50', fg: 'text-rose-500' },
};

export const priorityTone: Record<Priority, Tone> = { High: 'rust', Medium: 'blue', Normal: 'slate' };
export const statusTone = { Active: 'green', Scheduled: 'amber', Expired: 'slate', Draft: 'slate' } as const;

export function UpdateCard({ a, actions, compact }: { a: Announcement; actions?: ReactNode; compact?: boolean }) {
  const meta = categoryMeta[a.category];
  const st = updateStatus(a);
  return (
    <article className={cn('group flex flex-col gap-4 py-5 sm:flex-row', compact && 'py-4')}>
      <div className={cn('relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br', meta.bg, compact ? 'h-16 w-16' : 'h-28 w-full sm:w-44')}>
        <div className="absolute -bottom-6 -right-6 h-20 w-20 rotate-45 rounded-2xl bg-surface/40" />
        <meta.icon className={cn('relative transition duration-500 group-hover:scale-110', meta.fg, compact ? 'h-7 w-7' : 'h-12 w-12')} strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-[16px] font-semibold text-heading">{a.title}</h3>
          <Badge tone={priorityTone[a.priority]}>{a.priority} Priority</Badge>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xs font-medium text-ink-soft">
          <meta.icon className="h-3.5 w-3.5" /> {a.category}
          {a.audience !== 'all' && <span className="ml-1 text-ink-mute">· Targeted</span>}
        </div>
        <p className={cn('mt-2 text-sm leading-relaxed text-ink-soft', compact && 'line-clamp-2')}>{a.body}</p>
      </div>
      <div className="flex shrink-0 items-start justify-between gap-4 sm:w-52 sm:flex-col sm:justify-start">
        <div className="flex w-full items-start justify-between gap-2">
          <Badge tone={statusTone[st]} dot>
            {st}
          </Badge>
          {actions}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {st === 'Draft' ? (
            <>
              <dt className="text-ink-mute">Created:</dt>
              <dd className="font-medium text-ink-soft">{formatDate(a.createdAt)}</dd>
            </>
          ) : (
            <>
              <dt className="text-ink-mute">{st === 'Scheduled' ? 'Publish on:' : 'Published:'}</dt>
              <dd className="font-medium text-ink-soft">{formatDate(a.publishAt)}</dd>
            </>
          )}
          <dt className="text-ink-mute">Expires:</dt>
          <dd className="font-medium text-ink-soft">{formatDate(a.expiresAt)}</dd>
        </dl>
      </div>
    </article>
  );
}
