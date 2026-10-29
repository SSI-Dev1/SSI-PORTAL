// Data layer backed by Supabase. Every read is filtered by row-level security on the
// server (a partner only ever receives its own organisation's rows), and every write is
// re-checked there (tenant, role and workflow rules live in supabase/migrations).
// The UI keeps a local copy for fast rendering and re-syncs after each change.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  Announcement,
  AppStatus,
  Application,
  Assessment,
  AssessmentStatus,
  Course,
  CourseIntake,
  DB,
  DocStatus,
  DocType,
  ID,
  Partner,
  Payment,
  Student,
  Task,
  University,
} from '../data/types';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../auth/auth';
import { useToast } from '../components/feedback';
import { prepareUpload } from '../lib/files';

type Without<T, K extends keyof T> = Omit<T, K>;
export type CreateApplicationResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'duplicate'; existingId: string; existingRef: string }
  | { ok: false; reason: 'error'; message: string };
export interface ImportSummary {
  universities: { new: number; updated: number; unchanged: number };
  courses: { new: number; updated: number; unchanged: number };
  intakes: { new: number; updated: number; unchanged: number };
  blacklist: { new: number; unchanged: number };
  invalid: { kind: string; name: string; reason: string }[];
}
type Row = Record<string, unknown>;

const BUCKET = 'student-documents';
const emptyDB = (): DB => ({
  version: 1,
  partners: [],
  students: [],
  universities: [],
  courses: [],
  applications: [],
  documents: [],
  assessments: [],
  payments: [],
  tasks: [],
  announcements: [],
  activities: [],
  courseIntakes: [],
  blacklist: [],
  notifications: [],
  staff: [],
});

// ------------------------------------------------------------------ row mapping
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function toRow(obj: object, omit: string[] = []): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(obj)) {
    if (omit.includes(k) || v === undefined) continue;
    out[snake(k)] = v === '' && (k === 'dob' || k === 'website') ? null : v;
  }
  if ('audience' in out) out.audience = out.audience === 'all' ? null : out.audience;
  return out;
}
function fromRow<T>(row: Row): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v ?? (k === 'dob' || k === 'website' || k === 'notes' ? '' : v);
  if ('audience' in out && out.audience == null) out.audience = 'all';
  if (typeof out.id === 'number') out.id = String(out.id);
  return out as T;
}

const TABLES = {
  partners: 'partners',
  students: 'students',
  universities: 'universities',
  courses: 'courses',
  applications: 'applications',
  documents: 'documents',
  assessments: 'assessments',
  payments: 'payments',
  tasks: 'tasks',
  announcements: 'announcements',
  courseIntakes: 'course_intakes',
  blacklist: 'blacklisted_institutions',
} as const;
type TableKey = keyof typeof TABLES;

function useStoreValue() {
  const { session, realSession, status } = useAuth();
  const toastRaw = useToast();
  const toastRef = useRef(toastRaw);
  toastRef.current = toastRaw;
  const toast = useMemo(() => ({ error: (t: string, m?: string) => toastRef.current.error(t, m) }), []);
  const [db, setDb] = useState<DB>(emptyDB);
  const [loading, setLoading] = useState(false);
  /** Realtime connection state, shown as the "Live" indicator. */
  const [live, setLive] = useState<'connecting' | 'live' | 'offline'>('connecting');
  /** Bumps whenever any visible account changes, so account screens can re-query. */
  const [profilesRev, setProfilesRev] = useState(0);
  const userId = realSession?.userId;
  const internal = realSession?.role === 'admin' || realSession?.role === 'staff';

  // Every read goes through RLS, so each portal only ever receives rows it may see.
  const fetchers = useMemo(() => {
    if (!supabase) return null;
    const sb = supabase;
    const f: Record<string, () => PromiseLike<{ data: unknown; error: unknown }>> = {};
    (Object.keys(TABLES) as TableKey[]).forEach((k) => {
      f[k] = () => sb.from(TABLES[k]).select('*').limit(5000);
    });
    f.activities = () => sb.from('activities').select('*').order('at', { ascending: false }).limit(80);
    f.notifications = () => sb.from('notifications').select('id, created_at, kind, title, body, link, read_at').order('created_at', { ascending: false }).limit(50);
    f.staff = () => sb.rpc('staff_directory');
    return f;
  }, []);

  const keysFor = useCallback(
    (only?: string[]) => {
      const all = [...Object.keys(TABLES), 'activities', 'notifications', ...(internal ? ['staff'] : [])].filter((k) => k !== 'tasks' || internal);
      return only ? all.filter((k) => only.includes(k)) : all;
    },
    [internal],
  );

  /** (Re)loads the given collections — or everything — from the server. */
  const load = useCallback(
    async (only?: string[]) => {
      if (!fetchers || status !== 'signed-in' || !realSession) return;
      const keys = keysFor(only);
      if (!keys.length) return;
      const results = await Promise.all(keys.map((k) => fetchers[k]()));
      const failed = results.find((r) => r.error);
      if (failed?.error) {
        if (!only) toast.error('Could not load data', 'Please refresh the page. If this continues, contact SSI GLOBAL.');
        setLoading(false);
        return;
      }
      setDb((d) => {
        const next = only ? { ...d } : emptyDB();
        keys.forEach((k, i) => {
          (next as unknown as Record<string, unknown[]>)[k] = ((results[i].data ?? []) as Row[]).map((r) => fromRow(r));
        });
        return next;
      });
      setLoading(false);
    },
    [fetchers, status, realSession, keysFor, toast],
  );

  // Initial load, and re-sync when the tab regains focus (picks up other users' changes).
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'signed-in' || !userId) {
      loadedFor.current = null;
      setDb(emptyDB());
      return;
    }
    if (loadedFor.current !== userId) {
      loadedFor.current = userId;
      setLoading(true);
      void load();
    }
    // Reconcile anything missed while hidden or offline (events are not the only source of truth).
    const h = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', h);
    window.addEventListener('online', h);
    return () => {
      document.removeEventListener('visibilitychange', h);
      window.removeEventListener('online', h);
    };
  }, [status, userId, load]);

  // ---------------------------------------------------------------- realtime
  // Supabase Realtime delivers a change only to subscribers whose RLS allows reading the row.
  // We treat events as "something changed in table X" and re-fetch X through RLS, so the UI
  // always shows the committed server state and no row data is trusted from the event.
  const loadRef = useRef(load);
  loadRef.current = load;
  const { refresh: refreshAccess } = useAuth();
  const refreshAccessRef = useRef(refreshAccess);
  refreshAccessRef.current = refreshAccess;
  useEffect(() => {
    if (!supabase || status !== 'signed-in' || !userId) return;
    const sb = supabase;
    const pending = new Set<string>();
    let timer = 0;
    let wasLive = false;
    let accessTimer = 0;
    const flush = () => {
      const tables = [...pending];
      pending.clear();
      void loadRef.current(tables);
    };
    const queue = (t: string) => {
      pending.add(t);
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, 250); // batch bursts (e.g. a status change + its activity)
    };
    // My own account or organisation changed (permissions, suspension, portal access):
    // re-resolve access from the server; a suspended user is signed out.
    const recheck = () => {
      window.clearTimeout(accessTimer);
      accessTimer = window.setTimeout(() => void refreshAccessRef.current(), 400);
    };
    const debug = (() => {
      try {
        return localStorage.getItem('ssi-debug-realtime') === '1';
      } catch {
        return false;
      }
    })();

    // One channel per table: if Realtime rejects one subscription, the others keep working
    // (a rejected listener on a shared channel silently stops all of them).
    const handlers: Record<string, () => void> = {};
    (Object.keys(TABLES) as TableKey[]).forEach((k) => (handlers[TABLES[k]] = () => queue(k)));
    handlers.activities = () => queue('activities');
    // RLS already limits notifications to their owner, so no server-side filter is needed.
    handlers.notifications = () => queue('notifications');
    handlers.profiles = () => {
      recheck();
      queue('staff');
      setProfilesRev((n) => n + 1);
    };
    if (!internal) {
      const base = handlers.partners;
      handlers.partners = () => {
        base();
        recheck(); // a partner's own portal switch / modules / archive changed
      };
    }

    const suffix = Math.random().toString(36).slice(2, 8);
    const state: Record<string, 'ok' | 'down'> = {};
    const report = () => {
      const values = Object.values(state);
      setLive(values.length && values.every((v) => v === 'ok') ? 'live' : 'offline');
    };
    const channels = Object.entries(handlers).map(([table, onChange]) => {
      const ch = sb.channel(`crm-${table}-${suffix}`);
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        if (debug) console.info('[realtime] change in', table);
        onChange();
      });
      ch.on('system', {}, (m: { status?: string; message?: string }) => {
        if (m?.status === 'error') {
          console.warn('[realtime]', table, m.message);
          state[table] = 'down';
          report();
        }
      });
      ch.subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          if (state[table] === 'down' || wasLive) void loadRef.current([table === 'profiles' ? 'staff' : table].filter((t) => t !== 'staff' || internal));
          state[table] = 'ok';
          wasLive = true;
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
          state[table] = 'down'; // supabase-js retries automatically
        }
        report();
      });
      return ch;
    });

    // Safety net: re-sync while the page is visible even if no events arrive, so every
    // portal converges on the database state (events are not trusted alone). Forms key their
    // state on record ids, so a re-sync never resets what the user is editing.
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadRef.current();
    }, 60_000);

    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(accessTimer);
      window.clearInterval(poll);
      channels.forEach((ch) => void sb.removeChannel(ch));
      setLive('connecting');
    };
  }, [status, userId, internal]);

  const refreshActivities = useCallback(async () => {
    await load(['activities']);
  }, [load]);

  /** Runs a server write; on failure shows a safe message and re-syncs from the server. */
  const commit = useCallback(
    async (op: PromiseLike<{ error: unknown }>, failMsg = 'Your change could not be saved.') => {
      const { error } = await op;
      if (error) {
        toast.error('Action not permitted', failMsg);
        await load();
        return false;
      }
      void refreshActivities();
      return true;
    },
    [toast, load, refreshActivities],
  );

  const sb = () => {
    if (!supabase) throw new Error('Not configured');
    return supabase;
  };
  const patchLocal = <K extends TableKey>(key: K, id: ID, patch: Partial<DB[K][number]>) =>
    setDb((d) => ({ ...d, [key]: (d[key] as { id: ID }[]).map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const removeLocal = (key: TableKey, id: ID) => setDb((d) => ({ ...d, [key]: (d[key] as { id: ID }[]).filter((r) => r.id !== id) }));
  const upsertLocal = <K extends TableKey>(key: K, row: DB[K][number]) =>
    setDb((d) => {
      const rows = d[key] as { id: ID }[];
      const r = row as { id: ID };
      return { ...d, [key]: rows.some((x) => x.id === r.id) ? rows.map((x) => (x.id === r.id ? r : x)) : [r, ...rows] };
    });

  /** Insert, then replace the optimistic row with the server's version (server-managed fields). */
  const insert = async <K extends TableKey>(key: K, local: DB[K][number], row: Row, failMsg?: string) => {
    upsertLocal(key, local);
    const res = await sb().from(TABLES[key]).insert(row).select('*').single();
    if (await commit(Promise.resolve(res), failMsg)) upsertLocal(key, fromRow<DB[K][number]>(res.data as Row));
  };
  const update = async <K extends TableKey>(key: K, id: ID, patch: Partial<DB[K][number]>, failMsg?: string) => {
    // Optimistic concurrency: only apply if nobody changed the row since we loaded it.
    const version = ((db[key] as { id: ID; updatedAt?: string }[]).find((r) => r.id === id) ?? {}).updatedAt;
    patchLocal(key, id, patch);
    let q = sb().from(TABLES[key]).update(toRow(patch, ['updatedAt'])).eq('id', id);
    if (version) q = q.eq('updated_at', version);
    const res = await q.select('*');
    if (!res.error && (res.data?.length ?? 0) === 0) {
      if (version) {
        const { data: still } = await sb().from(TABLES[key]).select('id').eq('id', id).maybeSingle();
        if (still) {
          toastRef.current.info('Updated by someone else', 'This record changed since you opened it. The latest version is shown — please re-apply your change.');
          await load([key]);
          return;
        }
      }
      return void (await commit(Promise.resolve({ error: 'denied' }), failMsg));
    }
    if (await commit(Promise.resolve(res), failMsg) && res.data?.[0]) upsertLocal(key, fromRow<DB[K][number]>(res.data[0] as Row));
  };
  const remove = async (key: TableKey, id: ID, failMsg?: string) => {
    removeLocal(key, id);
    await commit(sb().from(TABLES[key]).delete().eq('id', id), failMsg);
  };

  const now = () => new Date().toISOString();
  const newId = () => crypto.randomUUID();

  const actions = {
    markNotificationsRead() {
      const at = now();
      setDb((d) => ({ ...d, notifications: d.notifications.map((n) => (n.readAt ? n : { ...n, readAt: at })) }));
      void sb().from('notifications').update({ read_at: at }).is('read_at', null).then(() => {});
    },
    markNotificationRead(id: ID) {
      const at = now();
      setDb((d) => ({ ...d, notifications: d.notifications.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: at } : n)) }));
      void sb().from('notifications').update({ read_at: at }).eq('id', Number(id)).is('read_at', null).then(() => {});
    },
    /** Deletes this user's notifications on the server (other users are unaffected). */
    clearNotifications() {
      setDb((d) => ({ ...d, notifications: [] }));
      void sb().from('notifications').delete().gte('id', 0).then(({ error }) => error && void load(['notifications']));
    },
    reload: load,

    // ---------- partners
    addPartner(p: Without<Partner, 'id' | 'joinedAt'>) {
      const id = newId();
      void insert('partners', { ...p, id, joinedAt: now() }, toRow({ ...p, id }));
      return id;
    },
    updatePartner(id: ID, patch: Partial<Partner>) {
      void update('partners', id, patch);
    },
    removePartner(id: ID) {
      void remove('partners', id, 'Only a Super Admin can remove partners.').then(() => load());
    },

    // ---------- students
    addStudent(s: Without<Student, 'id' | 'createdAt'>) {
      const id = newId();
      void insert('students', { ...s, id, createdAt: now() }, toRow({ ...s, id }));
      return id;
    },
    updateStudent(id: ID, patch: Partial<Student>) {
      void update('students', id, patch);
    },
    async removeStudent(id: ID) {
      const s = db.students.find((x) => x.id === id);
      // Delete the student's files first so no orphaned personal documents remain in storage.
      if (s) {
        const folder = `${s.partnerId}/${id}`;
        const { data: files } = await sb().storage.from(BUCKET).list(folder);
        if (files?.length) await sb().storage.from(BUCKET).remove(files.map((f) => `${folder}/${f.name}`));
      }
      setDb((d) => ({
        ...d,
        students: d.students.filter((x) => x.id !== id),
        applications: d.applications.filter((a) => a.studentId !== id),
        documents: d.documents.filter((x) => x.studentId !== id),
        assessments: d.assessments.filter((x) => x.studentId !== id),
      }));
      await commit(sb().from('students').delete().eq('id', id));
    },

    // ---------- applications (ref, tenant and timeline are set by the server)
    /**
     * Creates an application and waits for the server. `id` is generated by the form once per
     * attempt and reused on retry, so a repeated request can never create a second row. The
     * database rejects exact duplicates (same student, university, course and intake while the
     * earlier one is open) and reports which application already exists.
     */
    async createApplication(a: Without<Application, 'id' | 'ref' | 'appliedAt' | 'timeline'>, id: ID): Promise<CreateApplicationResult> {
      const res = await sb().from('applications').insert(toRow({ ...a, id }, ['partnerId'])).select('*').single();
      if (!res.error && res.data) {
        upsertLocal('applications', fromRow<Application>(res.data as Row));
        void refreshActivities();
        return { ok: true, id };
      }
      const msg = res.error?.message ?? '';
      const dup = msg.match(/DUPLICATE_APPLICATION:([^:]*):(.*)$/);
      if (dup) return { ok: false, reason: 'duplicate', existingId: dup[1], existingRef: dup[2] };
      if (res.error?.code === '23505') {
        // Primary-key clash: an earlier attempt with this id already succeeded.
        await load(['applications']);
        return { ok: true, id };
      }
      return { ok: false, reason: 'error', message: 'The application could not be created. Partners can create Draft or Pending Assessment applications only.' };
    },
    addApplication(a: Without<Application, 'id' | 'ref' | 'appliedAt' | 'timeline'>) {
      const id = newId();
      const local: Application = { ...a, id, ref: '…', appliedAt: now(), timeline: [{ status: a.status, at: now(), by: session?.name ?? '' }] };
      void insert('applications', local, toRow({ ...a, id }, ['partnerId']), 'Partners can create Draft or Pending Assessment applications only.');
      return id;
    },
    setApplicationStatus(id: ID, status: AppStatus, note?: string) {
      void (async () => {
        patchLocal('applications', id, { status });
        const res = await sb().from('applications').update({ status, status_note: note || null }).eq('id', id).select('*');
        if (await commit(Promise.resolve(res), 'Only SSI GLOBAL staff can change this status.') && res.data?.[0])
          upsertLocal('applications', fromRow<Application>(res.data[0] as Row));
      })();
    },
    toggleChecklist(id: ID, index: number) {
      const app = db.applications.find((a) => a.id === id);
      if (!app) return;
      void update('applications', id, { checklist: app.checklist.map((c, i) => (i === index ? { ...c, done: !c.done } : c)) });
    },
    updateApplication(id: ID, patch: Partial<Application>) {
      void update('applications', id, patch);
    },
    removeApplication(id: ID) {
      void remove('applications', id);
    },

    // ---------- documents (private storage + metadata row)
    async addDocument(input: { studentId: ID; type: DocType; file: File }) {
      const student = db.students.find((s) => s.id === input.studentId);
      if (!student) throw new Error('Unknown student');
      const prepared = await prepareUpload(input.file); // validates type by content, size and name
      const id = newId();
      const path = `${student.partnerId}/${student.id}/${id}.${prepared.ext}`;
      const up = await sb().storage.from(BUCKET).upload(path, input.file, { contentType: prepared.mime, upsert: false });
      if (up.error) throw new Error('Upload was rejected by the server.');
      const row = { id, student_id: student.id, name: `${input.type} — ${student.firstName} ${student.lastName}`, type: input.type, file_name: prepared.safeName, size: input.file.size, storage_path: path };
      const res = await sb().from('documents').insert(row).select('*').single();
      if (res.error) {
        await sb().storage.from(BUCKET).remove([path]);
        throw new Error('The document could not be saved.');
      }
      upsertLocal('documents', fromRow(res.data as Row));
      void refreshActivities();
    },
    /** Server checks access (RLS), logs the download and returns a 60-second signed URL. */
    async documentUrl(id: ID): Promise<string> {
      const { data: path, error } = await sb().rpc('authorize_document_download', { doc_id: id });
      if (error || !path) throw new Error('You do not have access to this document.');
      const { data, error: e2 } = await sb().storage.from(BUCKET).createSignedUrl(path as string, 60);
      if (e2 || !data) throw new Error('The file is not available.');
      return data.signedUrl;
    },
    setDocumentStatus(id: ID, status: DocStatus) {
      void update('documents', id, { status }, 'Only SSI GLOBAL staff can verify documents.');
    },
    async removeDocument(id: ID) {
      const d = db.documents.find((x) => x.id === id);
      removeLocal('documents', id);
      if (await commit(sb().from('documents').delete().eq('id', id)) && d?.storagePath) await sb().storage.from(BUCKET).remove([d.storagePath]);
    },

    // ---------- assessments
    addAssessment(a: Without<Assessment, 'id' | 'requestedAt' | 'status' | 'notes'>) {
      const id = newId();
      void insert('assessments', { ...a, id, requestedAt: now(), status: 'Pending', notes: '' }, toRow({ ...a, id }, ['partnerId']));
    },
    setAssessmentStatus(id: ID, status: AssessmentStatus, notes?: string) {
      void update('assessments', id, notes === undefined ? { status } : { status, notes }, 'Only SSI GLOBAL staff can review assessments.');
    },

    // ---------- finance (staff only on the server)
    addPayment(p: Without<Payment, 'id' | 'invoiceNo'>) {
      const id = newId();
      const invoiceNo = `INV-${Date.now().toString(36).toUpperCase()}`;
      void insert('payments', { ...p, id, invoiceNo }, toRow({ ...p, id, invoiceNo }));
    },
    recordPayment(id: ID, amount: number) {
      const p = db.payments.find((x) => x.id === id);
      if (!p) return;
      const paid = Math.min(p.amount, p.paid + amount);
      void update('payments', id, { paid, status: paid >= p.amount ? 'Paid' : 'Partially Paid' });
    },
    removePayment(id: ID) {
      void remove('payments', id);
    },

    // ---------- tasks (staff only)
    addTask(t: Without<Task, 'id' | 'done'>) {
      const id = newId();
      void insert('tasks', { ...t, id, done: false }, toRow({ ...t, id }));
    },
    toggleTask(id: ID) {
      const t = db.tasks.find((x) => x.id === id);
      if (t) void update('tasks', id, { done: !t.done });
    },
    removeTask(id: ID) {
      void remove('tasks', id);
    },

    // ---------- announcements (staff only on the server)
    saveAnnouncement(a: Without<Announcement, 'id' | 'createdAt'> & { id?: ID }) {
      if (a.id) return void update('announcements', a.id, a);
      const id = newId();
      void insert('announcements', { ...a, id, createdAt: now() }, toRow({ ...a, id }));
    },
    setAnnouncementPublished(id: ID, published: boolean) {
      const a = db.announcements.find((x) => x.id === id);
      if (!a) return;
      const publishAt = published && new Date(a.publishAt) > new Date() ? a.publishAt : published ? now() : a.publishAt;
      void update('announcements', id, { published, publishAt });
    },
    removeAnnouncement(id: ID) {
      void remove('announcements', id);
    },

    // ---------- catalogue (staff only on the server)
    addUniversity(u: Without<University, 'id'>) {
      const id = newId();
      void insert('universities', { ...u, id }, toRow({ ...u, id }));
    },
    removeUniversity(id: ID) {
      setDb((d) => ({ ...d, courses: d.courses.filter((c) => c.universityId !== id) }));
      void remove('universities', id);
    },
    addCourse(c: Without<Course, 'id'>) {
      const id = newId();
      void insert('courses', { ...c, id }, toRow({ ...c, id }));
    },
    updateCourse(id: ID, patch: Partial<Course>) {
      void update('courses', id, patch);
    },
    removeCourse(id: ID) {
      void remove('courses', id);
    },
    updateUniversity(id: ID, patch: Partial<University>) {
      void update('universities', id, patch);
    },
    addIntake(i: Without<CourseIntake, 'id'>) {
      const id = newId();
      void insert('courseIntakes', { ...i, id }, toRow({ ...i, id }), 'This intake could not be added (it may already exist for this course).');
    },
    updateIntake(id: ID, patch: Partial<CourseIntake>) {
      void update('courseIntakes', id, patch, 'This intake could not be saved (another intake may use the same month and year).');
    },
    removeIntake(id: ID) {
      void remove('courseIntakes', id);
    },
    /** Server-side, validated, transactional import (public.import_catalogue). */
    async importCatalogue(payload: unknown, overwrite: boolean) {
      const { data, error } = await sb().rpc('import_catalogue', { p: payload, p_overwrite: overwrite });
      if (error) throw new Error(error.message.includes('catalogue') ? error.message : 'The import was rejected by the server.');
      await load(['universities', 'courses', 'courseIntakes', 'blacklist']);
      return data as ImportSummary;
    },
  };

  return { db, session, actions, loading, live, profilesRev };
}

type StoreValue = ReturnType<typeof useStoreValue>;
/** Exported for the development gallery only (it feeds forms sample data). */
export const StoreContext = createContext<StoreValue | null>(null);
export type { StoreValue };

export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useStoreValue();
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}

/**
 * Role-scoped view for rendering. The server has already filtered rows by RLS; this
 * additionally narrows a staff member's partner preview to that partner.
 */
export function useScoped() {
  const { db, session } = useStore();
  const partnerId = session?.role === 'client' ? session.partnerId : undefined;
  return useMemo(() => {
    const own = <T extends { partnerId: ID }>(rows: T[]) => (partnerId ? rows.filter((r) => r.partnerId === partnerId) : rows);
    const announcements = db.announcements.filter((a) => !partnerId || a.audience === 'all' || a.audience.includes(partnerId));
    return {
      isAdmin: !partnerId,
      partnerId,
      userRole: session?.userRole,
      partner: partnerId ? db.partners.find((p) => p.id === partnerId) : undefined,
      students: own(db.students),
      applications: own(db.applications),
      documents: own(db.documents),
      assessments: own(db.assessments),
      payments: own(db.payments),
      activities: partnerId ? db.activities.filter((a) => a.partnerId === partnerId || a.kind === 'update') : db.activities,
      announcements,
      universities: db.universities,
      courses: db.courses,
      partners: db.partners,
      base: partnerId ? '/client' : session?.role === 'staff' ? '/staff' : '/admin',
    };
  }, [db, partnerId, session?.userRole, session?.role]);
}

/** Lookup helpers shared by many pages. */
export function useLookup() {
  const { db } = useStore();
  return useMemo(() => {
    const byId = <T extends { id: ID }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
    return {
      student: byId(db.students),
      partner: byId(db.partners),
      university: byId(db.universities),
      course: byId(db.courses),
    };
  }, [db]);
}
