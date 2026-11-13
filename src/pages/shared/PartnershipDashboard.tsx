// Partnership Officer dashboard: agency outreach figures from saved records only (RLS: the
// officer's own agencies; administrators see all). Every card opens the filtered agency list.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Ban, Building2, CalendarClock, CheckCircle2, ClipboardList, FileSignature, Handshake, ListFilter, Moon, PhoneCall, Plus, Send, UserCheck, UserX,
} from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState } from '../../components/ui';
import { KPI } from '../../components/hr';
import { useStore } from '../../store/store';
import { canOpenPath } from '../../auth/roles';
import { greeting } from '../../lib/utils';
import {
  ACTIVITY, PROPOSAL, STAGE, agencyName, fmtDate, fmtWhen, isOpenFollowUp, matchesFilter, today, useAgencyData, type AgencyFilter,
} from '../../lib/agencies';
import { AddAgencyModal } from './Agencies';

export default function PartnershipDashboard() {
  const { session } = useStore();
  const navigate = useNavigate();
  const { data, error } = useAgencyData(true);
  const [adding, setAdding] = useState(false);
  const go = (f: AgencyFilter) => navigate(f === 'all' ? '../agencies' : `../agencies?f=${f}`, { relative: 'path' });
  const byId = useMemo(() => new Map((data?.agencies ?? []).map((a) => [a.id, a])), [data]);

  const count = (f: AgencyFilter) => (data ? data.agencies.filter((a) => matchesFilter(a, f, data)).length : '…');
  const followUps = useMemo(() => (data?.agencies ?? []).filter(isOpenFollowUp).sort((a, b) => (a.next_follow_up ?? '').localeCompare(b.next_follow_up ?? '')), [data]);
  const verified = (data?.agencies ?? []).filter((a) => a.stage === 'onboarded' && a.partner_id).length;
  const historical = (data?.agencies ?? []).filter((a) => a.stage === 'onboarded' && !a.partner_id).length;
  // Pipeline cards count agencies currently at that stage (imported or live) — not actions taken today.
  // Activity cards (added / contacted) count this month's recorded work. Daily work is in My Daily Work Report.
  const cards: { label: string; f: AgencyFilter; icon: typeof Building2; tone: 'navy' | 'orange' | 'green' | 'red' | 'amber'; value?: number | string; hint: string }[] = [
    { label: 'Total agencies', f: 'all', icon: Building2, tone: 'navy', hint: 'Every agency in the Agency List' },
    { label: 'Newly added', f: 'new_added', icon: Plus, tone: 'orange', hint: 'Added this month (imports not counted)' },
    { label: 'Agencies contacted', f: 'new_contacted', icon: PhoneCall, tone: 'orange', hint: 'First outreach recorded this month' },
    { label: 'Connected', f: 'connected', icon: UserCheck, tone: 'green', hint: 'Contact status Connected' },
    { label: 'Not connected', f: 'not_connected', icon: UserX, tone: 'amber', hint: 'Tried, not yet connected' },
    { label: 'Proposals sent', f: 'proposal_sent', icon: Send, tone: 'orange', hint: 'Currently at Proposal Sent' },
    { label: 'Proposal confirmed', f: 'proposal_confirmed', icon: CheckCircle2, tone: 'green', hint: 'Agency confirmed, onboarding next' },
    { label: 'MOU sent', f: 'mou_sent', icon: FileSignature, tone: 'navy', hint: 'Currently at MOU Sent (not signed)' },
    { label: 'Registration pending', f: 'registration_pending', icon: ClipboardList, tone: 'amber', hint: 'Form sent, submitted or under review' },
    { label: 'Onboarded partners', f: 'onboarded', icon: Handshake, tone: 'green', value: data ? verified : '…', hint: historical ? `With a partner account · +${historical} historical` : 'With a partner account' },
    { label: 'Inactive agencies', f: 'inactive', icon: Moon, tone: 'navy', hint: 'Marked Inactive' },
    { label: 'Closed agencies', f: 'closed', icon: Ban, tone: 'red', hint: 'Marked Closed (kept in the list)' },
    { label: 'Pending follow-ups', f: 'follow_up', icon: CalendarClock, tone: 'amber', value: followUps.length, hint: 'Follow-up date set, still open' },
  ];
  const proposals = (data?.proposals ?? []).filter((p) => p.sent_at).slice(0, 6);
  const pending = (data?.proposals ?? []).filter((p) => p.status === 'awaiting_confirmation');
  const regs = (data?.agencies ?? []).filter((a) => ['registration_pending', 'registration_submitted', 'under_review', 'approved'].includes(a.stage));
  const onboarded = (data?.agencies ?? []).filter((a) => a.stage === 'onboarded').sort((a, b) => (b.stage_changed_at ?? '').localeCompare(a.stage_changed_at ?? '')).slice(0, 6);
  const open = (id: string) => navigate(`../agencies/${id}`, { relative: 'path' });

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-soft">{greeting()}, {session?.name?.split(' ')[0]}</p>
          <h1 className="font-display text-2xl font-semibold text-heading">Partnership development</h1>
          <p className="text-sm text-ink-soft">Agencies, proposals and onboarding — from your saved work.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canOpenPath(session, 'course-search') && <Button variant="secondary" icon={ListFilter} onClick={() => navigate('../course-search', { relative: 'path' })}>Advanced Course Search</Button>}
          <Button variant="secondary" icon={Building2} onClick={() => go('all')}>Agencies</Button>
          <Button icon={Plus} onClick={() => setAdding(true)}>Add Agency</Button>
        </div>
      </div>
      {error && <p className="mb-4 text-sm text-amber-700 dark:text-amber-300">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {cards.map((c) => <KPI key={c.label} label={c.label} value={c.value ?? count(c.f)} hint={c.hint} icon={c.icon} tone={c.tone} onClick={() => go(c.f)} />)}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Upcoming follow-ups" />
          <List empty="No follow-ups scheduled." items={followUps.slice(0, 8).map((a) => ({
            key: a.id, title: agencyName(a), sub: STAGE[a.stage].label, right: <span className={a.next_follow_up! < today() ? 'font-semibold text-red-600 dark:text-red-400' : ''}>{fmtDate(a.next_follow_up)}</span>, onClick: () => open(a.id),
          }))} />
        </Card>
        <Card>
          <CardHeader title="Pending confirmations" subtitle="Proposals sent, waiting for the agency" />
          <List empty="Nothing waiting." items={pending.slice(0, 8).map((p) => ({
            key: p.id, title: p.company_name, sub: `${p.reference} · sent ${fmtDate(p.sent_at)}`, right: <Badge tone="orange">{p.email_status === 'delivered' ? 'Delivered' : 'Sent'}</Badge>, onClick: () => open(p.prospect_id),
          }))} />
        </Card>
        <Card>
          <CardHeader title="Registration forms pending" />
          <List empty="No registrations in progress." items={regs.slice(0, 8).map((a) => ({
            key: a.id, title: agencyName(a), sub: a.reference, right: <Badge tone={STAGE[a.stage].tone}>{STAGE[a.stage].label}</Badge>, onClick: () => open(a.id),
          }))} />
        </Card>
        <Card>
          <CardHeader title="Recent proposals" />
          <List empty="No proposals sent yet." items={proposals.map((p) => ({
            key: p.id, title: p.company_name, sub: `${p.reference} · ${p.arrangement.tier_label}`, right: <Badge tone={PROPOSAL[p.status].tone}>{PROPOSAL[p.status].label}</Badge>, onClick: () => open(p.prospect_id),
          }))} />
        </Card>
        <Card>
          <CardHeader title="Newly onboarded partners" />
          <List empty="No onboarded partners yet." items={onboarded.map((a) => ({
            key: a.id, title: agencyName(a), sub: fmtDate(a.stage_changed_at), right: <CheckCircle2 className="h-4 w-4 text-emerald-500" />, onClick: () => open(a.id),
          }))} />
        </Card>
        <Card>
          <CardHeader title="Recent agency activity" />
          <List empty="No activity yet." items={(data?.activities ?? []).slice(0, 8).map((h) => {
            const a = byId.get(h.prospect_id);
            return { key: String(h.id), title: ACTIVITY[h.kind] ?? h.kind, sub: `${a ? agencyName(a) : ''} · ${fmtWhen(h.at)}`, onClick: () => open(h.prospect_id) };
          })} />
        </Card>
      </div>
      <AddAgencyModal open={adding} onClose={() => setAdding(false)} onCreated={open} />
    </>
  );
}

function List({ items, empty }: { items: { key: string; title: string; sub?: string; right?: React.ReactNode; onClick: () => void }[]; empty: string }) {
  if (!items.length) return <div className="px-5 pb-5"><EmptyState icon={Building2} title={empty} /></div>;
  return (
    <ul className="px-2 pb-3">
      {items.map((i) => (
        <li key={i.key}>
          <button type="button" onClick={i.onClick} className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-canvas">
            <span className="min-w-0"><span className="block truncate text-sm font-medium text-heading">{i.title}</span>{i.sub && <span className="block truncate text-xs text-ink-mute">{i.sub}</span>}</span>
            {i.right && <span className="shrink-0 text-sm">{i.right}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
