// University Preferences on the Student Profile (0061): the primary choice first, then the other
// options, each with its own course, intake and application details as imported. "Set as Primary
// Choice" moves the primary in one server transaction (who / when recorded); nothing is deleted.
import { useState } from 'react';
import { AlertTriangle, GraduationCap, Star } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, EmptyState } from './ui';
import { useToast } from './feedback';
import { useStore } from '../store/store';
import { rpc } from '../lib/agencies';
import { preferenceProgress, useUniversityPreferences, type UniversityPreference } from '../lib/studentPreferences';
import { cn } from '../lib/utils';

const day = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null);

export function UniversityPreferencesCard({ studentId, conflict }: { studentId: string; conflict?: boolean }) {
  const { session } = useStore();
  const toast = useToast();
  const { rows, error } = useUniversityPreferences(true, studentId);
  const [busy, setBusy] = useState('');
  const canEdit = session?.userRole === 'super_admin' || !!session?.permissions.includes('students');
  const primary = (rows ?? []).filter((r) => r.is_primary);
  const others = (rows ?? []).filter((r) => !r.is_primary);
  const setPrimary = async (p: UniversityPreference) => {
    setBusy(p.id);
    const r = await rpc('set_primary_university', { p_pref: p.id });
    setBusy('');
    if (!r.ok) return toast.error('Not saved', r.error);
    toast.success('Primary choice updated', p.university_name);
  };
  if (rows && rows.length === 0 && !error) return null;
  return (
    <Card className="lg:col-span-3">
      <CardHeader title="University Preferences" subtitle={rows ? `${rows.length} university choice${rows.length === 1 ? '' : 's'} · the primary choice first` : undefined} />
      <div className="space-y-4 px-5 pb-5">
        {error && <Alert tone="warning">{error}</Alert>}
        {!rows && <p className="text-sm text-ink-soft" role="status">Loading…</p>}
        {conflict && primary.length === 0 && (
          <Alert tone="warning" title="Priority conflict — review required">The sheet marked more than one university as Priority 1. Choose the student's primary university below.</Alert>
        )}
        {primary.map((p) => <Choice key={p.id} p={p} primary />)}
        {others.length > 0 && <h4 className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Other university options</h4>}
        {others.map((p) => (
          <Choice key={p.id} p={p} action={canEdit ? <Button size="sm" variant="secondary" icon={Star} disabled={!!busy} loading={busy === p.id} onClick={() => void setPrimary(p)}>Set as Primary Choice</Button> : undefined} />
        ))}
        {rows?.length === 0 && !error && <EmptyState icon={GraduationCap} title="No university choices" />}
      </div>
    </Card>
  );
}

function Choice({ p, primary, action }: { p: UniversityPreference; primary?: boolean; action?: React.ReactNode }) {
  const prog = preferenceProgress(p);
  const fields: [string, string | null][] = [
    ['Course', p.course_name], ['Program intake', p.program_intake], ['Country', p.country], ['Application portal', p.application_portal],
    ['Application submitted', p.application_submitted], ['Submission date', day(p.submission_date)], ['Application status', p.application_status],
    ['Pending documents', p.pending_documents], ['Offer status', p.offer_status], ['Offer status date', day(p.offer_status_date)],
    ['Current status', p.current_status], ['Current status date', day(p.current_status_date)], ['Payment', p.payment],
    ['Payment status date', day(p.payment_status_date)], ['Deferral details', p.deferral_details], ['Visa status', p.visa_status],
    ['Visa status date', day(p.visa_status_date)], ['Remarks', p.remarks],
  ];
  return (
    <section className={cn('rounded-2xl border p-4', primary ? 'border-brand-300 bg-brand-50/40 dark:border-brand-500/40 dark:bg-brand-500/10' : 'border-line')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-[15px] font-semibold text-heading">{p.university_name}</h3>
            {primary ? <Badge tone="orange" dot>Primary Choice</Badge> : <Badge tone="slate">Other option</Badge>}
            <Badge tone={prog.tone}>{prog.label}</Badge>
          </div>
          {p.primary_set_at && <p className="mt-0.5 text-[11px] text-ink-mute">Primary set {day(p.primary_set_at.slice(0, 10))}</p>}
        </div>
        {action}
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {fields.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="min-w-0"><dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{k}</dt><dd className="break-words text-heading">{v}</dd></div>
        ))}
      </dl>
      {p.date_issues.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Kept as written (not a valid date): {p.date_issues.map((c) => `${c} “${p.source[c] ?? ''}”`).join(' · ')}</p>
      )}
      {p.source.row && <p className="mt-1 text-[11px] text-ink-mute">Imported from sheet row {p.source.row}</p>}
    </section>
  );
}
