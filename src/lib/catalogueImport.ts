// Course catalogue import: reads an .xlsx workbook, recognises its layout, turns it into a
// catalogue payload for the database function public.import_catalogue(), and computes a
// preview (new / changed / unchanged / duplicate / invalid) against the current catalogue.
//
// Used by the Admin "Import from Excel" dialog and by scripts/catalogue-sql.ts (which
// generated the initial import migration), so both apply exactly the same rules.
// Only depends on fflate, so it also runs in Node (no DOM APIs).
//
// Supported layouts:
//  1. Partner toolkit (e.g. "Oxford Direct Toolkit FY27"): sheets "Entry Requirement & Dates",
//     "Fees & Scholarships", "CAS Deposit Requirement", "<ABBR> - Course List",
//     "Blacklisted Universities".
//  2. Flat sheet: one row per course (or course + intake) with a header row containing at
//     least "University", "Course" and "Tuition".
// Nothing is invented: blank, "NA" and "TBC" cells stay empty (TBC is noted on the intake).
import { strFromU8, unzipSync } from 'fflate';

// ------------------------------------------------------------------ payload types

export interface IntakeInput {
  month: number;
  year: number;
  induction_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  application_deadline?: string | null;
  enrolment_deadline?: string | null;
  status?: 'Available' | 'Upcoming' | 'Closed';
  notes?: string | null;
}

export interface CourseInput {
  university: string;
  name: string;
  level: string;
  category?: string | null;
  faculty?: string | null;
  duration?: string | null;
  tuition?: number | null;
  currency?: string | null;
  ielts_min?: number | null;
  scholarship?: string | null;
  tuition_after_scholarship?: number | null;
  early_bird?: string | null;
  accommodation?: string | null;
  academic_requirement?: string | null;
  english_requirement?: string | null;
  compliance_requirement?: string | null;
  course_requirement?: string | null;
  documents_required?: string | null;
  intakes: IntakeInput[];
}

export interface UniversityInput {
  name: string;
  country: string;
  city?: string | null;
  cas_deposit?: string | null;
  payment_plan?: string | null;
  moi_accepted?: string[];
  notes?: string | null;
}

export interface CataloguePayload {
  source: string;
  universities: UniversityInput[];
  courses: CourseInput[];
  blacklist: string[];
}

export interface ParseResult {
  payload: CataloguePayload;
  layout: 'toolkit' | 'flat';
  /** Rows or values that could not be used, with the reason. */
  invalid: { where: string; reason: string }[];
  /** Values that were derived rather than read directly (shown to the admin). */
  notes: string[];
}

// ------------------------------------------------------------------ xlsx reading

export interface Sheet {
  name: string;
  rows: { r: number; cells: Record<string, string> }[];
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/** Max upload size accepted by the import dialog. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export function readWorkbook(bytes: Uint8Array): Sheet[] {
  // xlsx files are zip archives starting with "PK".
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('This is not an .xlsx file.');
  const files = unzipSync(bytes, { filter: (f) => f.name.startsWith('xl/') && f.name.endsWith('.xml') || f.name.endsWith('.rels') });
  const read = (p: string) => (files[p] ? strFromU8(files[p]) : '');
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const rels = Object.fromEntries([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const sheets: Sheet[] = [];
  for (const m of read('xl/workbook.xml').matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = decode(attr(m[0], 'name') ?? '');
    let target = rels[attr(m[0], 'r:id') ?? ''] ?? '';
    target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const xml = read(target);
    const rows: Sheet['rows'] = [];
    for (const row of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const cells: Record<string, string> = {};
      for (const c of row[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1], 'r') ?? '';
        const col = ref.replace(/\d+/g, '');
        const t = attr(c[1], 't');
        const inner = c[2] ?? '';
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val = '';
        if (t === 's' && v != null) val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = texts(inner);
        else if (v != null) val = decode(v);
        val = val.replace(/\r\n?/g, '\n').trim();
        if (val) cells[col] = val;
      }
      if (Object.keys(cells).length) rows.push({ r: Number(attr(row[1], 'r') ?? rows.length + 1), cells });
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

// ------------------------------------------------------------------ value helpers

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const empty = (s: string | undefined | null) => !s || /^(na|n\/a|none|-|tbc|tba)$/i.test(s.trim());
const clean = (s: string | undefined | null) => (empty(s) ? null : s!.trim());

/** Excel serial day → ISO date (1900 date system). */
export function serialToIso(n: number) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** All dates in a cell ("18th Jan 2027", "25 January 2028", "2027-01-25", "25/01/2027", serial). */
export function findDates(text: string): { date: string; index: number; end: number }[] {
  const out: { date: string; index: number; end: number }[] = [];
  const t = text.trim();
  if (/^\d{5}(\.\d+)?$/.test(t)) return [{ date: serialToIso(Number(t)), index: 0, end: t.length }];
  for (const m of t.matchAll(/(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})/g)) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) out.push({ date: iso(Number(m[3]), mi + 1, Number(m[1])), index: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  for (const m of t.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) out.push({ date: m[0], index: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  for (const m of t.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g)) out.push({ date: iso(Number(m[3]), Number(m[2]), Number(m[1])), index: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  return out.sort((a, b) => a.index - b.index);
}

/** Picks the date for a course from a cell that may list several, e.g. "25 Jan 2028 (MSC) 28 Apr 2028 (MBA)". */
function dateFor(cell: string | undefined, courseName: string): { date: string | null; note: string | null } {
  if (!cell || empty(cell)) return { date: null, note: cell && /tbc|tba/i.test(cell) ? 'TBC' : null };
  const dates = findDates(cell);
  if (!dates.length) return { date: null, note: cell.trim() };
  if (dates.length === 1) {
    const rest = (cell.slice(0, dates[0].index) + cell.slice(dates[0].end)).replace(/[()\n]/g, ' ').trim();
    return { date: dates[0].date, note: rest || null };
  }
  const name = courseName.toLowerCase();
  for (let i = 0; i < dates.length; i++) {
    const tag = cell.slice(dates[i].end, dates[i + 1]?.index ?? cell.length).match(/\(([^)]+)\)/)?.[1]?.toLowerCase();
    if (tag && tag.split(/[\s/,]+/).some((w) => w && new RegExp(`\\b${w}\\b`).test(name))) return { date: dates[i].date, note: null };
  }
  return { date: null, note: `Several dates listed: ${cell.replace(/\n/g, ' ')}` };
}

export function parseMoney(s: string | undefined | null): { amount: number | null; currency: string | null } {
  if (!s || empty(s)) return { amount: null, currency: null };
  const cur = /£|gbp/i.test(s) ? 'GBP' : /€|eur/i.test(s) ? 'EUR' : /a\$|aud/i.test(s) ? 'AUD' : /c\$|cad/i.test(s) ? 'CAD' : /\$|usd/i.test(s) ? 'USD' : /nz\$|nzd/i.test(s) ? 'NZD' : null;
  const n = s.replace(/[^\d.]/g, '');
  return { amount: n ? Number(n) : null, currency: cur };
}

const percent = (s: string) => (/^0?\.\d+$|^1(\.0+)?$/.test(s.trim()) ? `${Math.round(Number(s) * 100)}%` : s.trim());

export function levelOf(s: string | undefined | null): string | null {
  const t = norm(s);
  if (!t) return null;
  if (/foundation/.test(t)) return 'Foundation';
  if (/diploma/.test(t)) return 'Diploma';
  if (/phd|doctor/.test(t)) return 'PhD';
  if (/post\s*grad|master|\bpg\b|msc|mba|\bma\b|mph/.test(t)) return 'Postgraduate';
  if (/under\s*grad|bachelor|\bug\b|\bba\b|bsc|degree/.test(t)) return 'Undergraduate';
  return null;
}

const levelFromCourseName = (name: string) => {
  const n = name.toLowerCase();
  if (/^(msc|ma|mba|mph|mres|llm|pgdip|pgcert|master)\b|master of/.test(n)) return 'Postgraduate';
  if (/^(ba|bsc|beng|llb|bba|bachelor)\b|\(hons\)/.test(n)) return 'Undergraduate';
  return null;
};

/** IELTS overall from an English-requirement text ("IELTS - 6.0 (5.5)"). */
const ieltsOf = (s: string | null) => {
  const m = s?.match(/ielts[^\d]{0,10}(\d(?:\.\d)?)/i);
  return m ? Number(m[1]) : null;
};

const monthsBetween = (a: string, b: string) => {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round(((y2 - y1) * 12 + (m2 - m1) + (d2 - d1) / 30) * 1) || null;
};

const typos: [RegExp, string][] = [[/\bunviersity\b/gi, 'University'], [/\buniveristy\b/gi, 'University'], [/\buniversty\b/gi, 'University']];
const fixTypos = (s: string) => typos.reduce((x, [re, to]) => x.replace(re, to), s.trim().replace(/\s+/g, ' '));

function lev(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** "University of Winchester" → "uow", "Lincoln Bishop University" → "lbu". */
const initials = (name: string) =>
  name
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((w) => (/^(of|and|the)$/i.test(w) ? w[0].toLowerCase() : w[0].toUpperCase()))
    .join('')
    .toLowerCase();

// ------------------------------------------------------------------ toolkit layout

interface Block {
  title: string | null;
  header: Record<string, string>; // column → header text
  rows: Record<string, string>[];
}

/** Splits a sheet into blocks: [optional title row] header row, data rows… (blank row ends a block). */
function blocks(sheet: Sheet, isHeader: (cells: Record<string, string>) => boolean): Block[] {
  const out: Block[] = [];
  let cur: Block | null = null;
  let title: string | null = null;
  let lastR = 0;
  sheet.rows.forEach(({ r, cells }, idx) => {
    if (r > lastR + 1 && cur) {
      out.push(cur);
      cur = null;
      title = null;
    }
    lastR = r;
    const keys = Object.keys(cells);
    // A lone cell directly above a header row is the next block's title, even without a gap.
    const next = sheet.rows[idx + 1];
    if (keys.length === 1 && next && isHeader(next.cells)) {
      if (cur) out.push(cur);
      cur = null;
      title = cells[keys[0]];
      return;
    }
    if (isHeader(cells)) {
      if (cur) out.push(cur);
      cur = { title, header: cells, rows: [] };
      title = null;
    } else if (!cur && keys.length === 1) title = cells[keys[0]];
    else if (cur) cur.rows.push(cells);
  });
  if (cur) out.push(cur);
  return out;
}

const col = (b: Block, re: RegExp) => Object.entries(b.header).find(([, h]) => re.test(h))?.[0];

function parseToolkit(sheets: Sheet[], source: string): ParseResult {
  const invalid: ParseResult['invalid'] = [];
  const notes: string[] = [];
  const byName = (re: RegExp) => sheets.find((s) => re.test(s.name));

  // ---- universities from the entry sheet ("Name, City")
  const entrySheet = byName(/entry\s*requirement/i);
  const feeSheet = byName(/fee/i);
  const casSheet = byName(/cas\s*deposit/i);
  const blackSheet = byName(/blacklist/i);
  const listSheets = sheets.filter((s) => /course\s*list/i.test(s.name));

  const unis = new Map<string, UniversityInput & { abbr: string }>();
  const canonical: string[] = [];
  for (const b of feeSheet ? blocks(feeSheet, (c) => Object.values(c).some((v) => /tuition/i.test(v))) : []) if (b.title) canonical.push(fixTypos(b.title));
  for (const b of casSheet ? blocks(casSheet, (c) => Object.values(c).some((v) => /cas deposit/i.test(v))) : []) if (b.title) canonical.push(fixTypos(b.title));

  const resolveUni = (raw: string) => {
    const fixed = fixTypos(raw);
    const [namePart, ...rest] = fixed.split(',');
    const near = canonical.find((c) => norm(c) === norm(namePart)) ?? canonical.find((c) => lev(norm(c), norm(namePart)) <= 3);
    const name = near ?? namePart.trim();
    if (!unis.has(norm(name))) {
      unis.set(norm(name), { name, country: '', city: rest.join(',').trim() || null, moi_accepted: [], abbr: initials(name) });
    } else if (rest.length && !unis.get(norm(name))!.city) unis.get(norm(name))!.city = rest.join(',').trim();
    if (fixed !== raw.trim()) notes.push(`Corrected spelling "${raw.trim()}" → "${fixed}".`);
    return unis.get(norm(name))!;
  };

  type Entry = { academic: string | null; english: string | null; compliance: string | null; cells: Record<string, string>; block: Block };
  const entries = new Map<string, Entry>(); // `${uni}|${level}`
  let defaultIntake: { month: number; year: number } | null = null;
  if (entrySheet) {
    const first = entrySheet.rows[0];
    const v = first && Object.values(first.cells)[0];
    if (v && /^\d{5}$/.test(v)) {
      const d = serialToIso(Number(v));
      defaultIntake = { year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)) };
    }
    for (const b of blocks(entrySheet, (c) => Object.values(c).some((x) => /^university$/i.test(x)) && Object.values(c).some((x) => /^course$/i.test(x)))) {
      const uc = col(b, /^university$/i)!;
      const lc = col(b, /^course$/i)!;
      for (const row of b.rows) {
        if (!row[uc]) continue;
        const u = resolveUni(row[uc]);
        const level = levelOf(row[lc]);
        if (!level) {
          invalid.push({ where: `${entrySheet.name}: ${row[uc]}`, reason: `Unknown study level "${row[lc] ?? ''}"` });
          continue;
        }
        entries.set(`${norm(u.name)}|${level}`, {
          academic: clean(row[col(b, /academic/i) ?? '']),
          english: clean(row[col(b, /english/i) ?? '']),
          compliance: clean(row[col(b, /compliance/i) ?? '']),
          cells: row,
          block: b,
        });
      }
    }
  }

  // ---- fees per university block
  type Fee = { label: string; tuition: string | null; scholarship: string | null; after: string | null; early: string | null; accommodation: string | null };
  const fees = new Map<string, Fee[]>();
  if (feeSheet) {
    for (const b of blocks(feeSheet, (c) => Object.values(c).some((v) => /tuition/i.test(v)))) {
      if (!b.title) continue;
      const u = resolveUni(b.title);
      const lc = col(b, /^course$/i) ?? Object.keys(b.header)[0];
      const tc = col(b, /^tuition fee(?!.*after)/i);
      const sc = col(b, /scholarship/i);
      const ac = col(b, /after\s*scholarship/i);
      const ec = col(b, /early\s*bird/i);
      const hc = col(b, /accom+odation/i);
      const scHeader = sc ? b.header[sc] : '';
      fees.set(
        norm(u.name),
        b.rows.filter((r) => r[lc]).map((r) => ({
          label: r[lc],
          tuition: tc ? r[tc] ?? null : null,
          scholarship: sc && !empty(r[sc]) ? (/^scholarship$/i.test(scHeader.trim()) ? r[sc] : `${scHeader.trim()}: ${r[sc]}`) : null,
          after: ac ? r[ac] ?? null : null,
          early: ec ? clean(r[ec]) : null,
          accommodation: hc ? clean(r[hc]) : null,
        })),
      );
    }
  }
  const feeFor = (uniKey: string, course: string, level: string) => {
    const list = fees.get(uniKey) ?? [];
    const exact = list.find((f) => norm(f.label) === norm(course));
    if (exact) return exact;
    const n = course.toLowerCase();
    const qualified = list.filter((f) => levelOf(f.label) === level && /\(([^)]+)\)/.test(f.label));
    const q = qualified.find((f) => {
      const tag = f.label.match(/\(([^)]+)\)/)![1].toLowerCase();
      return tag === 'mba' ? /\bmba\b|master of business administration/.test(n) : new RegExp(`\\b${tag}\\b`).test(n);
    });
    return q ?? list.find((f) => levelOf(f.label) === level && !/\(/.test(f.label)) ?? null;
  };

  // ---- CAS deposit per university
  if (casSheet) {
    for (const b of blocks(casSheet, (c) => Object.values(c).some((v) => /cas deposit/i.test(v)))) {
      if (!b.title || !b.rows[0]) continue;
      const u = resolveUni(b.title);
      const parts: string[] = [];
      for (const [c, h] of Object.entries(b.header)) {
        const v = b.rows[0][c];
        if (!v || empty(v)) continue;
        if (/instal+ment|payment plan/i.test(h)) u.payment_plan = v;
        else parts.push(`${h.trim()}: ${percent(v)}`);
      }
      if (parts.length) u.cas_deposit = parts.join(' · ');
    }
  }

  // ---- courses from "<ABBR> - Course List" sheets
  const courses: CourseInput[] = [];
  for (const s of listSheets) {
    const abbr = s.name.split(/\s*-\s*/)[0].trim().toLowerCase();
    const u = [...unis.values()].find((x) => x.abbr === abbr);
    if (!u) {
      invalid.push({ where: s.name, reason: `Cannot match "${abbr.toUpperCase()}" to a university in the entry or fees sheets` });
      continue;
    }
    let titleCol: string | undefined;
    let header: Record<string, string> = {};
    let category: string | null = null;
    // The accepted-MOI list runs down its own column next to the course table(s); every
    // value in that column (except its title/header) is a list entry, even on header rows.
    const isMoiHead = (v: string) => /moi accepted|university name/i.test(v);
    const moiCol = s.rows.flatMap(({ cells }) => Object.entries(cells)).find(([, v]) => isMoiHead(v))?.[0];
    for (const { cells } of s.rows) {
      if (moiCol && cells[moiCol] && !isMoiHead(cells[moiCol])) u.moi_accepted!.push(cells[moiCol]);
      const isHead = Object.entries(cells).some(([c, v]) => c !== moiCol && /^course( instance title)?$/i.test(v));
      if (isHead) {
        header = Object.fromEntries(Object.entries(cells).filter(([c]) => c !== moiCol));
        titleCol = Object.entries(header).find(([, v]) => /^course( instance title)?$/i.test(v))![0];
        category = null;
        continue;
      }
      if (!titleCol || !cells[titleCol]) continue;
      const name = cells[titleCol].trim();
      const catCol = Object.entries(header).find(([, h]) => /^category$/i.test(h))?.[0];
      if (catCol && cells[catCol] && !/^\d+$/.test(cells[catCol])) category = cells[catCol];
      const facCol = Object.entries(header).find(([, h]) => /^faculty$/i.test(h))?.[0];
      const level = levelOf(category) ?? levelFromCourseName(name) ?? ([...entries.keys()].filter((k) => k.startsWith(`${norm(u.name)}|`)).length === 1 ? [...entries.keys()].find((k) => k.startsWith(`${norm(u.name)}|`))!.split('|')[1] : null);
      if (!level) {
        invalid.push({ where: `${s.name}: ${name}`, reason: 'Cannot tell the study level' });
        continue;
      }
      const docs: string[] = [];
      let requirement: string | null = null;
      for (const [c, h] of Object.entries(header)) {
        if (c === titleCol || /^category$|^faculty$|moi accepted|university name/i.test(h)) continue;
        const v = cells[c];
        if (!v || empty(v)) continue;
        if (/^required$/i.test(v)) docs.push(h.trim());
        else if (/requirement|remark/i.test(h)) requirement = v;
        else docs.push(`${h.trim()}: ${v}`);
      }
      const entry = entries.get(`${norm(u.name)}|${level}`);
      const fee = feeFor(norm(u.name), name, level);
      const tuition = parseMoney(fee?.tuition);
      if (!fee) invalid.push({ where: `${s.name}: ${name}`, reason: 'No tuition fee found in the fees sheet (imported without fee only if the course already exists)' });
      const ic = (re: RegExp) => (entry ? entry.cells[col(entry.block, re) ?? ''] : undefined);
      const start = dateFor(ic(/start date/i), name);
      const end = dateFor(ic(/end date/i), name);
      const induction = dateFor(ic(/induction/i), name);
      const cas = dateFor(ic(/cas deadline|application deadline|deadline/i), name);
      const enrol = dateFor(ic(/enrol/i), name);
      const intakeNotes = [
        induction.note && `Induction: ${induction.note}`,
        start.note && `Start: ${start.note}`,
        end.note && `End: ${end.note}`,
        cas.note && `CAS deadline: ${cas.note}`,
        enrol.note && `Enrolment deadline: ${enrol.note}`,
      ].filter(Boolean);
      const when = start.date ? { year: Number(start.date.slice(0, 4)), month: Number(start.date.slice(5, 7)) } : defaultIntake;
      const intakes: IntakeInput[] = [];
      if (when) {
        const today = new Date().toISOString().slice(0, 10);
        intakes.push({
          ...when,
          induction_date: induction.date,
          start_date: start.date,
          end_date: end.date,
          application_deadline: cas.date,
          enrolment_deadline: enrol.date,
          status: start.date && start.date < today ? 'Closed' : 'Available',
          notes: intakeNotes.length ? intakeNotes.join(' · ') : null,
        });
      } else invalid.push({ where: `${s.name}: ${name}`, reason: 'No intake date found' });
      const months = start.date && end.date ? monthsBetween(start.date, end.date) : null;
      courses.push({
        university: u.name,
        name,
        level,
        category: facCol && cells[facCol] ? cells[facCol] : null,
        faculty: facCol && cells[facCol] ? cells[facCol] : null,
        duration: months ? `${months} months` : null,
        tuition: tuition.amount,
        currency: tuition.currency,
        ielts_min: ieltsOf(entry?.english ?? null),
        scholarship: fee?.scholarship ?? null,
        tuition_after_scholarship: parseMoney(fee?.after).amount,
        early_bird: fee?.early ?? null,
        accommodation: fee?.accommodation ?? null,
        academic_requirement: entry?.academic ?? null,
        english_requirement: entry?.english ?? null,
        compliance_requirement: entry?.compliance ?? null,
        course_requirement: requirement,
        documents_required: docs.length ? docs.join(' · ') : null,
        intakes,
      });
    }
  }

  // ---- country: the toolkit does not state it; derive from fees currency (£ → UK).
  for (const u of unis.values()) {
    const cur = courses.find((c) => c.university === u.name && c.currency)?.currency;
    if (cur === 'GBP') {
      u.country = 'United Kingdom';
      notes.push(`${u.name}: country set to United Kingdom (fees in £; CAS process) — not stated in the file.`);
    } else invalid.push({ where: u.name, reason: 'Country is not in the file and could not be derived' });
  }
  if (courses.some((c) => c.duration)) notes.push('Course duration is calculated from the course start and end dates in the file.');
  if (courses.some((c) => c.ielts_min)) notes.push('Minimum IELTS is read from the English requirement text.');

  const blacklist = blackSheet ? blackSheet.rows.slice(1).map((r) => Object.values(r.cells)[0]).filter((v): v is string => !!v && !/^blacklisted/i.test(v)) : [];

  return {
    layout: 'toolkit',
    payload: {
      source,
      universities: [...unis.values()].map(({ abbr: _abbr, ...u }) => ({ ...u, moi_accepted: [...new Set(u.moi_accepted)] })),
      courses,
      blacklist,
    },
    invalid,
    notes: [...new Set(notes)],
  };
}

// ------------------------------------------------------------------ flat layout

function parseFlat(sheets: Sheet[], source: string): ParseResult | null {
  for (const s of sheets) {
    const hi = s.rows.findIndex(({ cells }) => {
      const v = Object.values(cells).map((x) => x.toLowerCase());
      return v.some((x) => /^university|provider/.test(x)) && v.some((x) => /^course/.test(x)) && v.some((x) => /tuition|fee/.test(x));
    });
    if (hi < 0) continue;
    const h = s.rows[hi].cells;
    const c = (re: RegExp) => Object.entries(h).find(([, v]) => re.test(v.toLowerCase()))?.[0];
    const map = {
      uni: c(/^university|^provider/), country: c(/^country/), city: c(/city|location|campus/), course: c(/^course( name| title)?$/),
      level: c(/level/), category: c(/category|field|subject|faculty/), duration: c(/duration/), tuition: c(/tuition|fee/),
      currency: c(/currency/), intake: c(/^intake/), start: c(/start/), deadline: c(/deadline/), academic: c(/academic|entry req/),
      english: c(/english|ielts/), status: c(/status/),
    };
    const invalid: ParseResult['invalid'] = [];
    const unis = new Map<string, UniversityInput>();
    const courses = new Map<string, CourseInput>();
    for (const { r, cells } of s.rows.slice(hi + 1)) {
      const get = (k: keyof typeof map) => (map[k] ? cells[map[k]!] : undefined);
      const uniName = clean(get('uni'));
      const name = clean(get('course'));
      if (!uniName && !name) continue;
      if (!uniName || !name) {
        invalid.push({ where: `${s.name} row ${r}`, reason: 'University and course name are required' });
        continue;
      }
      const level = levelOf(get('level')) ?? levelFromCourseName(name);
      if (!level) {
        invalid.push({ where: `${s.name} row ${r}`, reason: `Unknown study level "${get('level') ?? ''}"` });
        continue;
      }
      const u = unis.get(norm(uniName)) ?? { name: fixTypos(uniName), country: clean(get('country')) ?? '', city: clean(get('city')), moi_accepted: [] };
      if (!u.country && clean(get('country'))) u.country = clean(get('country'))!;
      unis.set(norm(uniName), u);
      const money = parseMoney(get('tuition'));
      const key = `${norm(uniName)}|${norm(name)}`;
      const course = courses.get(key) ?? {
        university: u.name, name, level, category: clean(get('category')), duration: clean(get('duration')),
        tuition: money.amount, currency: clean(get('currency')) ?? money.currency, academic_requirement: clean(get('academic')),
        english_requirement: clean(get('english')), ielts_min: ieltsOf(clean(get('english'))), intakes: [],
      };
      const intakeCell = get('intake') ?? get('start');
      for (const piece of (intakeCell ?? '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)) {
        const d = findDates(piece)[0]?.date;
        const m = piece.match(/([A-Za-z]{3,9})\.?\s+(\d{4})/);
        const month = d ? Number(d.slice(5, 7)) : m ? MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1 : 0;
        const year = d ? Number(d.slice(0, 4)) : m ? Number(m[2]) : 0;
        if (!month || !year) {
          invalid.push({ where: `${s.name} row ${r}`, reason: `Cannot read intake "${piece}"` });
          continue;
        }
        const st = clean(get('status'));
        course.intakes.push({
          month, year, start_date: d ?? null, application_deadline: findDates(get('deadline') ?? '')[0]?.date ?? null,
          status: st && /closed/i.test(st) ? 'Closed' : st && /upcoming/i.test(st) ? 'Upcoming' : 'Available',
        });
      }
      courses.set(key, course);
    }
    for (const u of unis.values()) if (!u.country) invalid.push({ where: u.name, reason: 'Country is required' });
    return { layout: 'flat', payload: { source, universities: [...unis.values()], courses: [...courses.values()], blacklist: [] }, invalid, notes: [] };
  }
  return null;
}

/** Recognises the workbook layout and converts it. */
export function parseCatalogue(sheets: Sheet[], source: string): ParseResult {
  if (sheets.some((s) => /entry\s*requirement/i.test(s.name)) && sheets.some((s) => /course\s*list/i.test(s.name))) return parseToolkit(sheets, source);
  const flat = parseFlat(sheets, source);
  if (flat) return flat;
  throw new Error('Unrecognised spreadsheet layout. Use the partner toolkit format or a sheet with "University", "Course" and "Tuition" columns.');
}

// ------------------------------------------------------------------ preview

export interface CurrentCatalogue {
  universities: { id: string; name: string; country: string; city?: string | null; casDeposit?: string | null; paymentPlan?: string | null; moiAccepted?: string[] | null; notes?: string | null }[];
  courses: (Record<string, unknown> & { id: string; universityId: string; name: string })[];
  intakes: { id: string; courseId: string; intakeMonth: number; intakeYear: number; startDate?: string | null; applicationDeadline?: string | null; endDate?: string | null; inductionDate?: string | null; enrolmentDeadline?: string | null; notes?: string | null }[];
  blacklist: { name: string }[];
}

export interface PreviewItem {
  key: string;
  label: string;
  sub?: string;
  changes?: { field: string; from: unknown; to: unknown }[];
}

export interface Preview {
  newUniversities: PreviewItem[];
  updatedUniversities: PreviewItem[];
  newCourses: PreviewItem[];
  updatedCourses: PreviewItem[];
  unchangedCourses: number;
  newIntakes: PreviewItem[];
  changedIntakes: PreviewItem[];
  duplicates: PreviewItem[];
  invalid: { where: string; reason: string }[];
  newBlacklist: number;
}

const COURSE_FIELDS: [keyof CourseInput, string, string][] = [
  ['level', 'level', 'Level'], ['category', 'field', 'Category'], ['faculty', 'faculty', 'Faculty'], ['duration', 'duration', 'Duration'],
  ['tuition', 'tuition', 'Tuition'], ['currency', 'currency', 'Currency'], ['ielts_min', 'ieltsMin', 'Min. IELTS'], ['scholarship', 'scholarship', 'Scholarship'],
  ['tuition_after_scholarship', 'tuitionAfterScholarship', 'Tuition after scholarship'], ['early_bird', 'earlyBird', 'Early bird'],
  ['accommodation', 'accommodation', 'Accommodation'], ['academic_requirement', 'academicRequirement', 'Academic requirement'],
  ['english_requirement', 'englishRequirement', 'English requirement'], ['compliance_requirement', 'complianceRequirement', 'Compliance'],
  ['course_requirement', 'courseRequirement', 'Course requirement'], ['documents_required', 'documentsRequired', 'Documents required'],
];

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || (typeof a === 'number' && Number(b) === a) || norm(String(a ?? '')) === norm(String(b ?? ''));

/** What applying the payload would change. `overwrite=false` mirrors "only fill empty fields". */
export function previewImport(parsed: ParseResult, current: CurrentCatalogue, overwrite: boolean): Preview {
  const p: Preview = { newUniversities: [], updatedUniversities: [], newCourses: [], updatedCourses: [], unchangedCourses: 0, newIntakes: [], changedIntakes: [], duplicates: [], invalid: [...parsed.invalid], newBlacklist: 0 };
  const uniByName = new Map(current.universities.map((u) => [norm(u.name), u]));
  for (const u of parsed.payload.universities) {
    const cur = uniByName.get(norm(u.name));
    if (!cur) {
      p.newUniversities.push({ key: u.name, label: u.name, sub: [u.city, u.country].filter(Boolean).join(', ') });
      continue;
    }
    const changes: PreviewItem['changes'] = [];
    const cmp = (field: string, from: unknown, to: unknown) => {
      if (to == null || (Array.isArray(to) && !to.length)) return;
      if (!overwrite && from != null && from !== '' && !(Array.isArray(from) && !from.length)) return;
      if (Array.isArray(to) ? JSON.stringify(from ?? []) !== JSON.stringify(to) : !same(from, to)) changes.push({ field, from, to });
    };
    cmp('City', cur.city, u.city);
    cmp('CAS deposit', cur.casDeposit, u.cas_deposit);
    cmp('Payment plan', cur.paymentPlan, u.payment_plan);
    cmp('MOI accepted list', cur.moiAccepted, u.moi_accepted);
    if (changes.length) p.updatedUniversities.push({ key: u.name, label: u.name, changes });
  }

  const seen = new Set<string>();
  for (const c of parsed.payload.courses) {
    const key = `${norm(c.university)}|${norm(c.name)}`;
    if (seen.has(key)) {
      p.duplicates.push({ key, label: c.name, sub: c.university });
      continue;
    }
    seen.add(key);
    const uni = uniByName.get(norm(c.university));
    const cur = uni ? (current.courses as Record<string, unknown>[]).find((x) => x.universityId === uni.id && norm(String(x.name)) === norm(c.name)) : undefined;
    if (!cur) {
      if (c.tuition == null) {
        p.invalid.push({ where: `${c.university}: ${c.name}`, reason: 'New course without a tuition fee' });
        continue;
      }
      p.newCourses.push({ key, label: c.name, sub: `${c.university} · ${c.level}${c.tuition != null ? ` · ${c.currency ?? ''} ${c.tuition.toLocaleString()}` : ''}` });
      for (const i of c.intakes) p.newIntakes.push({ key: `${key}|${i.year}-${i.month}`, label: `${MONTHS[i.month - 1].replace(/^./, (x) => x.toUpperCase())} ${i.year}`, sub: c.name });
      continue;
    }
    const changes: PreviewItem['changes'] = [];
    for (const [k, curKey, label] of COURSE_FIELDS) {
      const to = c[k];
      const from = cur[curKey];
      if (to == null) continue;
      if (!overwrite && from != null && from !== '' && k !== 'level') continue;
      if (!overwrite && (k === 'level' || k === 'tuition' || k === 'currency')) continue;
      if (!same(from, to)) changes.push({ field: label, from, to });
    }
    if (changes.length) p.updatedCourses.push({ key, label: c.name, sub: c.university, changes });
    else p.unchangedCourses++;
    for (const i of c.intakes) {
      const ci = current.intakes.find((x) => x.courseId === cur.id && x.intakeYear === i.year && x.intakeMonth === i.month);
      const label = `${MONTHS[i.month - 1].replace(/^./, (x) => x.toUpperCase())} ${i.year}`;
      if (!ci) {
        p.newIntakes.push({ key: `${key}|${i.year}-${i.month}`, label, sub: c.name });
        continue;
      }
      const ch: PreviewItem['changes'] = [];
      const cmp = (field: string, from: unknown, to: unknown) => {
        if (to == null || (!overwrite && from != null)) return;
        if (!same(from, to)) ch.push({ field, from, to });
      };
      cmp('Start date', ci.startDate, i.start_date);
      cmp('End date', ci.endDate, i.end_date);
      cmp('Induction', ci.inductionDate, i.induction_date);
      cmp('Application deadline', ci.applicationDeadline, i.application_deadline);
      cmp('Enrolment deadline', ci.enrolmentDeadline, i.enrolment_deadline);
      if (ch.length) p.changedIntakes.push({ key: `${key}|${i.year}-${i.month}`, label, sub: c.name, changes: ch });
    }
  }
  const black = new Set(current.blacklist.map((b) => norm(b.name)));
  p.newBlacklist = parsed.payload.blacklist.filter((b) => !black.has(norm(b))).length;
  return p;
}
