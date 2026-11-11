// Staff-only panel in Application details: which partner commission agreement applies to this
// application. The database links it automatically only when exactly one agreement fits the
// partner and university; otherwise a commission manager chooses (0029). Partners never see this.
import { useCallback, useEffect, useState } from 'react';
import { BadgePercent } from 'lucide-react';
import { Badge, Button, Field, Select } from './ui';
import { useToast } from './feedback';
import { useStore } from '../store/store';
import { supabase } from '../auth/auth';
import { commissionCaps, fmtCommission, type ValueKind } from '../lib/commissions';
import { serverMessage } from '../data/hr';

interface Option { id: string; label: string; rate: string }

export function ApplicationCommission({ applicationId, partnerId, universityId }: { applicationId: string; partnerId: string; universityId: string }) {
  const { session } = useStore();
  const caps = commissionCaps(session);
  const toast = useToast();
  const [link, setLink] = useState<{ match: string; assignmentId: string | null; candidates: number } | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [pick, setPick] = useState('');
  const load = useCallback(async () => {
    if (!supabase || !caps.view) return;
    const sb = supabase;
    const { data: l } = await sb.from('application_commissions').select('match, assignment_id, candidates').eq('application_id', applicationId).maybeSingle();
    setLink(l ? { match: l.match as string, assignmentId: (l.assignment_id as string | null) ?? null, candidates: Number(l.candidates ?? 0) } : null);
    const { data: recs } = await sb.from('commission_records').select('id, university_name, route, provider_label, variant, study_level, currency').eq('university_id', universityId).eq('status', 'active');
    const ids = (recs ?? []).map((r) => r.id as string);
    if (!ids.length) { setOptions([]); return; }
    const [{ data: ags }, { data: rates }] = await Promise.all([
      sb.from('partner_commission_assignments').select('id, record_id, tier_id, is_custom, custom_kind, custom_value, custom_currency').eq('partner_id', partnerId).eq('status', 'active').in('record_id', ids),
      sb.from('commission_tier_rates').select('record_id, tier_id, value_kind, value, currency, raw_value').in('record_id', ids),
    ]);
    setOptions((ags ?? []).map((a) => {
      const r = (recs ?? []).find((x) => x.id === a.record_id);
      const t = (rates ?? []).find((x) => x.record_id === a.record_id && x.tier_id === a.tier_id);
      const rate = a.is_custom ? fmtCommission(a.custom_kind as ValueKind, String(a.custom_value), a.custom_currency as string | null)
        : fmtCommission(t?.value_kind as ValueKind, t?.value == null ? null : String(t.value), (t?.currency as string | null) ?? (r?.currency as string | null), t?.raw_value as string | null);
      const label = [r?.route === 'direct' ? 'Direct' : r?.provider_label, r?.study_level, r?.variant, `${String(a.tier_id).replace('tier_', 'Tier ')}${a.is_custom ? ' (custom)' : ''}`].filter(Boolean).join(' · ');
      return { id: a.id as string, label, rate };
    }));
  }, [applicationId, partnerId, universityId, caps.view]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPick(link?.assignmentId ?? ''); }, [link]);
  if (!caps.view) return null;
  const current = options.find((o) => o.id === link?.assignmentId);
  const confirm = async () => {
    if (!supabase) return;
    const { error } = await supabase.rpc('confirm_application_commission', { p_application: applicationId, p_assignment: pick || null });
    if (error) return toast.error('Not saved', serverMessage(error));
    toast.success('Commission confirmed for this application');
    void load();
  };
  return (
    <section className="rounded-2xl border border-line p-5">
      <h4 className="mb-3 flex items-center gap-1.5 font-display text-sm font-semibold text-heading"><BadgePercent className="h-4 w-4 text-rust" /> Commission <span className="text-xs font-normal text-ink-mute">(internal)</span></h4>
      {!link || link.match === 'none' ? <p className="text-sm text-ink-soft">No commission agreement covers this partner and university.</p>
        : link.match === 'ambiguous' ? <p className="text-sm text-amber-700 dark:text-amber-300">{link.candidates} agreements could apply (different portals, levels or campuses). A commission manager must choose — nothing was assigned automatically.</p>
        : <div className="text-sm"><Badge tone={link.match === 'confirmed' ? 'green' : 'blue'}>{link.match === 'confirmed' ? 'Confirmed' : 'Matched automatically'}</Badge>
            {current ? <div className="mt-2 text-heading">{current.label} · <b>{current.rate}</b></div> : link.assignmentId ? null : <div className="mt-2 text-ink-soft">Confirmed: no commission for this application.</div>}</div>}
      {caps.manage && options.length > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Agreement for this application" className="min-w-[220px] flex-1">
            <Select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">No commission</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label} — {o.rate}</option>)}
            </Select>
          </Field>
          <Button size="sm" variant="secondary" onClick={() => void confirm()}>Confirm</Button>
        </div>
      )}
    </section>
  );
}
