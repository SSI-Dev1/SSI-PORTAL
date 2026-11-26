// Student import (0061): reads the student sheet (Sl. No. · Student Name · passport number · Agent Name ·
// Priority Intake · Country · Priority · Request university · Request course · Program Intake · Application
// Portal · Application Submitted · Submission Date · Application Status · Pending documents · Offer Status ·
// Offer Status date · Current Status till offer · Current Status Date · payment · Payment status date ·
// Deferral Details · Visa Status · Visa Status date · Remarks) into one group per student.
//
// A row with a Student Name starts a student; a row with no name, Sl. No. or passport continues the previous
// student (another university choice). The same passport in two places is one student. Priority "1" is the
// primary choice, blank is another option — no 2 / 3 / 4 is invented. Values are kept as written; Excel date
// serials and day/month/year dates become dates, month-and-year intakes keep their text and month, and
// anything else stays text and is listed as a date issue. Only depends on fflate (runs in Node too).
import { readWorkbook, type Sheet } from './catalogueImport.ts';

export const STUDENT_COLUMNS = [
  'Sl. No.', 'Student Name', 'passport number', 'Agent Name', 'Priority Intake', 'Country', 'Priority', 'Request university',
  'Request course', 'Program Intake', 'Application Portal', 'Application Submitted', 'Submission Date', 'Application Status',
  'Pending documents', 'Offer Status', 'Offer Status date', 'Current Status till offer', 'Current Status Date', 'payment',
  'Payment status date', 'Deferral Details', 'Visa Status', 'Visa Status date', 'Remarks',
] as const;
type Col = typeof STUDENT_COLUMNS[number];

export interface ImportPref {
  key: string; source_row: number; priority: string | null; university: string; course: string | null;
  program_intake: string | null; program_intake_month: string | null; country: string | null; portal: string | null; submitted: string | null;
  submission_date: string | null; application_status: string | null; pending_documents: string | null; offer_status: string | null;
  offer_status_date: string | null; current_status: string | null; current_status_date: string | null; payment: string | null;
  payment_status_date: string | null; deferral: string | null; visa_status: string | null; visa_status_date: string | null; remarks: string | null;
  date_issues: string[]; source: Record<string, string>;
}
export interface ImportGroup {
  key: string; name: string; passport: string | null; agent: string | null; priority_intake: string | null; priority_intake_month: string | null;
  country: string | null; source_rows: number[]; flags: string[]; prefs: ImportPref[];
  /** Set when the student must not be imported until an administrator checks it (the server skips it). */
  review: string | null;
}
export interface StudentSheetParse {
  sheet: string; missingColumns: string[]; totalRows: number; groups: ImportGroup[]; problems: string[];
  stats: { preferences: number; multiUniversity: number; priorityConflicts: number; noPriority: number; dateIssues: number; missingCritical: number; mergedDuplicates: number };
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
// "--" is the sheet's way of writing "nothing yet": treated as blank (the cell is still kept in the source).
const val = (s: string | undefined) => { const v = (s ?? '').trim(); return v === '' || /^-+$/.test(v) ? null : v; };
export const textKey = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Excel serial (1900 date system) → yyyy-mm-dd, or null when it is not a plausible date. */
export function serialToDate(raw: string): string | null {
  const m = /^(\d{5})(?:\.0+)?$/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 36526 || n > 60000) return null;   // 2000-01-01 … 2064
  return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10);
}
/** dd/mm/yyyy (the sheet's convention) → yyyy-mm-dd; null if not a real date. */
export function dmyToDate(raw: string): string | null {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]), y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
/** "september 2026", "Sep-26", "Jan'27" → yyyy-mm-01. */
export function monthYear(raw: string): string | null {
  const m = /^([a-z]{3,9})[\s.\-']*'?(\d{2}|\d{4})$/i.exec(raw.trim());
  if (!m) return null;
  const i = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  if (i < 0) return null;
  const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return `${y}-${String(i + 1).padStart(2, '0')}-01`;
}
/** A passport number has letters and digits (6–12); "Applied", "NA", "--" and the like are not passports. */
export const passportOf = (raw: string | null) => {
  const p = (raw ?? '').replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{6,12}$/.test(p) && /\d/.test(p) ? p : null;
};
const intakeLabel = (iso: string) => `${LABEL[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** An event date: a serial or d/m/y becomes a date; anything else stays text and is reported. */
function eventDate(raw: string | null, col: string, issues: string[]): string | null {
  if (!raw) return null;
  const d = serialToDate(raw) ?? dmyToDate(raw);
  if (!d) issues.push(col);
  return d;
}
/** An intake: keeps the text (a serial becomes "Sep 2026") and the month when it is clear. */
function intake(raw: string | null, col: string, issues: string[]): { text: string | null; month: string | null } {
  if (!raw) return { text: null, month: null };
  const s = serialToDate(raw);
  if (s) return { text: intakeLabel(s), month: `${s.slice(0, 7)}-01` };
  const my = monthYear(raw);
  if (my) return { text: raw.trim(), month: my };
  const d = dmyToDate(raw);
  if (d) return { text: intakeLabel(d), month: `${d.slice(0, 7)}-01` };
  issues.push(col);
  return { text: raw.trim(), month: null };
}

export function parseStudentSheet(sheets: Sheet[]): StudentSheetParse {
  const problems: string[] = [];
  const sheet = sheets.find((s) => s.rows.some((r) => Object.values(r.cells).some((c) => norm(c) === 'student name'))) ?? sheets[0];
  if (!sheet) return { sheet: '', missingColumns: [...STUDENT_COLUMNS], totalRows: 0, groups: [], problems: ['The workbook is empty.'], stats: { preferences: 0, multiUniversity: 0, priorityConflicts: 0, noPriority: 0, dateIssues: 0, missingCritical: 0, mergedDuplicates: 0 } };
  const headIdx = sheet.rows.findIndex((r) => Object.values(r.cells).some((c) => norm(c) === 'student name'));
  const head = sheet.rows[Math.max(headIdx, 0)];
  const colOf = new Map<Col, string>();
  for (const [letter, text] of Object.entries(head.cells)) {
    const c = STUDENT_COLUMNS.find((k) => norm(k) === norm(text));
    if (c && !colOf.has(c)) colOf.set(c, letter);
  }
  const missingColumns = STUDENT_COLUMNS.filter((c) => !colOf.has(c));
  if (missingColumns.length) problems.push(`Columns not found: ${missingColumns.join(', ')}`);
  const get = (r: Sheet['rows'][number], c: Col) => val(colOf.has(c) ? r.cells[colOf.get(c)!] : undefined);
  const data = sheet.rows.slice(headIdx + 1).filter((r) => STUDENT_COLUMNS.some((c) => get(r, c)));

  // 1. Rows → groups in sheet order.
  type Raw = { start: number; rows: Sheet['rows'] };
  const raws: Raw[] = [];
  for (const r of data) {
    const starts = !!get(r, 'Student Name') || !!get(r, 'Sl. No.') || !!get(r, 'passport number');
    if (starts || !raws.length) raws.push({ start: r.r, rows: [r] });
    else raws[raws.length - 1].rows.push(r);
  }
  // 2. One student per passport + name (or name + agent when there is no valid passport). The same passport
  //    under two different names is never merged: both are held for review.
  const byKey = new Map<string, ImportGroup>();
  const passportNames = new Map<string, Set<string>>();
  for (const raw of raws) {
    const p = passportOf(get(raw.rows[0], 'passport number'));
    if (p) { const set = passportNames.get(p) ?? new Set<string>(); set.add(textKey(get(raw.rows[0], 'Student Name'))); passportNames.set(p, set); }
  }
  let dateIssues = 0;
  for (const raw of raws) {
    const first = raw.rows[0];
    const name = (get(first, 'Student Name') ?? '').replace(/\s+/g, ' ');
    const passportRaw = get(first, 'passport number');
    const passport = passportOf(passportRaw);
    const agent = get(first, 'Agent Name');
    const key = passport ? `p:${passport}|${textKey(name)}` : `n:${textKey(name)}|${textKey(agent)}`;
    const issues: string[] = [];
    const pi = intake(get(first, 'Priority Intake'), 'Priority Intake', issues);
    let g = byKey.get(key);
    if (!g) {
      g = { key, name, passport, agent, priority_intake: pi.text, priority_intake_month: pi.month, country: get(first, 'Country'), source_rows: [], flags: [], prefs: [], review: null };
      byKey.set(key, g);
      if (!name) { g.flags.push('Student name missing'); g.review = 'Student name missing'; }
      if (!passport) g.flags.push(passportRaw ? `No passport number (sheet says “${passportRaw}”) — matched by name and agent` : 'No passport number — matched by name and agent');
      if (!agent) g.flags.push('Agent name missing');
      if (passport && (passportNames.get(passport)?.size ?? 0) > 1) {
        g.review = 'The same passport number is given for another student with a different name — check which is correct';
        g.flags.push(g.review);
      }
    } else {
      g.flags.push(`Appears again from row ${raw.start} (same passport and name) — merged into one student`);
      if (textKey(g.agent) !== textKey(agent) && agent) g.flags.push(`Different agent at row ${raw.start}: ${agent}`);
    }
    if (issues.length) { g.flags.push(`Priority Intake kept as text at row ${raw.start}`); dateIssues += 1; }
    for (const r of raw.rows) {
      g.source_rows.push(r.r);
      const di: string[] = [];
      const pIntake = intake(get(r, 'Program Intake'), 'Program Intake', di);
      const source: Record<string, string> = { row: String(r.r) };
      for (const c of STUDENT_COLUMNS) { const v = colOf.has(c) ? (r.cells[colOf.get(c)!] ?? '').trim() : ''; if (v && c !== 'passport number') source[c] = v; }
      const university = get(r, 'Request university');
      if (!university) { g.flags.push(`Row ${r.r}: no university — kept for review`); }
      const base = [key, textKey(university), textKey(get(r, 'Request course')), textKey(get(r, 'Program Intake'))].join('|');
      const n = g.prefs.filter((p) => p.key.startsWith(`${base}#`)).length;
      const pref: ImportPref = {
        key: `${base}#${n + 1}`, source_row: r.r, priority: get(r, 'Priority')?.replace(/\.0+$/, '') ?? null, university: university ?? '(not given)',
        course: get(r, 'Request course'), program_intake: pIntake.text, program_intake_month: pIntake.month, country: get(r, 'Country'),
        portal: get(r, 'Application Portal'), submitted: get(r, 'Application Submitted'),
        submission_date: eventDate(get(r, 'Submission Date'), 'Submission Date', di), application_status: get(r, 'Application Status'),
        pending_documents: get(r, 'Pending documents'), offer_status: get(r, 'Offer Status'),
        offer_status_date: eventDate(get(r, 'Offer Status date'), 'Offer Status date', di), current_status: get(r, 'Current Status till offer'),
        current_status_date: eventDate(get(r, 'Current Status Date'), 'Current Status Date', di), payment: get(r, 'payment'),
        payment_status_date: eventDate(get(r, 'Payment status date'), 'Payment status date', di), deferral: get(r, 'Deferral Details'),
        visa_status: get(r, 'Visa Status'), visa_status_date: eventDate(get(r, 'Visa Status date'), 'Visa Status date', di), remarks: get(r, 'Remarks'),
        date_issues: di, source,
      };
      dateIssues += di.length;
      g.prefs.push(pref);
    }
  }
  const groups = [...byKey.values()];
  const isP1 = (p: ImportPref) => /^1$/.test(p.priority ?? '');
  for (const g of groups) {
    const p1 = g.prefs.filter(isP1).length;
    if (p1 > 1) g.flags.push(`Priority conflict — ${p1} rows marked Priority 1 (rows ${g.prefs.filter(isP1).map((p) => p.source_row).join(', ')}): review required`);
    if (p1 === 0) g.flags.push('No Priority 1 row — no primary university until one is chosen');
  }
  return {
    sheet: sheet.name, missingColumns, totalRows: data.length, groups, problems,
    stats: {
      preferences: groups.reduce((n, g) => n + g.prefs.length, 0),
      multiUniversity: groups.filter((g) => g.prefs.length > 1).length,
      priorityConflicts: groups.filter((g) => g.prefs.filter(isP1).length > 1).length,
      noPriority: groups.filter((g) => !g.prefs.some(isP1)).length,
      dateIssues,
      missingCritical: groups.filter((g) => !g.name || !g.agent || g.prefs.some((p) => p.university === '(not given)')).length,
      mergedDuplicates: raws.length - groups.length,
    },
  };
}

export function readStudentWorkbook(bytes: Uint8Array): StudentSheetParse {
  return parseStudentSheet(readWorkbook(bytes));
}
