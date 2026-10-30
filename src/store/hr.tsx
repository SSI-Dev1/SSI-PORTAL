// HR and employee-operations data for internal users (Admin, HR, managers, employees).
// Same rules as the main store: every read goes through RLS, every write is a database
// function that re-checks permissions and policy, Realtime events only mark a collection as
// changed (it is then re-fetched), and everything is reconciled on reconnect, focus and every
// 60 seconds — so no screen depends on an event arriving and nothing needs a manual refresh.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../auth/auth';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../components/feedback';
import { addDays, companyDate, serverMessage } from '../data/hr';
import type {
  AttendanceCorrection,
  AttendanceDay,
  BreakSession,
  CalendarDay,
  DailyReport,
  Department,
  Designation,
  DirectoryEntry,
  EarlyCheckout,
  Employee,
  Holiday,
  LeaveBalance,
  LeaveRequest,
  LeaveType,
  MyTemplate,
  ReportTemplate,
  Salary,
  Setting,
  Shift,
} from '../data/hr';

type Row = Record<string, unknown>;
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const fromRow = <T,>(r: Row): T => {
  const o: Row = {};
  for (const [k, v] of Object.entries(r)) o[camel(k)] = v;
  if (typeof o.id === 'number') o.id = String(o.id);
  return o as T;
};

export interface HRData {
  employees: Employee[];
  directory: DirectoryEntry[];
  departments: Department[];
  designations: Designation[];
  shifts: Shift[];
  salaries: Salary[];
  settings: Setting[];
  attendance: AttendanceDay[];
  breaks: BreakSession[];
  corrections: AttendanceCorrection[];
  earlyCheckouts: EarlyCheckout[];
  leaveTypes: LeaveType[];
  leaveRequests: LeaveRequest[];
  balances: LeaveBalance[];
  holidays: Holiday[];
  calendar: CalendarDay[];
  reports: DailyReport[];
  templates: ReportTemplate[];
  myTemplates: MyTemplate[];
}
const empty = (): HRData => ({
  employees: [], directory: [], departments: [], designations: [], shifts: [], salaries: [], settings: [], attendance: [], breaks: [],
  corrections: [], earlyCheckouts: [], leaveTypes: [], leaveRequests: [], balances: [], holidays: [], calendar: [], reports: [],
  templates: [], myTemplates: [],
});
type Key = keyof HRData;

/** Database table → collections to re-fetch when it changes. */
const TABLE_KEYS: Record<string, Key[]> = {
  employees: ['employees', 'directory', 'myTemplates'],
  departments: ['departments'],
  designations: ['designations', 'myTemplates'],
  shifts: ['shifts', 'attendance'],
  employee_salaries: ['salaries'],
  company_settings: ['settings'],
  attendance_sessions: ['attendance'],
  break_sessions: ['attendance', 'breaks'],
  attendance_corrections: ['corrections'],
  early_checkout_requests: ['earlyCheckouts'],
  leave_types: ['leaveTypes', 'balances'],
  leave_requests: ['leaveRequests', 'balances'],
  leave_ledger: ['balances'],
  holidays: ['holidays'],
  work_calendar: ['calendar'],
  daily_reports: ['reports'],
  report_templates: ['templates', 'myTemplates'],
};

/** How far back attendance and reports are kept in memory (older periods are loaded on demand). */
const HISTORY_DAYS = 120;

function useHRValue() {
  const { session, status, refresh } = useAuth();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [data, setData] = useState<HRData>(empty);
  const [ready, setReady] = useState(false);
  /** Server clock offset (ms) so live timers follow the server, not the device. */
  const [offset, setOffset] = useState(0);
  const internal = status === 'signed-in' && (session?.role === 'admin' || session?.role === 'staff') && !session.previewOf;
  const userId = internal ? session?.userId : undefined;

  const fetchers = useMemo(() => {
    if (!supabase) return null;
    const sb = supabase;
    const since = addDays(companyDate(), -HISTORY_DAYS);
    const f: Record<Key, () => PromiseLike<{ data: unknown; error: unknown }>> = {
      employees: () => sb.from('employees').select('*'),
      directory: () => sb.rpc('employee_directory'),
      departments: () => sb.from('departments').select('*').order('name'),
      designations: () => sb.from('designations').select('*').order('name'),
      shifts: () => sb.from('shifts').select('*').order('name'),
      salaries: () => sb.from('employee_salaries').select('*'),
      settings: () => sb.from('company_settings').select('key, value, label'),
      attendance: () => sb.from('attendance_days').select('*').gte('work_date', since).order('work_date', { ascending: false }).limit(5000),
      breaks: () => sb.from('break_sessions').select('*').gte('start_at', `${addDays(companyDate(), -2)}T00:00:00+05:30`).limit(2000),
      corrections: () => sb.from('attendance_corrections').select('*').order('created_at', { ascending: false }).limit(1000),
      earlyCheckouts: () => sb.from('early_checkout_requests').select('*').order('created_at', { ascending: false }).limit(1000),
      leaveTypes: () => sb.from('leave_types').select('*').order('name'),
      leaveRequests: () => sb.from('leave_requests').select('*').order('start_date', { ascending: false }).limit(2000),
      balances: () => sb.rpc('team_leave_balances'),
      holidays: () => sb.from('holidays').select('*').order('holiday_date'),
      calendar: () => sb.from('work_calendar').select('*').order('work_date'),
      reports: () => sb.from('daily_reports').select('*').gte('report_date', since).order('report_date', { ascending: false }).limit(5000),
      templates: () => sb.from('report_templates').select('*'),
      myTemplates: () => sb.rpc('my_report_templates'),
    };
    return f;
  }, []);

  const load = useCallback(
    async (only?: Key[]) => {
      if (!fetchers || !userId) return;
      const keys = only ?? (Object.keys(fetchers) as Key[]);
      const results = await Promise.all(keys.map((k) => fetchers[k]()));
      setData((d) => {
        const next = { ...d };
        keys.forEach((k, i) => {
          if (results[i].error) {
            console.warn('[hr] could not load', k);
            return;
          }
          (next as unknown as Record<string, unknown[]>)[k] = ((results[i].data ?? []) as Row[]).map((r) => fromRow(r));
        });
        return next;
      });
      setReady(true);
    },
    [fetchers, userId],
  );

  const syncClock = useCallback(async () => {
    if (!supabase || !userId) return;
    const t0 = Date.now();
    const { data: now } = await supabase.rpc('server_now');
    if (typeof now === 'string') setOffset(new Date(now).getTime() - (t0 + Date.now()) / 2);
  }, [userId]);

  const loadRef = useRef(load);
  loadRef.current = load;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!userId || !supabase) {
      setData(empty());
      setReady(false);
      return;
    }
    const sb = supabase;
    void load();
    void syncClock();
    const pending = new Set<Key>();
    let timer = 0;
    const queue = (keys: Key[]) => {
      keys.forEach((k) => pending.add(k));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const ks = [...pending];
        pending.clear();
        void loadRef.current(ks);
      }, 250);
    };
    const suffix = Math.random().toString(36).slice(2, 8);
    const channels = Object.entries(TABLE_KEYS).map(([table, keys]) => {
      const ch = sb.channel(`hr-${table}-${suffix}`);
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, (p: { new?: Row; old?: Row }) => {
        queue(keys);
        // My own designation / manager changed: re-resolve workspaces and navigation.
        if (table === 'employees' && ((p.new as Row | undefined)?.id === userId || (p.old as Row | undefined)?.id === userId)) {
          void refreshRef.current();
        }
      });
      ch.subscribe((s) => {
        if (s === 'SUBSCRIBED') queue(keys); // (re)connected: reconcile anything missed
      });
      return ch;
    });
    const resync = () => {
      if (document.visibilityState === 'visible') {
        void loadRef.current();
        void syncClock();
      }
    };
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('online', resync);
    const poll = window.setInterval(resync, 60_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('online', resync);
      channels.forEach((ch) => void sb.removeChannel(ch));
    };
  }, [userId, load, syncClock]);

  /**
   * Calls a database function. Shows the server's explanation on failure (policy limits,
   * locked reports…) and re-fetches the affected collections either way.
   */
  const call = useCallback(
    async <T = unknown,>(fn: string, args: Record<string, unknown>, opts: { refresh?: Key[]; success?: string; successDetail?: string; quiet?: boolean } = {}) => {
      if (!supabase) return { ok: false as const, error: 'Not configured' };
      const { data: res, error } = await supabase.rpc(fn, args);
      if (opts.refresh) void loadRef.current(opts.refresh);
      if (error) {
        const msg = serverMessage(error);
        if (!opts.quiet) toastRef.current.error('Not saved', msg);
        return { ok: false as const, error: msg };
      }
      if (opts.success) toastRef.current.success(opts.success, opts.successDetail);
      return { ok: true as const, data: res as T };
    },
    [],
  );

  /** Direct table write (HR configuration screens; RLS + triggers enforce who may do it). */
  const write = useCallback(
    async (table: string, op: 'insert' | 'update' | 'upsert' | 'delete', row: Row, match?: Row, opts: { refresh?: Key[]; success?: string } = {}) => {
      if (!supabase) return false;
      const q = supabase.from(table);
      const res =
        op === 'insert' ? await q.insert(row).select() :
        op === 'upsert' ? await q.upsert(row).select() :
        op === 'update' ? await q.update(row).match(match ?? {}).select() :
        await q.delete().match(match ?? {}).select();
      if (opts.refresh) void loadRef.current(opts.refresh);
      if (res.error || (op !== 'insert' && op !== 'upsert' && !(res.data ?? []).length)) {
        toastRef.current.error('Not saved', res.error ? serverMessage(res.error) : 'You do not have permission to change this.');
        return false;
      }
      if (opts.success) toastRef.current.success(opts.success);
      return true;
    },
    [],
  );

  const now = useCallback(() => new Date(Date.now() + offset), [offset]);
  const setting = useCallback(<T,>(key: string, fallback: T): T => {
    const s = data.settings.find((x) => x.key === key);
    return (s?.value ?? fallback) as T;
  }, [data.settings]);

  return { data, ready, load, call, write, now, setting, enabled: !!userId };
}

export type HRValue = ReturnType<typeof useHRValue>;
const HRContext = createContext<HRValue | null>(null);
export { HRContext };

export function HRProvider({ children }: { children: ReactNode }) {
  const value = useHRValue();
  return <HRContext.Provider value={value}>{children}</HRContext.Provider>;
}

export function useHR() {
  const v = useContext(HRContext);
  if (!v) throw new Error('useHR must be used inside HRProvider');
  return v;
}

/** Names and lookups for HR screens. */
export function useHRLookup() {
  const { data } = useHR();
  return useMemo(() => {
    const by = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
    return {
      person: by(data.directory),
      employee: by(data.employees),
      designation: by(data.designations),
      department: by(data.departments),
      shift: by(data.shifts),
      leaveType: by(data.leaveTypes),
      name: (id: string | null | undefined) => (id ? data.directory.find((d) => d.id === id)?.fullName ?? 'Unknown' : '—'),
    };
  }, [data.directory, data.employees, data.designations, data.departments, data.shifts, data.leaveTypes]);
}
