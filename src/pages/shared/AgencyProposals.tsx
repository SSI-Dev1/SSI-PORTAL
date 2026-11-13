// Partnership Management → Proposals / Partner Registrations (tracking views for Partnership
// Officers). Proposals: every proposal sent from the Agency List. Registrations: agencies whose
// registration is in progress — approval and partner accounts stay with administrators.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Send } from 'lucide-react';
import { Badge, Card, EmptyState, FilterSelect, PageHeader, Pagination, SearchInput, Table, usePaged } from '../../components/ui';
import { useStore } from '../../store/store';
import { matches } from '../../lib/utils';
import { PROPOSAL, REGISTRATION, STAGE, agencyAccess, agencyName, fmtDate, stageLabel, useAgencyData, type ProposalStatus } from '../../lib/agencies';

export default function AgencyProposals({ mode }: { mode: 'proposals' | 'registrations' }) {
  const { session } = useStore();
  const navigate = useNavigate();
  const { data } = useAgencyData(agencyAccess(session));
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const open = (id: string) => navigate(`../${id}`, { relative: 'path' });

  const proposals = useMemo(() => (data?.proposals ?? []).filter((p) => (!status || p.status === status) && matches(q, p.company_name, p.recipient_name, p.recipient_email, p.reference)), [data, q, status]);
  const regs = useMemo(() => (data?.agencies ?? []).filter((a) => !!a.registration_id || ['registration_pending', 'registration_submitted', 'under_review', 'approved'].includes(a.stage))
    .filter((a) => (!status || a.stage === status) && matches(q, a.company_name ?? '', a.contact_name ?? '', a.email ?? '', a.reference)), [data, q, status]);
  const pagedP = usePaged(proposals, 15, `${q}|${status}`);
  const pagedR = usePaged(regs, 15, `${q}|${status}`);
  const regOf = (id: string | null) => (id ? data?.registrations.find((r) => r.id === id) : undefined);

  if (mode === 'proposals') return (
    <>
      <PageHeader title="Proposals" subtitle="Partnership proposals sent from the Agency List. Opening a proposal email never confirms it — the agency confirms on a secure page." />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search agency, contact, email…" className="w-full sm:w-72" />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, ...(Object.keys(PROPOSAL) as ProposalStatus[]).map((k) => ({ value: k, label: PROPOSAL[k].label }))]} />
        </div>
        {!data ? <p className="p-6 text-sm text-ink-soft" role="status">Loading…</p> : proposals.length === 0 ? <EmptyState icon={Send} title="No proposals" description="Send one from an agency in the Agency List." /> : (
          <>
            <Table className="hr-table" head={['Proposal', 'Agency', 'Commission', 'Status', 'Email', 'Sent', 'Confirmed']}>
              {pagedP.rows.map((p) => (
                <tr key={p.id} className="cursor-pointer" onClick={() => open(p.prospect_id)}>
                  <td className="whitespace-nowrap font-medium text-heading">{p.reference}</td>
                  <td className="min-w-[180px]">{p.company_name}<div className="text-xs text-ink-mute">{p.recipient_name} · {p.recipient_email}</div></td>
                  <td className="text-sm">{p.arrangement.tier_label}<div className="text-xs text-ink-mute">{p.arrangement.universities.length} universities</div></td>
                  <td><Badge tone={PROPOSAL[p.status].tone}>{PROPOSAL[p.status].label}</Badge></td>
                  <td className="text-xs text-ink-soft">{p.email_status === 'delivered' ? 'Delivered' : p.email_status === 'accepted' ? 'Accepted (not yet delivered)' : p.email_status === 'failed' ? 'Failed' : '—'}</td>
                  <td className="whitespace-nowrap text-sm">{fmtDate(p.sent_at)}</td>
                  <td className="whitespace-nowrap text-sm">{fmtDate(p.confirmed_at)}</td>
                </tr>
              ))}
            </Table>
            <Pagination page={pagedP.page} pages={pagedP.pages} onPage={pagedP.setPage} total={proposals.length} label="proposals" />
          </>
        )}
      </Card>
    </>
  );

  return (
    <>
      <PageHeader title="Partner Registrations" subtitle="Agencies whose registration form is out or under review. SSI GLOBAL administrators approve registrations and create partner accounts." />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search agency…" className="w-full sm:w-72" />
          <FilterSelect label="Stage" value={status} onChange={setStatus} options={[{ value: '', label: 'All stages' }, ...['registration_pending', 'registration_submitted', 'under_review', 'approved', 'onboarded', 'closed'].map((k) => ({ value: k, label: STAGE[k as keyof typeof STAGE].label }))]} />
        </div>
        {!data ? <p className="p-6 text-sm text-ink-soft" role="status">Loading…</p> : regs.length === 0 ? <EmptyState icon={ClipboardList} title="No registrations in progress" description="A registration form is sent when an agency confirms its proposal." /> : (
          <>
            <Table className="hr-table" head={['Agency', 'Contact', 'Stage', 'Registration', 'Updated']}>
              {pagedR.rows.map((a) => {
                const r = regOf(a.registration_id);
                return (
                  <tr key={a.id} className="cursor-pointer" onClick={() => open(a.id)}>
                    <td className="min-w-[180px] font-medium text-heading">{agencyName(a)}<div className="text-xs font-normal text-ink-mute">{a.reference}</div></td>
                    <td className="text-sm">{a.contact_name ?? '—'}<div className="text-xs text-ink-mute">{a.email ?? '—'}</div></td>
                    <td><Badge tone={STAGE[a.stage].tone}>{stageLabel(a)}</Badge></td>
                    <td className="text-sm">{r ? <>{r.reference} · <Badge tone={REGISTRATION[r.status]?.tone ?? 'slate'}>{REGISTRATION[r.status]?.label ?? r.status}</Badge></> : a.registration_id ? 'Issued' : 'Waiting for a link'}</td>
                    <td className="whitespace-nowrap text-sm">{fmtDate(a.updated_at)}</td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={pagedR.page} pages={pagedR.pages} onPage={pagedR.setPage} total={regs.length} label="agencies" />
          </>
        )}
      </Card>
    </>
  );
}
