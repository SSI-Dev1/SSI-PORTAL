// Agency list import: reads an .xlsx sheet of agencies (e.g. Agent Name · POC · Number · Email ·
// status) into rows for preview_agency_import / import_agencies (0035). Values are kept as written;
// nothing is invented. Phone numbers stay text: a number Excel stored as a numeric cell (shown as
// 9.876543210E9) is expanded exactly, digit for digit — but a leading 0 or + that Excel already
// dropped cannot be recovered, so it is not guessed. Only depends on fflate (runs in Node too).
import { readWorkbook, type Sheet } from './catalogueImport.ts';

export interface AgencyRow { row: number; name: string | null; poc: string | null; phone: string | null; email: string | null; status: string | null; phoneFromNumber?: boolean }
export interface AgencyParse { sheet: string; headers: Record<string, string>; rows: AgencyRow[]; problems: string[] }

const FIELDS: [keyof Omit<AgencyRow, 'row' | 'phoneFromNumber'>, RegExp][] = [
  ['name', /^(agent|agency|company|partner|organi[sz]ation)( name)?$|^name$/],
  ['poc', /^(poc|contact|contact person|contact name|point of contact)$/],
  ['phone', /^(number|phone|phone number|mobile|contact number|whatsapp)$/],
  ['email', /^(email|e-mail|email address|mail)$/],
  ['status', /^(bpq|status|stage|partnership status)$/],
];
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const clean = (s: string | undefined) => { const v = (s ?? '').trim(); return v && !/^(na|n\/a|-|none|nil)$/i.test(v) ? v : null; };

/** "9.876543210E9" → "9876543210" exactly (string arithmetic, no floating point). */
export function expandNumber(raw: string): string | null {
  const m = /^(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/.exec(raw.trim());
  if (m) {
    const [, int, frac = '', exp] = m;
    const e = Number(exp);
    if (frac.length > e) return null;   // not a whole number — leave it as written
    return (int + frac + '0'.repeat(e - frac.length)).replace(/^0+(?=\d)/, '');
  }
  const d = /^(\d+)\.0+$/.exec(raw.trim());
  return d ? d[1] : null;
}

export function parseAgencySheet(sheets: Sheet[]): AgencyParse {
  for (const s of sheets) {
    const head = s.rows.find((r) => Object.values(r.cells).some((v) => FIELDS[0][1].test(norm(v))));
    if (!head) continue;
    const cols: Partial<Record<string, string>> = {};
    const headers: Record<string, string> = {};
    for (const [col, text] of Object.entries(head.cells)) {
      const f = FIELDS.find(([, re]) => re.test(norm(text)));
      if (f && !cols[f[0]]) { cols[f[0]] = col; headers[f[0]] = text; }
    }
    const problems: string[] = [];
    if (!cols.status) problems.push('No status column found (bpq / status) — rows will be imported as New prospect.');
    const rows: AgencyRow[] = [];
    for (const r of s.rows) {
      if (r.r <= head.r) continue;
      const get = (k: string) => (cols[k] ? clean(r.cells[cols[k]!]) : null);
      const rawPhone = get('phone');
      const expanded = rawPhone ? expandNumber(rawPhone) : null;
      const row: AgencyRow = { row: r.r, name: get('name'), poc: get('poc'), phone: expanded ?? rawPhone, email: get('email'), status: get('status') };
      if (expanded) row.phoneFromNumber = true;
      if (!row.name && !row.poc && !row.phone && !row.email && !row.status) continue;
      rows.push(row);
    }
    return { sheet: s.name, headers, rows, problems };
  }
  throw new Error('No sheet with an agency name column (e.g. "Agent Name") was found.');
}

export const parseAgencyWorkbook = (bytes: Uint8Array) => parseAgencySheet(readWorkbook(bytes));

/** Display label for the original status text ("Proposal send" → "Proposal Sent"). */
export function statusLabel(raw: string | null): string {
  const n = norm(raw ?? '');
  if (n === 'onboarded' || n === 'on boarded') return 'Onboarded';
  if (n === 'proposal send' || n === 'proposal sent') return 'Proposal Sent';
  if (n === 'mou send' || n === 'mou sent') return 'MOU Sent';
  if (n === 'closed') return 'Closed';
  if (n === 'inactive') return 'Inactive';
  return raw ? `${raw} (not recognised)` : 'New prospect';
}
