// Prototype data layer: a single in-memory DB persisted to localStorage.
// Every write goes through an action below, so replacing this provider with
// Supabase (or any API) means re-implementing these actions — pages stay as-is.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createSeed, DB_VERSION } from '../data/seed';
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
  DocumentRecord,
  ID,
  Partner,
  Payment,
  Session,
  Student,
  Task,
  University,
} from '../data/types';
import { fullName, uid } from '../lib/utils';

const DB_KEY = 'ssi-crm-db';
const SESSION_KEY = 'ssi-crm-session';

function loadDB(): DB {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      if (parsed.version === DB_VERSION) return parsed;
    }
  } catch {
    /* storage unavailable or corrupted — fall back to seed */
  }
  return createSeed();
}

function loadSession(): Session | null {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const raw = store.getItem(SESSION_KEY);
      if (raw) return JSON.parse(raw) as Session;
    } catch {
      /* ignore */
    }
  }
  return null;
}

type Without<T, K extends keyof T> = Omit<T, K>;

function useStoreValue() {
  const [db, setDb] = useState<DB>(loadDB);
  const [session, setSession] = useState<Session | null>(loadSession);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
    } catch {
      /* quota or private mode */
    }
  }, [db]);

  const mutate = useCallback((fn: (d: DB) => DB) => setDb((d) => fn(d)), []);

  const actorName = () => {
    const s = sessionRef.current;
    return s?.role === 'admin' ? 'SSI Admin' : s?.name ?? 'Partner';
  };

  const log = (d: DB, a: Without<Activity, 'id' | 'at'>): Activity[] => [
    { ...a, id: uid('ac'), at: new Date().toISOString() },
    ...d.activities,
  ].slice(0, 80);

  const studentLabel = (d: DB, id: ID) => fullName(d.students.find((s) => s.id === id));

  const actions = {
    // ---------- auth ----------
    login(s: Session, remember: boolean) {
      try {
        (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(s));
      } catch {
        /* ignore */
      }
      setSession(s);
    },
    logout() {
      try {
        localStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_KEY);
      } catch {
        /* ignore */
      }
      setSession(null);
    },
    resetDemo() {
      setDb(createSeed());
    },
    markNotificationsRead() {
      const s = sessionRef.current;
      const now = new Date().toISOString();
      mutate((d) => ({
        ...d,
        readAt:
          s?.role === 'client' && s.partnerId
            ? { ...d.readAt, client: { ...d.readAt.client, [s.partnerId]: now } }
            : { ...d.readAt, admin: now },
      }));
    },

    // ---------- partners ----------
    addPartner(p: Without<Partner, 'id' | 'joinedAt'>) {
      const id = uid('p');
      mutate((d) => ({
        ...d,
        partners: [{ ...p, id, joinedAt: new Date().toISOString() }, ...d.partners],
        activities: log(d, { kind: 'partner', title: 'New partner onboarded', detail: p.name, partnerId: id }),
      }));
      return id;
    },
    updatePartner(id: ID, patch: Partial<Partner>) {
      mutate((d) => ({ ...d, partners: d.partners.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    },
    removePartner(id: ID) {
      mutate((d) => ({
        ...d,
        partners: d.partners.filter((p) => p.id !== id),
        students: d.students.filter((s) => s.partnerId !== id),
        applications: d.applications.filter((a) => a.partnerId !== id),
        documents: d.documents.filter((x) => x.partnerId !== id),
        assessments: d.assessments.filter((x) => x.partnerId !== id),
        payments: d.payments.filter((x) => x.partnerId !== id),
      }));
    },

    // ---------- students ----------
    addStudent(s: Without<Student, 'id' | 'createdAt'>) {
      const id = uid('s');
      mutate((d) => ({
        ...d,
        students: [{ ...s, id, createdAt: new Date().toISOString() }, ...d.students],
        activities: log(d, { kind: 'student', title: 'New student added', detail: `${s.firstName} ${s.lastName}`, partnerId: s.partnerId }),
      }));
      return id;
    },
    updateStudent(id: ID, patch: Partial<Student>) {
      mutate((d) => ({ ...d, students: d.students.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
    },
    removeStudent(id: ID) {
      mutate((d) => ({
        ...d,
        students: d.students.filter((s) => s.id !== id),
        applications: d.applications.filter((a) => a.studentId !== id),
        documents: d.documents.filter((x) => x.studentId !== id),
        assessments: d.assessments.filter((x) => x.studentId !== id),
      }));
    },

    // ---------- applications ----------
    addApplication(a: Without<Application, 'id' | 'ref' | 'appliedAt' | 'timeline'>) {
      const id = uid('a');
      const now = new Date().toISOString();
      mutate((d) => {
        const uni = d.universities.find((u) => u.id === a.universityId);
        return {
          ...d,
          applications: [
            {
              ...a,
              id,
              ref: `SSI-${24100 + d.applications.length * 7 + Math.floor(Math.random() * 6)}`,
              appliedAt: now,
              timeline: [{ status: a.status, at: now, by: actorName(), note: 'Application created' }],
            },
            ...d.applications,
          ],
          activities: log(d, {
            kind: 'application',
            title: 'New application created',
            detail: `${studentLabel(d, a.studentId)} · ${uni?.name ?? ''}`,
            partnerId: a.partnerId,
          }),
        };
      });
      return id;
    },
    setApplicationStatus(id: ID, status: AppStatus, note?: string) {
      mutate((d) => {
        const app = d.applications.find((a) => a.id === id);
        if (!app || app.status === status) return d;
        const uni = d.universities.find((u) => u.id === app.universityId);
        return {
          ...d,
          applications: d.applications.map((a) =>
            a.id === id
              ? { ...a, status, timeline: [...a.timeline, { status, at: new Date().toISOString(), by: actorName(), note: note || undefined }] }
              : a,
          ),
          activities: log(d, {
            kind: 'status',
            title: `Status changed to ${status}`,
            detail: `${studentLabel(d, app.studentId)} · ${uni?.name ?? ''}`,
            partnerId: app.partnerId,
          }),
        };
      });
    },
    toggleChecklist(id: ID, index: number) {
      mutate((d) => ({
        ...d,
        applications: d.applications.map((a) =>
          a.id === id ? { ...a, checklist: a.checklist.map((c, i) => (i === index ? { ...c, done: !c.done } : c)) } : a,
        ),
      }));
    },
    updateApplication(id: ID, patch: Partial<Application>) {
      mutate((d) => ({ ...d, applications: d.applications.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
    },
    removeApplication(id: ID) {
      mutate((d) => ({ ...d, applications: d.applications.filter((a) => a.id !== id) }));
    },

    // ---------- documents ----------
    addDocument(doc: Without<DocumentRecord, 'id' | 'uploadedAt' | 'status'>) {
      mutate((d) => ({
        ...d,
        documents: [{ ...doc, id: uid('d'), uploadedAt: new Date().toISOString(), status: 'Pending' }, ...d.documents],
        activities: log(d, { kind: 'document', title: 'Document uploaded', detail: `${doc.type} · ${studentLabel(d, doc.studentId)}`, partnerId: doc.partnerId }),
      }));
    },
    setDocumentStatus(id: ID, status: DocStatus) {
      mutate((d) => ({ ...d, documents: d.documents.map((x) => (x.id === id ? { ...x, status } : x)) }));
    },
    removeDocument(id: ID) {
      mutate((d) => ({ ...d, documents: d.documents.filter((x) => x.id !== id) }));
    },

    // ---------- assessments ----------
    addAssessment(a: Without<Assessment, 'id' | 'requestedAt' | 'status' | 'notes'>) {
      mutate((d) => ({
        ...d,
        assessments: [{ ...a, id: uid('as'), requestedAt: new Date().toISOString(), status: 'Pending', notes: '' }, ...d.assessments],
        activities: log(d, { kind: 'assessment', title: 'Assessment requested', detail: studentLabel(d, a.studentId), partnerId: a.partnerId }),
      }));
    },
    setAssessmentStatus(id: ID, status: AssessmentStatus, notes?: string) {
      mutate((d) => {
        const as = d.assessments.find((x) => x.id === id);
        return {
          ...d,
          assessments: d.assessments.map((x) => (x.id === id ? { ...x, status, notes: notes ?? x.notes } : x)),
          activities: as
            ? log(d, { kind: 'assessment', title: `Assessment marked ${status}`, detail: studentLabel(d, as.studentId), partnerId: as.partnerId })
            : d.activities,
        };
      });
    },

    // ---------- finance ----------
    addPayment(p: Without<Payment, 'id' | 'invoiceNo'>) {
      mutate((d) => ({ ...d, payments: [{ ...p, id: uid('pay'), invoiceNo: `INV-${5100 + d.payments.length + 1}` }, ...d.payments] }));
    },
    recordPayment(id: ID, amount: number) {
      mutate((d) => {
        const p = d.payments.find((x) => x.id === id);
        return {
          ...d,
          payments: d.payments.map((x) => {
            if (x.id !== id) return x;
            const paid = Math.min(x.amount, x.paid + amount);
            return { ...x, paid, status: paid >= x.amount ? 'Paid' : 'Partially Paid' };
          }),
          activities: p ? log(d, { kind: 'payment', title: 'Payment recorded', detail: `${p.invoiceNo} · ${p.description}`, partnerId: p.partnerId }) : d.activities,
        };
      });
    },
    removePayment(id: ID) {
      mutate((d) => ({ ...d, payments: d.payments.filter((x) => x.id !== id) }));
    },

    // ---------- tasks ----------
    addTask(t: Without<Task, 'id' | 'done'>) {
      mutate((d) => ({ ...d, tasks: [{ ...t, id: uid('t'), done: false }, ...d.tasks] }));
    },
    toggleTask(id: ID) {
      mutate((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) }));
    },
    removeTask(id: ID) {
      mutate((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }));
    },

    // ---------- announcements ----------
    saveAnnouncement(a: Without<Announcement, 'id' | 'createdAt'> & { id?: ID }) {
      mutate((d) => {
        if (a.id) return { ...d, announcements: d.announcements.map((x) => (x.id === a.id ? { ...x, ...a, id: x.id } : x)) };
        return {
          ...d,
          announcements: [{ ...a, id: uid('n'), createdAt: new Date().toISOString() }, ...d.announcements],
          activities: a.published ? log(d, { kind: 'update', title: 'Announcement published', detail: a.title }) : d.activities,
        };
      });
    },
    setAnnouncementPublished(id: ID, published: boolean) {
      mutate((d) => {
        const a = d.announcements.find((x) => x.id === id);
        const now = new Date().toISOString();
        return {
          ...d,
          announcements: d.announcements.map((x) =>
            x.id === id ? { ...x, published, publishAt: published && new Date(x.publishAt) > new Date() ? x.publishAt : published ? now : x.publishAt } : x,
          ),
          activities: a && published ? log(d, { kind: 'update', title: 'Announcement published', detail: a.title }) : d.activities,
        };
      });
    },
    removeAnnouncement(id: ID) {
      mutate((d) => ({ ...d, announcements: d.announcements.filter((x) => x.id !== id) }));
    },

    // ---------- catalogue ----------
    addUniversity(u: Without<University, 'id'>) {
      mutate((d) => ({ ...d, universities: [...d.universities, { ...u, id: uid('u') }] }));
    },
    removeUniversity(id: ID) {
      mutate((d) => ({ ...d, universities: d.universities.filter((u) => u.id !== id), courses: d.courses.filter((c) => c.universityId !== id) }));
    },
    addCourse(c: Without<Course, 'id'>) {
      mutate((d) => ({ ...d, courses: [...d.courses, { ...c, id: uid('c') }] }));
    },
    updateCourse(id: ID, patch: Partial<Course>) {
      mutate((d) => ({ ...d, courses: d.courses.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
    },
    removeCourse(id: ID) {
      mutate((d) => ({ ...d, courses: d.courses.filter((c) => c.id !== id) }));
    },
  };

  return { db, session, actions };
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
 * Role-scoped view of the data. Admin sees everything; a client sees only its
 * own partner workspace. Pages should read records through this hook.
 */
export function useScoped() {
  const { db, session } = useStore();
  const partnerId = session?.role === 'client' ? session.partnerId : undefined;
  return useMemo(() => {
    const own = <T extends { partnerId: ID }>(rows: T[]) => (partnerId ? rows.filter((r) => r.partnerId === partnerId) : rows);
    const announcements = db.announcements.filter(
      (a) => !partnerId || a.audience === 'all' || a.audience.includes(partnerId),
    );
    return {
      isAdmin: !partnerId,
      partnerId,
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
  }, [db, partnerId]);
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
