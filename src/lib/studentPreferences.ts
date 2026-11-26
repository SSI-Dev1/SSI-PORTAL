// University preferences of students (0061): every university choice with its own application
// details, one primary at most. Staff only (row-level security); live through realtime.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../auth/auth';

export interface UniversityPreference {
  id: string; student_id: string; is_primary: boolean; priority_source: string | null; university_name: string; university_id: string | null;
  course_name: string | null; program_intake: string | null; program_intake_month: string | null; country: string | null;
  application_portal: string | null; application_submitted: string | null; submission_date: string | null; application_status: string | null;
  pending_documents: string | null; offer_status: string | null; offer_status_date: string | null; current_status: string | null;
  current_status_date: string | null; payment: string | null; payment_status_date: string | null; deferral_details: string | null;
  visa_status: string | null; visa_status_date: string | null; remarks: string | null; application_id: string | null;
  source: Record<string, string>; date_issues: string[]; primary_set_by: string | null; primary_set_at: string | null; created_at: string;
}

/** Short progress label from the source values (most advanced first); the source text is shown beside it. */
export function preferenceProgress(p: Pick<UniversityPreference, 'visa_status' | 'payment' | 'offer_status' | 'current_status' | 'application_status' | 'application_submitted'>):
  { label: string; tone: 'green' | 'blue' | 'amber' | 'red' | 'slate' | 'navy' } {
  const t = (s: string | null) => (s ?? '').toLowerCase();
  if (/visa received|visa granted/.test(t(p.visa_status))) return { label: 'Visa received', tone: 'green' };
  if (/visa/.test(t(p.visa_status))) return { label: p.visa_status!, tone: 'navy' };
  if (/drop|closed/.test(t(p.current_status)) || /drop|closed/.test(t(p.application_status))) return { label: 'Dropped / closed', tone: 'slate' };
  if (/reject|inelig/.test(t(p.offer_status)) || /reject|inelig/.test(t(p.current_status))) return { label: 'Offer rejected / ineligible', tone: 'red' };
  if (/full fee/.test(t(p.payment))) return { label: 'Full fee paid', tone: 'green' };
  if (/init/.test(t(p.payment))) return { label: 'Initial fee paid', tone: 'green' };
  if (/^ucol/.test(t(p.offer_status))) return { label: 'Unconditional offer', tone: 'green' };
  if (/^col/.test(t(p.offer_status))) return { label: 'Conditional offer', tone: 'blue' };
  if (/hold|defer/.test(t(p.application_status)) || /hold|defer/.test(t(p.current_status))) return { label: 'On hold / deferred', tone: 'amber' };
  if (/pending/.test(t(p.application_status))) return { label: 'Pending documents', tone: 'amber' };
  if (/submitted/.test(t(p.application_status)) || t(p.application_submitted) === 'yes') return { label: 'Application submitted', tone: 'blue' };
  return { label: p.application_status ?? 'Not submitted', tone: 'slate' };
}

/** All choices (studentId given: one student's). */
export function useUniversityPreferences(enabled: boolean, studentId?: string) {
  const [rows, setRows] = useState<UniversityPreference[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!enabled || !supabase) { setRows([]); return; }
    let q = supabase.from('student_university_preferences').select('*').order('is_primary', { ascending: false }).order('created_at').limit(studentId ? 200 : 20000);
    if (studentId) q = q.eq('student_id', studentId);
    const { data, error: e } = await q;
    if (e) { setError(/student_university_preferences|schema cache/.test(e.message) ? 'Run migration 0061 to see university preferences.' : 'University preferences could not be loaded.'); setRows([]); return; }
    setError(''); setRows((data ?? []) as UniversityPreference[]);
  }, [enabled, studentId]);
  useEffect(() => {
    void load();
    if (!enabled || !supabase) return;
    const sb = supabase;
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(() => void load(), 300); };
    const ch = sb.channel(`stu-pref-${studentId ?? 'all'}-${Math.random().toString(36).slice(2, 6)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'student_university_preferences', ...(studentId ? { filter: `student_id=eq.${studentId}` } : {}) }, soon).subscribe();
    return () => { clearTimeout(t); void sb.removeChannel(ch); };
  }, [load, enabled, studentId]);
  return { rows, error, reload: load };
}
