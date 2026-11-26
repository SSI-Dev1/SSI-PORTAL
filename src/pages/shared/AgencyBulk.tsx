// Agency administration (0040): assign or change the officer of one or many agencies, correct the
// contact status in bulk, and show an agency's officer history. Every change previews first; the
// server applies it, never overwrites another officer without the explicit choice below, never
// creates calls, contact dates or work-report activity, and records each operation.
import { useEffect, useMemo, useState } from 'react';
import { History, UserCog } from 'lucide-react';
import { Alert, Badge, Button, Checkbox, Field, Input, Modal, Segmented, SelectMenu } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { supabase } from '../../auth/auth';
import { AGENCY_TYPE, CONTACT, fmtWhen, rpc, typeKey, type AgencyType, type AgencyTypeFilter, type ContactStatus } from '../../lib/agencies';

export interface OfficerCandidate { id: string; full_name: string; designation: string | null; department: string | null }

/** Employees who may hold agencies (server decides: active staff with Agencies access and an HR record). */
export function useOfficerCandidates(enabled = true) {
  const [list, setList] = useState<OfficerCandidate[]>([]);
  useEffect(() => {
    if (!supabase || !enabled) return;
    let alive = true;
    void supabase.rpc('agency_officer_candidates').then(({ data }) => alive && setList((data ?? []) as OfficerCandidate[]));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return list;
}

interface OfficerPreview { selected: number; found: number; already: number; unassigned: number; other: number; officer_name: string | null; others: { officer_id: string; name: string | null; count: number }[] }

export function AssignOfficerModal({ ids, current, candidates, onClose, onDone }: {
  ids: string[]; current?: string | null; candidates: OfficerCandidate[]; onClose: () => void; onDone?: () => void;
}) {
  const toast = useToast();
  const single = ids.length === 1;
  const [officer, setOfficer] = useState('');
  const [preview, setPreview] = useState<OfficerPreview | null>(null);
  const [replace, setReplace] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [request] = useState(() => crypto.randomUUID());
  useEffect(() => {
    setPreview(null); setReplace(single); setErr('');
    if (!officer) return;
    let alive = true;
    void rpc<OfficerPreview>('preview_agency_officer', { p_ids: ids, p_officer: officer }).then((r) => {
      if (!alive) return;
      if (r.ok) setPreview(r.data); else setErr(r.error);
    });
    return () => {
      alive = false;
    };
  }, [officer, ids, single]);
  const name = candidates.find((c) => c.id === officer)?.full_name ?? '';
  const willChange = preview ? preview.unassigned + (replace ? preview.other : 0) : 0;
  const save = async () => {
    setBusy(true); setErr('');
    const r = await rpc<{ changed: number; unchanged: number; skipped_other_officer: number }>('assign_agency_officer', {
      p_ids: ids, p_officer: officer, p_replace: replace, p_note: note.trim() || null, p_request: request,
    });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    toast.success(`${r.data.changed} agenc${r.data.changed === 1 ? 'y' : 'ies'} assigned to ${name}`,
      r.data.skipped_other_officer ? `${r.data.skipped_other_officer} kept their current officer.` : undefined);
    onDone?.(); onClose();
  };
  const options = useMemo(() => candidates.filter((c) => c.id !== current).map((c) => ({ value: c.id, label: c.full_name, group: c.designation ?? 'Other employees' })), [candidates, current]);
  return (
    <Modal open onClose={onClose} title={single ? 'Change officer' : `Assign officer · ${ids.length} agencies`}
      subtitle="Only employees with Agencies access can hold agencies. Earlier work reports keep their original credit." dirty={!!officer}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !preview || willChange === 0} onClick={() => void save()}>{busy ? 'Saving…' : `Assign ${willChange || ''} to ${name || 'officer'}`}</Button></>}>
      <Field label="New officer" required>
        <SelectMenu value={officer} onChange={setOfficer} options={options} placeholder="Search employees…" searchable aria-label="New officer" />
      </Field>
      {preview && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            {[['Unassigned', preview.unassigned], ['Already ' + (preview.officer_name ?? ''), preview.already], ['With another officer', preview.other]].map(([l, v]) => (
              <div key={l as string} className="rounded-xl bg-canvas p-3"><div className="font-display text-xl font-semibold text-heading">{v}</div><div className="truncate text-[11px] text-ink-mute">{l}</div></div>
            ))}
          </div>
          {preview.other > 0 && (
            <Alert tone="warning" title={`${preview.other} agenc${preview.other === 1 ? 'y has' : 'ies have'} a different officer`}>
              <ul className="mt-1 text-xs">{preview.others.map((o) => <li key={o.officer_id}>{o.name ?? 'Unknown'} · {o.count}</li>)}</ul>
              <div className="mt-2"><Checkbox checked={replace} onCheckedChange={setReplace} label={`Also move ${preview.other === 1 ? 'it' : `these ${preview.other}`} to ${name}`} /></div>
            </Alert>
          )}
          <Field label="Note (kept in the officer history)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Default officer for the imported agency list" /></Field>
        </div>
      )}
      {err && <Alert tone="error" className="mt-3">{err}</Alert>}
    </Modal>
  );
}

// ------------------------------------------------------------------ Sub Officer (0045)
export interface SubCandidate { id: string; full_name: string; designation: string | null; department: string | null; in_team: boolean }
/** Employees the signed-in user may choose as Sub Officer under Main Officer `main` (team only, unless administrator). */
export function useSubOfficerCandidates(main: string | null | undefined) {
  const [list, setList] = useState<SubCandidate[] | null>(null);
  useEffect(() => {
    setList(null);
    if (!supabase || !main) { setList([]); return; }
    let alive = true;
    void supabase.rpc('sub_officer_candidates', { p_main: main }).then(({ data }) => alive && setList((data ?? []) as SubCandidate[]));
    return () => { alive = false; };
  }, [main]);
  return list;
}
/** Names of every Main / Sub Officer (live). */
export function useOfficerNames(enabled = true) {
  const v = useLive<Map<string, string>>('portfolio_officer_names', enabled, (d) => new Map(((d ?? []) as { id: string; full_name: string }[]).map((r) => [r.id, r.full_name])));
  return v ?? new Map<string, string>();
}
/** Application counts per agency and per client (live). */
export function useApplicationCounts(enabled = true) {
  return useLive<{ byAgency: Map<string, number>; byPartner: Map<string, number> }>('agency_application_counts', enabled, (d) => {
    const rows = (d ?? []) as { agency_id: string | null; partner_id: string; applications: number }[];
    return { byAgency: new Map(rows.filter((r) => r.agency_id).map((r) => [r.agency_id as string, Number(r.applications)])), byPartner: new Map(rows.map((r) => [r.partner_id, Number(r.applications)])) };
  }, undefined, ['partners', 'agency_prospects', 'applications']);
}

interface SubPreview { selected: number; found: number; out_of_scope: number; not_eligible: number; already: number; change: number; replacing: number; sub_name: string | null }

/**
 * Assign Sub Officer — one agency / client, or many (bulk, with preview). The Main Officer never
 * changes. Agencies outside the caller's scope, or where the employee is not in that agency's
 * Main Officer's team, are skipped by the server and reported.
 */
export function AssignSubOfficerModal({ ids, partnerId, title, main, mainName, current, currentName, onClose, onDone }: {
  ids: string[]; partnerId?: string; title: string; main: string | null; mainName: string; current?: string | null; currentName?: string;
  onClose: () => void; onDone?: () => void;
}) {
  const toast = useToast();
  const single = ids.length <= 1;
  const candidates = useSubOfficerCandidates(main);
  const [sub, setSub] = useState('');
  const [unassign, setUnassign] = useState(false);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<SubPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [request] = useState(() => crypto.randomUUID());
  const target = unassign ? null : sub || null;
  useEffect(() => {
    setPreview(null); setErr('');
    if (single || (!target && !unassign) || !ids.length) return;
    let alive = true;
    void rpc<SubPreview>('preview_agency_sub_officer', { p_ids: ids, p_sub: target }).then((r) => {
      if (!alive) return;
      if (r.ok) setPreview(r.data); else setErr(r.error);
    });
    return () => { alive = false; };
  }, [target, unassign, ids, single]);
  const options = useMemo(() => (candidates ?? []).filter((c) => c.id !== current)
    .map((c) => ({ value: c.id, label: c.full_name, group: c.in_team ? 'Team members' : 'Other eligible employees' })), [candidates, current]);
  const name = (candidates ?? []).find((c) => c.id === sub)?.full_name ?? '';
  const save = async () => {
    if (busy) return;
    if (!target && !unassign) return setErr('Choose a team member.');
    setBusy(true); setErr('');
    const r = partnerId && !ids.length
      ? await rpc<{ changed: number }>('assign_partner_sub_officer', { p_partner: partnerId, p_sub: target, p_reason: reason.trim() || null })
      : await rpc<{ changed: number; out_of_scope?: number; not_eligible?: number }>('assign_agency_sub_officer', { p_ids: ids, p_sub: target, p_reason: reason.trim() || null, p_request: request });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    const skipped = ((r.data as { out_of_scope?: number }).out_of_scope ?? 0) + ((r.data as { not_eligible?: number }).not_eligible ?? 0);
    toast.success(target ? `Sub Officer: ${name}` : 'Sub Officer removed', single ? 'New applications through this client are credited accordingly. Earlier ones keep their credit.'
      : `${r.data.changed} assigned${skipped ? ` · ${skipped} skipped (outside your team or scope)` : ''}.`);
    onDone?.(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={single ? 'Assign Sub Officer' : `Assign Sub Officer · ${ids.length} agencies`} subtitle={title} dirty={!!sub || !!reason}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || (!target && !unassign) || (!single && (!preview || preview.change === 0))} onClick={() => void save()}>
          {busy ? 'Saving…' : single ? 'Save assignment' : `Confirm: ${preview?.change ?? ''} agencies`}</Button></>}>
      <dl className="mb-4 grid gap-2 rounded-xl bg-canvas p-3 text-sm sm:grid-cols-2">
        <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Main Officer</dt><dd className="font-medium text-heading">{mainName || 'Unassigned'}</dd></div>
        {single && <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Current Sub Officer</dt><dd className="font-medium text-heading">{currentName || 'Unassigned'}</dd></div>}
      </dl>
      {!unassign && (
        <Field label="Team member" required hint="Active employees in the Main Officer's team (administrators may also choose other eligible employees)">
          {candidates === null ? <p className="text-sm text-ink-soft" role="status">Loading team…</p>
            : options.length === 0 ? <p className="text-sm text-ink-soft">No eligible team members. Ask HR to set reporting managers, or an administrator to assign.</p>
            : <SelectMenu value={sub} onChange={setSub} options={options} placeholder="Search team members…" searchable aria-label="Sub Officer" />}
        </Field>
      )}
      {(current || !single) && <div className="mt-3"><Checkbox checked={unassign} onCheckedChange={(v) => { setUnassign(!!v); setSub(''); }} label="Set to Unassigned instead" /></div>}
      {preview && !single && (
        <div className="mt-4 grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-4">
          {[['Will change', preview.change], ['Already set', preview.already], ['Outside your scope', preview.out_of_scope], ['Not in that team', preview.not_eligible]].map(([l, v]) => (
            <div key={l as string} className="rounded-xl bg-canvas p-3"><div className="font-display text-xl font-semibold text-heading">{v}</div><div className="truncate text-[11px] text-ink-mute">{l}</div></div>
          ))}
        </div>
      )}
      {preview && preview.replacing > 0 && <Alert tone="info" className="mt-3">{preview.replacing} already have another Sub Officer. Their earlier applications keep that credit.</Alert>}
      <Field label="Reason (kept in the assignment history)" className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
      {err && <Alert tone="error" className="mt-3">{err}</Alert>}
    </Modal>
  );
}

interface ContactPreview { selected: number; found: number; already: number; change: number; from: Partial<Record<ContactStatus, number>> }

export function ContactStatusModal({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone?: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<ContactStatus>('connected');
  const [preview, setPreview] = useState<ContactPreview | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [request, setRequest] = useState(() => crypto.randomUUID());
  useEffect(() => {
    setPreview(null); setErr(''); setRequest(crypto.randomUUID());
    let alive = true;
    void rpc<ContactPreview>('preview_agency_contact', { p_ids: ids, p_status: status }).then((r) => {
      if (!alive) return;
      if (r.ok) setPreview(r.data); else setErr(r.error);
    });
    return () => {
      alive = false;
    };
  }, [status, ids]);
  const save = async () => {
    setBusy(true); setErr('');
    const r = await rpc<{ changed: number }>('bulk_set_agency_contact', { p_ids: ids, p_status: status, p_note: note.trim() || null, p_request: request });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    toast.success(`${r.data.changed} agenc${r.data.changed === 1 ? 'y' : 'ies'} set to ${CONTACT[status].label}`, 'Recorded as an administrative correction.');
    onDone?.(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Contact status · ${ids.length} agencies`} subtitle="An administrative correction of the Contact Status column."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !preview || preview.change === 0} onClick={() => void save()}>{busy ? 'Saving…' : `Set ${preview?.change ?? ''} to ${CONTACT[status].label}`}</Button></>}>
      <Field label="Set contact status to"><Segmented options={[{ value: 'connected', label: 'Connected' }, { value: 'not_connected', label: 'Not connected' }, { value: 'unknown', label: 'Not recorded' }]} value={status} onChange={(v) => setStatus(v as ContactStatus)} /></Field>
      {preview && (
        <div className="mt-4 space-y-3 text-sm">
          <p><b className="text-heading">{preview.change}</b> will change{preview.already ? <>, <b className="text-heading">{preview.already}</b> already {CONTACT[status].label}</> : null}.</p>
          {preview.change > 0 && <div className="flex flex-wrap gap-1.5">{Object.entries(preview.from).map(([k, n]) => <Badge key={k} tone={CONTACT[k as ContactStatus].tone}>{n} from {CONTACT[k as ContactStatus].label}</Badge>)}</div>}
          <Alert tone="info">Only the status changes. The partnership stage stays as it is, and no calls, contact dates or daily work-report activity are recorded.</Alert>
          <Field label="Reason (kept in the audit)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Corrected from the partnership master sheet" /></Field>
        </div>
      )}
      {err && <Alert tone="error" className="mt-3">{err}</Alert>}
    </Modal>
  );
}

interface TypePreview { selected: number; found: number; already: number; change: number; from: { unclassified: number; domestic: number; international: number } }
/** Bulk Domestic / International classification (administrators): preview first, then confirm. */
export function AgencyTypeModal({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone?: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<AgencyType | ''>('');
  const [preview, setPreview] = useState<TypePreview | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [request, setRequest] = useState(() => crypto.randomUUID());
  useEffect(() => {
    setPreview(null); setErr(''); setRequest(crypto.randomUUID());
    if (!type) return;
    let alive = true;
    void rpc<TypePreview>('preview_agency_type', { p_ids: ids, p_type: type }).then((r) => {
      if (!alive) return;
      if (r.ok) setPreview(r.data); else setErr(r.error);
    });
    return () => {
      alive = false;
    };
  }, [type, ids]);
  const save = async () => {
    if (!type) return;
    setBusy(true); setErr('');
    const r = await rpc<{ changed: number }>('bulk_set_agency_type', { p_ids: ids, p_type: type, p_note: note.trim() || null, p_request: request });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    toast.success(`${r.data.changed} agenc${r.data.changed === 1 ? 'y' : 'ies'} classified ${AGENCY_TYPE[type].label}`, 'Recorded in each agency\'s history.');
    onDone?.(); onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Agency Type · ${ids.length} agencies`} subtitle="Classify the selected agencies. Nothing is inferred from country, phone or email."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !type || !preview || preview.change === 0} onClick={() => void save()}>{busy ? 'Saving…' : type ? `Confirm: set ${preview?.change ?? ''} to ${AGENCY_TYPE[type].label}` : 'Choose a type'}</Button></>}>
      <Field label="Set Agency Type to"><Segmented options={[{ value: 'domestic', label: 'Domestic' }, { value: 'international', label: 'International' }]} value={type} onChange={(v) => setType(v as AgencyType)} /></Field>
      {type && !preview && !err && <p className="mt-4 text-sm text-ink-soft" role="status">Preparing preview…</p>}
      {preview && type && (
        <div className="mt-4 space-y-3 text-sm">
          <p><b className="text-heading">{preview.change}</b> will change{preview.already ? <>, <b className="text-heading">{preview.already}</b> already {AGENCY_TYPE[type].label}</> : null}.</p>
          {preview.change > 0 && <div className="flex flex-wrap gap-1.5">{(['unclassified', 'domestic', 'international'] as const).filter((k) => preview.from[k] > 0).map((k) => <Badge key={k} tone={AGENCY_TYPE[k].tone}>{preview.from[k]} from {AGENCY_TYPE[k].label}</Badge>)}</div>}
          <Alert tone="info">Only the Agency Type changes. Stage, contact status, proposals and work reports stay as they are. Linked clients in Clients &amp; Branches take the same type.</Alert>
          <Field label="Reason (kept in the audit)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Classified from the partnership master sheet" /></Field>
        </div>
      )}
      {err && <Alert tone="error" className="mt-3">{err}</Alert>}
    </Modal>
  );
}

/** Small badge: Domestic / International / Not Classified. */
export function AgencyTypeBadge({ type, hideUnclassified = false }: { type: string | null | undefined; hideUnclassified?: boolean }) {
  const k = typeKey(type);
  if (k === 'unclassified' && hideUnclassified) return null;
  return <Badge tone={AGENCY_TYPE[k].tone}>{AGENCY_TYPE[k].label}</Badge>;
}

interface OfficerChange { id: number; from_officer: string | null; to_officer: string | null; changed_by: string | null; change_kind: string; note: string | null; at: string }

export function OfficerHistory({ prospectId, nameOf, refreshKey }: { prospectId: string; nameOf: (id: string | null) => string; refreshKey?: unknown }) {
  const [rows, setRows] = useState<OfficerChange[] | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.from('agency_officer_history').select('*').eq('prospect_id', prospectId).order('at', { ascending: false }).limit(20)
      .then(({ data, error }) => alive && setRows(error ? [] : (data ?? []) as OfficerChange[]));
    return () => {
      alive = false;
    };
  }, [prospectId, refreshKey]);
  if (!rows || rows.length === 0) return null;
  const kind: Record<string, string> = { bulk: 'bulk assignment', single: 'changed', claim: 'taken', system: 'system' };
  return (
    <div className="mx-5 mb-5 rounded-xl border border-line p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-heading"><History className="h-3.5 w-3.5" />Officer history</div>
      <ol className="space-y-1.5 text-xs text-ink-soft">
        {rows.map((r) => (
          <li key={r.id}>
            <span className="text-heading">{r.from_officer ? nameOf(r.from_officer) : 'Unassigned'} → {r.to_officer ? nameOf(r.to_officer) : 'Unassigned'}</span>
            {' '}· {kind[r.change_kind] ?? r.change_kind} by {nameOf(r.changed_by)} · {fmtWhen(r.at)}{r.note ? ` · “${r.note}”` : ''}
          </li>
        ))}
      </ol>
    </div>
  );
}

export const ChangeOfficerIcon = UserCog;

// ------------------------------------------------------------------ Clients & Branches link
export interface OnboardedAgency {
  agency_id: string; reference: string; company_name: string | null; contact_name: string | null; phone: string | null; email: string | null; country: string | null;
  assigned_officer: string | null; officer_name: string | null; partner_id: string | null; verification: 'verified' | 'pending'; historical: boolean;
  needs_reconciliation: boolean; reconciliation_note: string | null; source_status: string | null; registration_id: string | null; registration_status: string | null;
  suggested_partner_id: string | null; suggested_partner_name: string | null; stage_changed_at: string | null; agency_type: AgencyType | null;
}

/** Onboarded agencies (verified = linked to a partner; pending = historically onboarded), kept live. */
export function useOnboardedDirectory(enabled = true) {
  const [rows, setRows] = useState<OnboardedAgency[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!supabase || !enabled) return;
    const sb = supabase;
    let alive = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    const load = () => void sb.rpc('onboarded_agency_directory').then(({ data, error: e }) => {
      if (!alive) return;
      setError(!!e);
      setRows(e ? [] : (data ?? []) as OnboardedAgency[]);
    });
    const soon = () => { clearTimeout(t); t = setTimeout(load, 300); };
    load();
    // An agency becoming onboarded, a partner being created / activated, or a registration moving on.
    const ch = sb.channel(`onboarded-${Math.random().toString(36).slice(2, 8)}`);
    for (const table of ['agency_prospects', 'partners', 'partner_registrations']) ch.on('postgres_changes', { event: '*', schema: 'public', table }, soon);
    ch.subscribe();
    const onFocus = () => document.visibilityState === 'visible' && soon();
    document.addEventListener('visibilitychange', onFocus);
    return () => { alive = false; clearTimeout(t); document.removeEventListener('visibilitychange', onFocus); void sb.removeChannel(ch); };
  }, [enabled]);
  return { rows, error };
}

// ------------------------------------------------------------------ business onboarding vs portal access (0042)
export type BusinessStatus = 'historical' | 'verified' | 'not_onboarded';
export type PortalStatus = 'no_account' | 'pending' | 'active' | 'suspended' | 'deactivated';
export interface PartnerStatusRow { partner_id: string; business_status: BusinessStatus; portal_status: PortalStatus; onboarding_source: 'portal' | 'historical'; users: number; agency_id: string | null; agency_reference: string | null; agency_type: AgencyType | null; main_officer_id: string | null; sub_officer_id: string | null }
export interface OnboardingSummary { total: number; historical: number; verified: number; unlinked: number; portal_active: number; no_account: number; mine: number }
export const BUSINESS: Record<BusinessStatus, { label: string; tone: 'green' | 'navy' | 'slate' }> = {
  historical: { label: 'Historically onboarded', tone: 'navy' }, verified: { label: 'Verified onboarded', tone: 'green' }, not_onboarded: { label: 'Not onboarded', tone: 'slate' },
};
export const PORTAL: Record<PortalStatus, { label: string; tone: 'slate' | 'amber' | 'green' | 'red' }> = {
  no_account: { label: 'Portal: Not activated', tone: 'slate' }, pending: { label: 'Portal: Pending', tone: 'amber' }, active: { label: 'Portal: Active', tone: 'green' },
  suspended: { label: 'Portal: Suspended', tone: 'red' }, deactivated: { label: 'Portal: Deactivated', tone: 'slate' },
};

/** Server-calculated status per partner and the Onboarded KPI, re-read on any agency, partner or account change. */
function useLive<T>(fn: string, enabled: boolean, map: (d: unknown) => T, args?: Record<string, unknown>, tables: string[] = ['agency_prospects', 'partners', 'profiles']): T | null {
  const key = JSON.stringify(args ?? {});
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    if (!supabase || !enabled) return;
    const sb = supabase;
    let alive = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    const load = () => void sb.rpc(fn, args).then(({ data, error }) => alive && !error && setV(map(data)));
    const soon = () => { clearTimeout(t); t = setTimeout(load, 300); };
    load();
    const ch = sb.channel(`${fn}-${Math.random().toString(36).slice(2, 8)}`);
    for (const table of tables) ch.on('postgres_changes', { event: '*', schema: 'public', table }, soon);
    ch.subscribe();
    const onFocus = () => document.visibilityState === 'visible' && soon();
    document.addEventListener('visibilitychange', onFocus);
    return () => { alive = false; clearTimeout(t); document.removeEventListener('visibilitychange', onFocus); void sb.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, enabled, key]);
  return v;
}
/** type: '' = all, or 'domestic' / 'international' / 'unclassified' (same rule as the Agency List filter). */
export const useOnboardingSummary = (enabled = true, type: AgencyTypeFilter = '') =>
  useLive<OnboardingSummary>('partnership_onboarding_summary', enabled, (d) => d as OnboardingSummary, type ? { p_type: type } : undefined);
export const usePartnerStatus = (enabled = true) =>
  useLive<Map<string, PartnerStatusRow>>('partner_directory_status', enabled, (d) => new Map(((d ?? []) as PartnerStatusRow[]).map((r) => [r.partner_id, r])));
