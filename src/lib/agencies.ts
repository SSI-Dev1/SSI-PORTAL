// Agency outreach (0034): prospects, their activity, proposals and MOUs. Everything is read
// through RLS (an officer sees the agencies assigned to them or that they created; registration
// managers see all) and written only through the database functions / agency-proposal function.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../auth/auth';
import { serverMessage } from '../data/hr';
import { canManageRegistrations } from '../auth/roles';
import type { Session } from '../data/types';

export type ContactStatus = 'unknown' | 'not_connected' | 'connected';
export type Stage = 'new_prospect' | 'follow_up_required' | 'discussion' | 'proposal_sent' | 'proposal_confirmed' | 'mou_sent' | 'registration_pending'
  | 'registration_submitted' | 'under_review' | 'approved' | 'onboarded' | 'inactive' | 'closed';
export type ProposalStatus = 'draft' | 'pending_approval' | 'sending' | 'sent' | 'delivery_failed' | 'awaiting_confirmation' | 'confirmed' | 'declined'
  | 'expired' | 'superseded' | 'cancelled';
type Tone = 'slate' | 'blue' | 'amber' | 'green' | 'red' | 'violet' | 'orange' | 'navy';

export interface Agency {
  id: string; reference: string; company_name: string | null; contact_name: string | null; phone: string | null; email: string | null; country: string | null;
  notes: string | null; contact_status: ContactStatus; contact_changed_by: string | null; contact_changed_at: string | null; first_connected_at: string | null;
  stage: Stage; stage_changed_at: string | null; assigned_officer: string | null; last_contact_at: string | null; next_follow_up: string | null;
  selected_tier: string | null; registration_id: string | null; partner_id: string | null; created_by: string | null; created_at: string; updated_at: string;
  first_contact_at?: string | null; source?: 'manual' | 'import'; import_id?: string | null; source_row?: number | null; source_status?: string | null;
  source_values?: Record<string, unknown> | null; historical_onboarded?: boolean; needs_reconciliation?: boolean; reconciliation_note?: string | null;
}
export interface ProposalUniversity {
  record_id: string; university: string; country: string; study_level: string | null; variant: string | null; intake: string | null;
  commission_kind: 'percent' | 'amount'; commission_value: number | string; currency: string | null; conditions: string | null;
}
export interface Proposal {
  id: string; reference: string; prospect_id: string; status: ProposalStatus; company_name: string; recipient_name: string; recipient_email: string; country: string;
  arrangement: { kind: 'tier' | 'custom'; tier_id?: string; tier_label: string; universities: ProposalUniversity[] };
  terms_title: string; terms_body: string; message: string | null; expires_at: string | null; created_by: string | null; created_at: string;
  approved_by: string | null; approved_at: string | null; sent_by: string | null; sent_at: string | null; email_status: 'not_sent' | 'accepted' | 'delivered' | 'failed';
  email_detail: string | null; first_viewed_at: string | null; confirmed_at: string | null; confirmed_name: string | null; declined_at: string | null;
  decline_reason: string | null; updated_at: string;
}
export interface AgencyActivity { id: number; prospect_id: string; kind: string; note: string | null; detail: Record<string, unknown>; actor: string | null; at: string }
export interface Mou { id: string; prospect_id: string; reference: string | null; sent_on: string; sent_by: string | null; status: 'sent' | 'signed' | 'cancelled'; signed_on: string | null; note: string | null }
export interface Terms { id: number; title: string; body: string; active: boolean; created_at: string }
export interface Registration { id: string; reference: string; status: string; link_status: string; submitted_at: string | null; activated_at: string | null }

export const CONTACT: Record<ContactStatus, { label: string; tone: Tone }> = {
  unknown: { label: 'Not recorded', tone: 'slate' }, not_connected: { label: 'Not connected', tone: 'amber' }, connected: { label: 'Connected', tone: 'green' },
};
export const STAGE: Record<Stage, { label: string; tone: Tone }> = {
  new_prospect: { label: 'New prospect', tone: 'slate' }, follow_up_required: { label: 'Follow-up required', tone: 'amber' },
  discussion: { label: 'Discussion in progress', tone: 'blue' }, proposal_sent: { label: 'Proposal sent', tone: 'orange' },
  proposal_confirmed: { label: 'Proposal confirmed', tone: 'violet' }, mou_sent: { label: 'MOU sent', tone: 'violet' },
  registration_pending: { label: 'Registration pending', tone: 'amber' }, registration_submitted: { label: 'Registration submitted', tone: 'orange' },
  under_review: { label: 'Under admin review', tone: 'violet' }, approved: { label: 'Approved', tone: 'green' }, onboarded: { label: 'Onboarded', tone: 'navy' },
  inactive: { label: 'Inactive', tone: 'slate' }, closed: { label: 'Closed / Rejected', tone: 'red' },
};
export const STAGE_ORDER = Object.keys(STAGE) as Stage[];
/** Stages a person may set; the rest follow the proposal, MOU and registration events. */
export const MANUAL_STAGES: Stage[] = ['new_prospect', 'follow_up_required', 'discussion', 'inactive', 'closed'];
export const PROPOSAL: Record<ProposalStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'slate' }, pending_approval: { label: 'Needs commission approval', tone: 'amber' }, sending: { label: 'Sending', tone: 'blue' },
  sent: { label: 'Sent', tone: 'blue' }, delivery_failed: { label: 'Delivery failed', tone: 'red' }, awaiting_confirmation: { label: 'Awaiting confirmation', tone: 'orange' },
  confirmed: { label: 'Confirmed', tone: 'green' }, declined: { label: 'Declined', tone: 'red' }, expired: { label: 'Expired', tone: 'slate' },
  superseded: { label: 'Superseded', tone: 'slate' }, cancelled: { label: 'Cancelled', tone: 'slate' },
};
export const EMAIL: Record<Proposal['email_status'], string> = {
  not_sent: 'Not sent', accepted: 'Accepted by the email service (delivery not yet confirmed)', delivered: 'Delivered', failed: 'Delivery failed',
};
export const REGISTRATION: Record<string, { label: string; tone: Tone }> = {
  link_generated: { label: 'Link sent', tone: 'slate' }, in_progress: { label: 'Filling in', tone: 'blue' }, submitted: { label: 'Submitted', tone: 'orange' },
  in_review: { label: 'Under review', tone: 'violet' }, changes_requested: { label: 'Changes requested', tone: 'amber' }, approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' }, activated: { label: 'Activated', tone: 'navy' },
};
export const ACTIVITY: Record<string, string> = {
  created: 'Agency added', edited: 'Details edited', contact_status: 'Contact status changed', stage: 'Stage changed', call: 'Call logged',
  meeting: 'Meeting recorded', follow_up_done: 'Follow-up completed', follow_up: 'Follow-up scheduled', note: 'Note added',
  proposal_prepared: 'Proposal prepared', proposal_needs_approval: 'Proposal waiting for commission approval', proposal_approved: 'Custom commission approved',
  proposal_rejected: 'Custom commission rejected', proposal_sent: 'Proposal emailed', proposal_failed: 'Proposal email failed', proposal_cancelled: 'Proposal cancelled',
  proposal_confirmed: 'Proposal confirmed by the agency', proposal_declined: 'Proposal declined by the agency', proposal_expired: 'Proposal expired',
  mou_sent: 'MOU sent', mou_signed: 'MOU signed', mou_cancelled: 'MOU cancelled', registration_link: 'Registration link issued',
  registration_submitted: 'Registration submitted', registration_resubmitted: 'Registration corrected', registration_in_review: 'Registration under review',
  registration_changes_requested: 'Registration changes requested', registration_approved: 'Registration approved', registration_rejected: 'Registration rejected',
  registration_activated: 'Partner account activated', registration_in_progress: 'Agency started the registration form',
  contact_attempt: 'Contact attempt', imported: 'Imported from a spreadsheet', reconciled: 'Reconciled by an administrator', assigned: 'Officer assigned',
  reactivated: 'Reopened',
};
/** Stage label, marking onboarded agencies that have no verified partner account. */
export const stageLabel = (a: Agency) => (a.stage === 'onboarded' && !a.partner_id ? 'Onboarded (historical)' : STAGE[a.stage].label);

export const agencyName = (a: Pick<Agency, 'company_name' | 'contact_name' | 'phone' | 'reference'>) => a.company_name || a.contact_name || a.phone || a.reference;
export const isOpenFollowUp = (a: Agency) => !!a.next_follow_up && !['onboarded', 'closed', 'inactive'].includes(a.stage);
export const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);   // company day (IST)

/** Partnership Officer workspace: outreach permission, but no student / application work. */
export function partnershipFocused(s: Session | null) {
  return !!s && s.role !== 'client' && s.userRole !== 'super_admin' && s.permissions.includes('agency_outreach')
    && !s.permissions.includes('students') && !s.permissions.includes('applications');
}
export const agencyAccess = (s: Session | null) => !!s && s.role !== 'client' && (s.userRole === 'super_admin' || canManageRegistrations(s) || s.permissions.includes('agency_outreach'));
export const agencyManager = (s: Session | null) => !!s && s.role !== 'client' && (s.userRole === 'super_admin' || canManageRegistrations(s));

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Not configured' };
  const { data, error } = await supabase.rpc(fn, args);
  if (error && /schema cache|does not exist/i.test(error.message)) return { ok: false, error: 'Agencies are not set up on the server yet (run migration 0034).' };
  return error ? { ok: false, error: serverMessage(error).replace(/^MISSING:\s*/, '') } : { ok: true, data: data as T };
}

/** Sends through the agency-proposal function; the browser never sees the link token. */
export async function sendProposal(proposalId: string): Promise<{ ok: boolean; message: string }> {
  if (!supabase) return { ok: false, message: 'Not configured' };
  const { data, error } = await supabase.functions.invoke('agency-proposal', { body: { action: 'send', proposalId } });
  if (error) {
    let msg = 'The proposal could not be sent. Please try again.';
    try { msg = ((await (error as { context?: Response }).context?.json()) as { error?: string })?.error ?? msg; } catch { /* keep default */ }
    return { ok: false, message: msg };
  }
  return { ok: !!(data as { ok?: boolean })?.ok, message: 'Proposal emailed. It is waiting for the agency to confirm.' };
}

export interface AgencyData { agencies: Agency[]; proposals: Proposal[]; mous: Mou[]; activities: AgencyActivity[]; registrations: Registration[] }

/** Sample data for the dev harness (#/ui/hr/agencies); never used in the app itself. */
export const AgencyDemo = createContext<AgencyData | null>(null);

/** All agency data the signed-in user may see, kept live through realtime. */
export function useAgencyData(enabled = true) {
  const demo = useContext(AgencyDemo);
  const [data, setData] = useState<AgencyData | null>(demo);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (demo) { setData(demo); return; }
    if (!supabase || !enabled) { setData({ agencies: [], proposals: [], mous: [], activities: [], registrations: [] }); return; }
    const sb = supabase;
    const [a, p, m, act] = await Promise.all([
      sb.from('agency_prospects').select('*').order('updated_at', { ascending: false }).limit(5000),
      sb.from('agency_proposals').select('id, reference, prospect_id, status, company_name, recipient_name, recipient_email, country, arrangement, terms_title, terms_body, message, expires_at, created_by, created_at, approved_by, approved_at, sent_by, sent_at, email_status, email_detail, first_viewed_at, confirmed_at, confirmed_name, declined_at, decline_reason, updated_at').order('created_at', { ascending: false }).limit(5000),
      sb.from('agency_mous').select('*').order('sent_on', { ascending: false }).limit(5000),
      sb.from('agency_activities').select('*').order('at', { ascending: false }).limit(300),
    ]);
    if (a.error) { setError(/agency_prospects/.test(a.error.message) ? 'Run migration 0034 to enable Agencies.' : 'Agencies could not be loaded.'); setData({ agencies: [], proposals: [], mous: [], activities: [], registrations: [] }); return; }
    const agencies = (a.data ?? []) as Agency[];
    const regIds = agencies.map((x) => x.registration_id).filter(Boolean) as string[];
    // Registrations are readable only by registration managers; officers see the stage instead.
    const r = regIds.length ? await sb.from('partner_registrations').select('id, reference, status, link_status, submitted_at, activated_at').in('id', regIds) : { data: [] };
    setError(null);
    setData({ agencies, proposals: (p.data ?? []) as Proposal[], mous: (m.data ?? []) as Mou[], activities: (act.data ?? []) as AgencyActivity[], registrations: (r.data ?? []) as Registration[] });
  }, [enabled, demo]);
  useEffect(() => {
    void load();
    if (!supabase || !enabled || demo) return;
    const sb = supabase;
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(() => void load(), 250); };
    const ch = sb.channel(`agencies-${Math.random().toString(36).slice(2, 8)}`);
    for (const table of ['agency_prospects', 'agency_proposals', 'agency_mous', 'agency_activities']) ch.on('postgres_changes', { event: '*', schema: 'public', table }, soon);
    ch.subscribe();
    const onFocus = () => document.visibilityState === 'visible' && soon();
    document.addEventListener('visibilitychange', onFocus);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', onFocus); void sb.removeChannel(ch); };
  }, [load, enabled, demo]);
  return { data, error, reload: load };
}

export const latestProposal = (proposals: Proposal[], agencyId: string) => proposals.find((p) => p.prospect_id === agencyId) ?? null;
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtWhen = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/** Filters used by the dashboard cards and the list. */
export type AgencyFilter = 'all' | 'connected' | 'not_connected' | 'unknown' | 'new_added' | 'reconcile' | 'new_contacted' | 'proposal_sent' | 'proposal_confirmed' | 'mou_sent' | 'onboarded' | 'inactive'
  | 'closed' | 'follow_up' | 'registration_pending';
export const FILTERS: { value: AgencyFilter; label: string }[] = [
  { value: 'all', label: 'All agencies' }, { value: 'connected', label: 'Connected' }, { value: 'not_connected', label: 'Not connected' },
  { value: 'unknown', label: 'Contact not recorded' }, { value: 'new_added', label: 'Added this month' },
  { value: 'new_contacted', label: 'Contacted this month' }, { value: 'follow_up', label: 'Follow-up required' },
  { value: 'proposal_sent', label: 'Proposal sent' }, { value: 'proposal_confirmed', label: 'Proposal confirmed' }, { value: 'mou_sent', label: 'MOU sent' },
  { value: 'registration_pending', label: 'Registration in progress' }, { value: 'onboarded', label: 'Onboarded' }, { value: 'inactive', label: 'Inactive' },
  { value: 'closed', label: 'Closed' }, { value: 'reconcile', label: 'Needs reconciliation' },
];
const inMonth = (d: string | null | undefined, month: string) => !!d && new Date(new Date(d).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 7) === month;
export function matchesFilter(a: Agency, f: AgencyFilter, d: AgencyData): boolean {
  const month = today().slice(0, 7);
  switch (f) {
    case 'all': return true;
    case 'connected': return a.contact_status === 'connected';
    case 'not_connected': return a.contact_status === 'not_connected';
    case 'unknown': return a.contact_status === 'unknown';
    case 'new_added': return a.source !== 'import' && inMonth(a.created_at, month);
    case 'new_contacted': return inMonth(a.first_contact_at ?? a.first_connected_at, month);
    case 'reconcile': return !!a.needs_reconciliation;
    // Pipeline filters: agencies currently at that stage (imported or live), not actions taken today.
    case 'proposal_sent': return a.stage === 'proposal_sent';
    case 'proposal_confirmed': return a.stage === 'proposal_confirmed' || d.proposals.some((p) => p.prospect_id === a.id && p.status === 'confirmed' && a.stage === 'proposal_confirmed');
    case 'mou_sent': return a.stage === 'mou_sent';
    case 'registration_pending': return ['registration_pending', 'registration_submitted', 'under_review', 'approved'].includes(a.stage);
    case 'onboarded': return a.stage === 'onboarded';
    case 'inactive': return a.stage === 'inactive';
    case 'closed': return a.stage === 'closed';
    case 'follow_up': return a.stage === 'follow_up_required' || isOpenFollowUp(a);
  }
}
