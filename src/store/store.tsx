// Data layer backed by Supabase. Every read is filtered by row-level security on the
// server (a partner only ever receives its own organisation's rows), and every write is
// re-checked there (tenant, role and workflow rules live in supabase/migrations).
// The UI keeps a local copy for fast rendering and re-syncs after each change.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  Activity,
  Announcement,
  AppStatus,
  Application,
  Assessment,
  AssessmentStatus,
  Course,
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
  readAt: '',
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
  const userId = realSession?.userId;
  const readKey = userId ? `ssi-read-${userId}` : '';

  const load = useCallback(async () => {
    if (!supabase || status !== 'signed-in' || !realSession) return;
    const sb = supabase;
    const keys = Object.keys(TABLES).filter((k) => k !== 'tasks' || realSession.role === 'admin') as TableKey[];
    const results = await Promise.all([
      ...keys.map((k) => sb.from(TABLES[k]).select('*').limit(5000)),
      sb.from('activities').select('*').order('at', { ascending: false }).limit(80),
    ]);
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      toast.error('Could not load data', 'Please refresh the page. If this continues, contact SSI GLOBAL.');
      return;
    }
    const next = emptyDB();
    keys.forEach((k, i) => {
      (next[k] as unknown[]) = (results[i].data ?? []).map((r) => fromRow(r as Row));
    });
    next.activities = (results[results.length - 1].data ?? []).map((r) => fromRow<Activity>(r as Row));
    try {
      next.readAt = localStorage.getItem(readKey) ?? '';
    } catch {
      next.readAt = '';
    }
    setDb(next);
    setLoading(false);
  }, [status, realSession, readKey, toast]);

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
    const h = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, [status, userId, load]);

  const refreshActivities = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from('activities').select('*').order('at', { ascending: false }).limit(80);
    if (data) setDb((d) => ({ ...d, activities: data.map((r) => fromRow<Activity>(r as Row)) }));
  }, []);

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
    patchLocal(key, id, patch);
    const res = await sb().from(TABLES[key]).update(toRow(patch)).eq('id', id).select('*');
    if (!res.error && (res.data?.length ?? 0) === 0) return void (await commit(Promise.resolve({ error: 'denied' }), failMsg));
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
      const t = now();
      try {
        if (readKey) localStorage.setItem(readKey, t);
      } catch {
        /* ignore */
      }
      setDb((d) => ({ ...d, readAt: t }));
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
      void remove('partners', id, 'Only a Super Admin can remove partners.').then(load);
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
  };

  return { db, session, actions, loading };
}

type StoreValue = ReturnType<typeof useStoreValue>;
const StoreContext = createContext<StoreValue | null>(null);

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
      base: partnerId ? '/client' : '/admin',
    };
  }, [db, partnerId, session?.userRole]);
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
