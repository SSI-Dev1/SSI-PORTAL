// Development-only harness (route #/ui/chat): the real Applications page, chat window and Advanced
// Course Search fed from memory, so the UI can be checked without signing in. Search rows and
// options were exported from a local database by the real search_courses() and
// course_search_facets(); the small filter below is a stand-in, and the SQL tests cover the engine.
import { useMemo, useRef, useState } from 'react';
import Applications from './shared/Applications';
import Messages from './shared/Messages';
import CourseSearch from './shared/CourseSearch';
import { Button, Card, Switch } from '../components/ui';
import { StoreContext, type StoreValue } from '../store/store';
import { ChatProvider, type ChatApi, type ChatContextInfo, type ChatMessage, type ChatSummary } from '../store/chat';
import { CourseSearchApiContext, type CourseSearchApi, type Facets, type SearchRow } from '../lib/courseSearch';
import type { DB } from '../data/types';
import sample from './dev-fixtures/course-search-sample.json';

const rows = sample.rows as unknown as SearchRow[];
const facets = sample.facets as unknown as Facets;

const searchApi: CourseSearchApi = {
  async search(f, sort, limit, offset) {
    const has = (k: string) => (f[k] as string[] | undefined)?.length;
    const inList = (k: string, v: string | null) => !has(k) || (f[k] as string[]).includes(v ?? '');
    const exams = (f.exams ?? {}) as Record<string, { score?: string }>;
    const flags = (f.flags ?? []) as string[];
    const words = String(f.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const list = rows.filter((r) => {
      const req: Record<string, number | null> = { IELTS: r.ielts, TOEFL: r.toefl, PTE: r.pte, DET: r.det };
      return words.every((w) => `${r.name} ${r.university.name} ${r.campus ?? ''}`.toLowerCase().includes(w))
        && inList('levels', r.programLevel ?? r.level) && inList('countries', r.university.country) && inList('universities', r.university.id) && inList('campuses', r.campus)
        && inList('durations', r.duration) && inList('app_fees', r.applicationFee)
        && (!Object.keys(exams).length || Object.entries(exams).some(([e, v]) => req[e] != null && (!v.score || req[e]! <= Number(v.score))))
        && (!flags.includes('scholarship') || r.hasScholarship) && (!flags.includes('english_waiver') || !!r.englishWaiver)
        && (!has('intake_labels') || r.intakes.some((i) => (f.intake_labels as string[]).includes(i.label)))
        && (!f.tuition_min || r.tuition >= Number(f.tuition_min)) && (!f.tuition_max || r.tuition <= Number(f.tuition_max));
    });
    if (sort === 'tuition_asc') list.sort((a, b) => a.tuition - b.tuition);
    if (sort === 'tuition_desc') list.sort((a, b) => b.tuition - a.tuition);
    return { total: list.length, rows: list.slice(offset, offset + limit) };
  },
  async facets() {
    return facets;
  },
};

const ME = 'demo-admin';
const APPS = ['app-1', 'app-2'];

function useFakeChat() {
  const msgs = useRef<ChatMessage[]>([]);
  const nextId = useRef(1);
  const readUpto = useRef<Record<string, number>>({});
  const theirRead = useRef(0);
  const fail = useRef(false);
  const listeners = useRef(new Set<() => void>());
  const emit = () => listeners.current.forEach((l) => l());
  const add = (applicationId: string, senderId: string, senderName: string, senderRole: string, senderOrg: string, body: string, clientId: string = crypto.randomUUID()) => {
    const m: ChatMessage = { id: nextId.current++, applicationId, senderId, senderName, senderRole, senderOrg, body, clientId, createdAt: new Date().toISOString() };
    msgs.current.push(m);
    return m;
  };
  if (!msgs.current.length) {
    add('app-1', 'p', 'Meera Krishnan', 'partner_admin', 'Horizon Edu', 'Why is the assessment still pending?');
    add('app-1', 'p', 'Meera Krishnan', 'partner_admin', 'Horizon Edu', 'The student has sent all documents.\nPassport and transcripts are uploaded.');
  }
  const api: ChatApi = {
    async summaries() {
      const out: Record<string, ChatSummary> = {};
      for (const id of APPS) {
        const list = msgs.current.filter((m) => m.applicationId === id);
        out[id] = { total: list.length, unread: list.filter((m) => m.senderId !== ME && m.id > (readUpto.current[id] ?? 0)).length, lastMessageAt: list[list.length - 1]?.createdAt ?? null };
      }
      return out;
    },
    async inbox({ all }) {
      const sums = await api.summaries();
      return APPS.filter((id) => all || sums[id].total > 0).map((id) => ({
        applicationId: id, ref: id === 'app-1' ? 'APP-001' : 'APP-002', student: id === 'app-1' ? 'Sample Student One' : 'Sample Student Two',
        university: 'University of East Anglia', course: 'MSc Business Management', partner: 'Horizon Edu', status: 'Offer Pending', intake: 'Sep 2027',
        unread: sums[id].unread, total: sums[id].total, lastMessageAt: sums[id].lastMessageAt,
        lastSender: [...msgs.current].reverse().find((m) => m.applicationId === id)?.senderName ?? null,
      }));
    },
    async context(id) {
      const info: ChatContextInfo = {
        id, ref: id === 'app-1' ? 'APP-001' : 'APP-002', status: 'Offer Pending', intake: 'Sep 2027', student: id === 'app-1' ? 'Sample Student One' : 'Sample Student Two',
        university: 'University of East Anglia', course: 'MSc Business Management', partner: 'Horizon Edu', myLastReadId: readUpto.current[id] ?? 0,
        reads: [{ userId: ME, name: 'Demo Admin', lastReadId: readUpto.current[id] ?? 0 }, { userId: 'p', name: 'Meera Krishnan', lastReadId: theirRead.current }],
      };
      return info;
    },
    async messages(id, { before, limit }) {
      return msgs.current.filter((m) => m.applicationId === id && (!before || m.id < before)).sort((a, b) => b.id - a.id).slice(0, limit);
    },
    async send(id, body, clientId) {
      await new Promise((r) => setTimeout(r, 400));
      if (fail.current) throw new Error('network');
      const old = msgs.current.find((m) => m.clientId === clientId);
      if (old) return old;
      const m = add(id, ME, 'Demo Admin', 'super_admin', 'SSI GLOBAL', body, clientId);
      readUpto.current[id] = m.id;
      emit();
      return m;
    },
    async markRead(id, upto) {
      readUpto.current[id] = Math.max(readUpto.current[id] ?? 0, upto);
    },
    subscribe(_id, cb) {
      listeners.current.add(cb);
      return () => listeners.current.delete(cb);
    },
  };
  return {
    api,
    setFail: (v: boolean) => { fail.current = v; },
    incoming: () => {
      theirRead.current = nextId.current - 1;
      add('app-1', 'p', 'Meera Krishnan', 'partner_admin', 'Horizon Edu', `Thanks. Has the university responded? <b>(sample ${nextId.current})</b>`);
      emit();
    },
  };
}

export default function ChatSearchDemo() {
  const [view, setView] = useState<'apps' | 'messages' | 'search'>('apps');
  const [failing, setFailing] = useState(false);
  const chat = useFakeChat();
  const api = useRef(chat.api).current;
  const store = useMemo(() => {
    const tl = (at: string) => [{ status: 'Offer Pending' as const, at, by: 'Demo' }];
    const T = new Date().toISOString();
    const unis = facets.universities.map((u) => ({ id: u.id, name: u.name, country: 'United Kingdom', city: 'Norwich', ranking: 0, type: 'Public', partnerSince: '2025', website: '', active: true }));
    const uni = unis[0]?.id ?? 'u';
    const db = {
      partners: [{ id: 'p1', name: 'Horizon Edu', code: 'HEC', city: 'Kochi', country: 'India' }],
      students: [{ id: 's1', partnerId: 'p1', firstName: 'Sample', lastName: 'Student One', email: 's1@x.test' }, { id: 's2', partnerId: 'p1', firstName: 'Sample', lastName: 'Student Two', email: 's2@x.test' }],
      universities: unis, courses: rows.map((r) => ({ id: r.id, universityId: r.university.id, name: r.name, level: r.level, field: r.field ?? '', duration: r.duration ?? '', tuition: r.tuition, currency: r.currency, intakes: [], ieltsMin: r.ielts ?? 0 })),
      applications: [
        { id: 'app-1', ref: 'APP-001', studentId: 's1', partnerId: 'p1', universityId: rows[0].university.id, courseId: rows[0].id, intake: 'Sep 2027', appliedAt: T, status: 'Offer Pending', checklist: [], timeline: tl(T) },
        { id: 'app-2', ref: 'APP-002', studentId: 's2', partnerId: 'p1', universityId: uni, courseId: rows[1].id, intake: 'Jan 2028', appliedAt: T, status: 'Offer Pending', checklist: [], timeline: tl(T) },
      ],
      documents: [], assessments: [], payments: [], tasks: [], announcements: [], activities: [], notifications: [], staff: [], courseIntakes: [], blacklist: [],
    } as unknown as DB;
    const session = { role: 'admin', userRole: 'super_admin', userId: ME, name: 'Demo Admin', email: '', title: '', permissions: ['catalogue', 'applications'], partnerModules: [] };
    return { db, session, actions: {}, loading: false, live: 'live', profilesRev: 0 } as unknown as StoreValue;
  }, []);
  return (
    <StoreContext.Provider value={store}>
      <CourseSearchApiContext.Provider value={searchApi}>
        <ChatProvider api={api}>
          <div className="min-h-screen space-y-4 bg-canvas p-4 sm:p-6">
            <Card className="flex flex-wrap items-center gap-2 p-4 text-sm text-ink-soft">
              Dev harness
              <Button size="sm" variant={view === 'apps' ? 'primary' : 'secondary'} onClick={() => setView('apps')}>Applications</Button>
              <Button size="sm" variant={view === 'messages' ? 'primary' : 'secondary'} onClick={() => setView('messages')}>Messages</Button>
              <Button size="sm" variant={view === 'search' ? 'primary' : 'secondary'} onClick={() => setView('search')}>Course search</Button>
              <Button size="sm" variant="secondary" onClick={chat.incoming}>Receive partner message</Button>
              <span className="inline-flex items-center gap-2"><Switch checked={failing} onCheckedChange={(v) => { setFailing(v); chat.setFail(v); }} label="Fail sends" /> Fail sends</span>
            </Card>
            {view === 'apps' ? <Applications /> : view === 'messages' ? <Messages /> : <CourseSearch />}
          </div>
        </ChatProvider>
      </CourseSearchApiContext.Provider>
    </StoreContext.Provider>
  );
}
