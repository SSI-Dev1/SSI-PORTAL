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

/** Administrators: link a historically onboarded agency to an existing partner (never creates one). */
export function LinkPartnerModal({ agency, partners, onClose }: {
  agency: OnboardedAgency; partners: { id: string; name: string; status: string; portalEnabled?: boolean }[]; onClose: () => void;
}) {
  const toast = useToast();
  const [partner, setPartner] = useState(agency.suggested_partner_id ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    const r = await rpc('reconcile_agency', { p_id: agency.agency_id, p_partner: partner, p_note: note.trim() || null });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    toast.success('Linked and verified', `${agency.company_name ?? agency.reference} now shows as this partner.`);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Verify historical partner" subtitle={`${agency.company_name ?? agency.reference} · ${agency.reference}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !partner} onClick={() => void save()}>Link and verify</Button></>}>
      <p className="mb-3 text-sm text-ink-soft">Link this agency to the partner organisation that already exists in Clients & Branches. Nothing new is created: no organisation, no login and no change to its portal access.</p>
      <Field label="Existing partner" required>
        <SelectMenu value={partner} onChange={setPartner} searchable placeholder="Search partners…" aria-label="Existing partner"
          options={partners.map((p) => ({ value: p.id, label: p.name, group: p.status === 'Active' && p.portalEnabled !== false ? 'Active' : p.status }))} />
      </Field>
      {agency.suggested_partner_id && partner === agency.suggested_partner_id && <Alert tone="info" className="mt-3">Suggested because the names match. Check it is the same company before linking.</Alert>}
      <Field label="Verification note" className="mt-3"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Same company — confirmed with the owner by phone" /></Field>
      <p className="mt-3 text-xs text-ink-mute">No matching partner? Open the agency and issue its registration link — the partner appears here automatically once the registration is approved and the account activated.</p>
      {err && <Alert tone="error" className="mt-3">{err}</Alert>}
    </Modal>
  );
}

// ------------------------------------------------------------------ business onboarding vs portal access (0042)
export type BusinessStatus = 'historical' | 'verified' | 'not_onboarded';
export type PortalStatus = 'no_account' | 'pending' | 'active' | 'suspended' | 'deactivated';
export interface PartnerStatusRow { partner_id: string; business_status: BusinessStatus; portal_status: PortalStatus; onboarding_source: 'portal' | 'historical'; users: number; agency_id: string | null; agency_reference: string | null; agency_type: AgencyType | null }
export interface OnboardingSummary { total: number; historical: number; verified: number; unlinked: number; portal_active: number; no_account: number; mine: number }
export const BUSINESS: Record<BusinessStatus, { label: string; tone: 'green' | 'navy' | 'slate' }> = {
  historical: { label: 'Historically onboarded', tone: 'navy' }, verified: { label: 'Verified onboarded', tone: 'green' }, not_onboarded: { label: 'Not onboarded', tone: 'slate' },
};
export const PORTAL: Record<PortalStatus, { label: string; tone: 'slate' | 'amber' | 'green' | 'red' }> = {
  no_account: { label: 'Portal: Not activated', tone: 'slate' }, pending: { label: 'Portal: Pending', tone: 'amber' }, active: { label: 'Portal: Active', tone: 'green' },
  suspended: { label: 'Portal: Suspended', tone: 'red' }, deactivated: { label: 'Portal: Deactivated', tone: 'slate' },
};

/** Server-calculated status per partner and the Onboarded KPI, re-read on any agency, partner or account change. */
function useLive<T>(fn: string, enabled: boolean, map: (d: unknown) => T, args?: Record<string, unknown>): T | null {
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
    for (const table of ['agency_prospects', 'partners', 'profiles']) ch.on('postgres_changes', { event: '*', schema: 'public', table }, soon);
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
