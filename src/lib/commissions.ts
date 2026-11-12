// Commission data for SSI GLOBAL staff (Commission Management) and the Partner Admin (Commission).
// Every read goes through RLS / security-definer functions (0029): staff get only what their
// commission permissions allow (internal values only with commission_internal); a Partner Admin
// gets only their own active agreement rates from my_partner_commissions(). Realtime events only
// trigger a re-read, so nothing is ever pushed to someone who may not see it.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../auth/auth';

export type ValueKind = 'percent' | 'amount' | 'unclear';
export interface CommissionCountry { id: string; name: string; active: boolean }
export interface CommissionProvider { id: string; name: string; notes: string | null; active: boolean }
export interface CommissionTier { id: string; label: string; description: string | null; sort: number; active: boolean }
export interface TierRate { recordId: string; tierId: string; rawValue: string | null; valueKind: ValueKind; value: string | null; currency: string | null; note: string | null; needsReview: boolean }
export interface CommissionRecord {
  id: string; sourceKey: string; countryId: string; universityName: string; universityId: string | null; intake: string | null; studyLevel: string | null;
  variant: string | null; studentMarket: string | null; route: 'direct' | 'portal'; providerId: string | null; providerLabel: string | null; currency: string | null;
  conditions: string | null; effectiveFrom: string | null; effectiveTo: string | null; status: 'active' | 'inactive'; needsReview: boolean; reviewNotes: string | null;
  sourceSheet: string | null; sourceRow: number | null; updatedAt: string;
}
export interface CommissionInternal {
  recordId: string; receivedRaw: string | null; receivedKind: ValueKind | null; receivedValue: string | null; marginRaw: string | null; marginKind: ValueKind | null;
  marginValue: string | null; internalNotes: string | null; sourceRow: Record<string, string>;
}
export interface PartnerAssignment {
  id: string; partnerId: string; recordId: string; tierId: string; isCustom: boolean; customKind: 'percent' | 'amount' | null; customValue: string | null;
  customCurrency: string | null; partnerConditions: string | null; internalRemarks: string | null; validFrom: string | null; validTo: string | null;
  status: 'active' | 'pending_approval' | 'inactive' | 'rejected'; replacesId: string | null; assignedBy: string | null; assignedAt: string;
  updatedBy: string | null; updatedAt: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null;
}
export interface AssignmentEvent { id: string; assignmentId: string; partnerId: string; recordId: string; action: string; actor: string | null; at: string }
export interface CommissionImport { id: string; fileName: string; sheetName: string | null; countryId: string | null; rowCount: number; summary: Record<string, unknown>; importedBy: string | null; importedAt: string }

type Row = Record<string, unknown>;
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const fromRows = <T,>(rows: unknown): T[] => ((rows ?? []) as Row[]).map((r) => {
  const o: Row = {};
  for (const [k, v] of Object.entries(r)) o[camel(k)] = typeof v === 'number' && (k === 'value' || k.endsWith('_value')) ? String(v) : v;
  if (typeof o.id === 'number') o.id = String(o.id);
  return o as T;
});

/** What the signed-in staff member may do with commissions (the database checks the same). */
export function commissionCaps(session: { userRole: string; permissions: string[] } | null) {
  const s = session?.userRole === 'super_admin';
  const has = (p: string) => !!session && (s || session.permissions.includes(p));
  const manage = has('commission_manage');
  const edit = has('commission_edit');
  return {
    view: has('commission_view') || has('commission_tag') || manage || edit,
    tag: has('commission_tag') || manage,
    manage,
    internal: has('commission_internal'),
    edit,
    importSheets: edit && has('commission_internal'),
  };
}

export interface CommissionData {
  countries: CommissionCountry[]; providers: CommissionProvider[]; tiers: CommissionTier[]; records: CommissionRecord[]; rates: TierRate[];
  internal: CommissionInternal[]; assignments: PartnerAssignment[]; history: AssignmentEvent[]; imports: CommissionImport[];
}
/** Dev-only harness (#/ui/hr/commissions) supplies clearly fake sample data here. */
export const CommissionDemo = createContext<CommissionData | null>(null);
const empty: CommissionData = { countries: [], providers: [], tiers: [], records: [], rates: [], internal: [], assignments: [], history: [], imports: [] };

export function useCommissionData(enabled: boolean, opts: { internal: boolean; imports: boolean }) {
  const demo = useContext(CommissionDemo);
  const [state, setData] = useState<CommissionData>(empty);
  const data = demo ?? state;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (demo || !supabase || !enabled) { setLoading(false); return; }
    const sb = supabase;
    const [countries, providers, tiers, records, rates, internal, assignments, history, imports] = await Promise.all([
      sb.from('commission_countries').select('*').order('name'),
      sb.from('commission_providers').select('*').order('name'),
      sb.from('commission_tiers').select('*').order('sort'),
      sb.from('commission_records').select('*').order('university_name').limit(5000),
      sb.from('commission_tier_rates').select('*').limit(20000),
      opts.internal ? sb.from('commission_internal').select('*').limit(5000) : Promise.resolve({ data: [], error: null }),
      sb.from('partner_commission_assignments').select('*').order('assigned_at', { ascending: false }).limit(5000),
      sb.from('commission_assignment_history').select('id, assignment_id, partner_id, record_id, action, actor, at').order('at', { ascending: false }).limit(300),
      opts.imports ? sb.from('commission_imports').select('*').order('imported_at', { ascending: false }).limit(50) : Promise.resolve({ data: [], error: null }),
    ]);
    const failed = [countries, records].find((r) => r.error);
    if (failed?.error) {
      setError(/commission_/.test(failed.error.message) ? 'Run migration 0029 to enable Commission Management.' : 'Commission data could not be loaded.');
      setLoading(false);
      return;
    }
    setError(null);
    setData({
      countries: fromRows(countries.data), providers: fromRows(providers.data), tiers: fromRows(tiers.data), records: fromRows(records.data),
      rates: fromRows(rates.data), internal: fromRows(internal.data), assignments: fromRows(assignments.data), history: fromRows(history.data), imports: fromRows(imports.data),
    });
    setLoading(false);
  }, [enabled, opts.internal, opts.imports, demo]);
  useEffect(() => {
    void load();
    if (demo || !supabase || !enabled) return;
    const sb = supabase;
    let t = 0;
    const queue = () => { window.clearTimeout(t); t = window.setTimeout(() => void load(), 250); };
    const ch = sb.channel(`commissions-${Math.random().toString(36).slice(2, 8)}`);
    for (const table of ['commission_records', 'commission_tier_rates', 'commission_internal', 'commission_providers', 'commission_countries', 'partner_commission_assignments', 'commission_imports']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, queue);
    }
    ch.subscribe((s) => { if (s === 'SUBSCRIBED') queue(); });
    const onFocus = () => document.visibilityState === 'visible' && queue();
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.clearTimeout(t); document.removeEventListener('visibilitychange', onFocus); void sb.removeChannel(ch); };
  }, [load, enabled, demo]);
  const lookups = useMemo(() => ({
    country: new Map(data.countries.map((c) => [c.id, c])),
    provider: new Map(data.providers.map((p) => [p.id, p])),
    tier: new Map(data.tiers.map((t) => [t.id, t])),
    record: new Map(data.records.map((r) => [r.id, r])),
    internal: new Map(data.internal.map((i) => [i.recordId, i])),
    rate: (recordId: string, tierId: string) => data.rates.find((r) => r.recordId === recordId && r.tierId === tierId),
  }), [data]);
  return { data, loading, error, reload: load, lk: lookups };
}

/** Exactly what my_partner_commissions() returns (0031): no route, portal, other tiers or SSI values. */
export interface MyCommission {
  assignmentId: string; university: string; studyLevel: string | null; variant: string | null; intake: string | null; country: string;
  tier: string; isCustom: boolean; commissionKind: ValueKind | null; commissionValue: string | null; currency: string | null;
  conditions: string | null; validFrom: string | null; validTo: string | null; updatedAt: string;
}

/** The Partner Admin's own agreements; refreshes live through partner_commission_signals. */
/**
 * The partner's own agreements (my_partner_commissions), or — when previewPartner is set — a staff
 * preview of that partner's view (preview_partner_commissions). Both return the same restricted columns.
 */
export function useMyCommissions(enabled: boolean, previewPartner?: string) {
  const [rows, setRows] = useState<MyCommission[] | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    if (!supabase || !enabled) { setRows([]); return; }
    const { data, error: e } = previewPartner
      ? await supabase.rpc('preview_partner_commissions', { p_partner: previewPartner })
      : await supabase.rpc('my_partner_commissions');
    if (e) { setError(true); setRows([]); return; }
    setError(false);
    setRows(fromRows<MyCommission>(data).map((r) => ({ ...r, commissionValue: r.commissionValue == null ? null : String(r.commissionValue) })));
  }, [enabled, previewPartner]);
  useEffect(() => {
    void load();
    if (!supabase || !enabled) return;
    const sb = supabase;
    const ch = sb.channel(`my-commission-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'partner_commission_signals' }, () => void load())
      .subscribe();
    const onFocus = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onFocus);
    return () => { document.removeEventListener('visibilitychange', onFocus); void sb.removeChannel(ch); };
  }, [load, enabled]);
  return { rows, error, reload: load };
}

/** "20" + percent → "20%"; "4000" + amount + GBP → "GBP 4,000". Exact decimals, no rounding. */
export function fmtCommission(kind: ValueKind | null | undefined, value: string | null | undefined, currency?: string | null, raw?: string | null) {
  if (kind === 'percent' && value != null) return `${value}%`;
  if (kind === 'amount' && value != null) {
    const [i, f] = String(value).split('.');
    const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${currency ? `${currency} ` : ''}${grouped}${f ? `.${f}` : ''}${currency ? '' : ' (currency not stated)'}`;
  }
  return raw ? `“${raw}” (check)` : '—';
}

export const ROUTE_LABEL = { direct: 'Direct', portal: 'Through a portal' } as const;
