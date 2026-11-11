// Commission sheet import: turns the rows of the commission workbook into records for
// preview_commission_import / apply_commission_import (0029). Nothing is invented: every value
// keeps its original text, numbers are parsed only when the cell is unambiguous, and anything
// unclear (no currency for an amount, a bare number like "15", "%%" typos, two portals in one
// cell) is flagged for review. The full row is kept with its original column headers.
import type { Sheet } from './catalogueImport';

export interface ParsedValue {
  raw: string;
  kind: 'percent' | 'amount' | 'unclear';
  /** Exact decimal string: percent (20 = 20%) or amount. Null when unclear. */
  value: string | null;
  currency: string | null;
  note: string | null;
  needsReview: boolean;
}

export interface CommissionRow {
  source_key: string;
  source_row_number: number;
  university_name: string;
  intake: string | null;
  study_level: string | null;
  variant: string | null;
  student_market: string | null;
  route: 'direct' | 'portal';
  provider_label: string | null;
  currency: string | null;
  conditions: string | null;
  needs_review: boolean;
  review_notes: string | null;
  tiers: { tier_id: 'tier_1' | 'tier_2' | 'tier_3'; raw_value: string; value_kind: ParsedValue['kind']; value: string | null; currency: string | null; note: string | null; needs_review: boolean }[];
  internal: { received_raw: string | null; received_kind: ParsedValue['kind'] | null; received_value: string | null; margin_raw: string | null; margin_kind: ParsedValue['kind'] | null; margin_value: string | null };
  source_row: Record<string, string>;
}

export interface CommissionParse {
  sheet: string;
  headers: { column: string; header: string; role: string }[];
  rows: CommissionRow[];
  errors: string[];
}

const CURRENCIES: [RegExp, string][] = [[/£|\bGBP\b/i, 'GBP'], [/\bUSD\b|US\$/i, 'USD'], [/€|\bEUR\b/i, 'EUR'], [/\bCAD\b/i, 'CAD'], [/\bAUD\b/i, 'AUD'], [/\bNZD\b/i, 'NZD'], [/₹|\bINR\b/i, 'INR']];
export const currencyIn = (s: string) => CURRENCIES.find(([re]) => re.test(s))?.[1] ?? null;

/** "0.175" → "17.5" without floating point. */
export function times100(dec: string): string {
  const neg = dec.startsWith('-');
  const [i, f = ''] = dec.replace('-', '').split('.');
  const frac = (f + '00').slice(0, Math.max(2, f.length));
  const whole = (i + frac.slice(0, 2)).replace(/^0+(?=\d)/, '');
  const rest = frac.slice(2).replace(/0+$/, '');
  return (neg ? '-' : '') + whole + (rest ? `.${rest}` : '');
}

const cleanNum = (s: string) => s.replace(/,/g, '');
const trimZeros = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);

/** Parses one commission cell. Bare numbers ≤ 1 are spreadsheet percentages (0.2 = 20%). */
export function parseValue(rawIn: string | undefined | null, rowCurrency: string | null = null): ParsedValue {
  const raw = (rawIn ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return { raw: '', kind: 'unclear', value: null, currency: null, note: null, needsReview: false };
  const notes: string[] = [];
  let review = false;
  const s = raw.replace(/^(UG|PG)\s*-\s*/i, '').replace(/^FIXED\s+/i, '').trim();
  if (/^-?\d+(\.\d+)?$/.test(cleanNum(s))) {
    const n = cleanNum(s);
    const num = Number(n);
    if (num <= 1) return { raw, kind: 'percent', value: trimZeros(times100(n)), currency: null, note: null, needsReview: false };
    if (num >= 100) return { raw, kind: 'amount', value: trimZeros(n), currency: rowCurrency, note: rowCurrency ? null : 'Currency not stated', needsReview: !rowCurrency };
    return { raw, kind: 'unclear', value: null, currency: null, note: 'A plain number — check whether this is a percentage or an amount', needsReview: true };
  }
  const pct = s.match(/(-?\d+(?:\.\d+)?)\s*%+/);
  if (pct) {
    if (/%%/.test(s)) { notes.push('Written as "%%" in the sheet'); review = true; }
    const extra = s.replace(pct[0], '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (extra) notes.push(extra);
    return { raw, kind: 'percent', value: trimZeros(pct[1]), currency: null, note: notes.join(' · ') || null, needsReview: review };
  }
  // An amount needs its currency right next to the first number ("4000 GBP", "£500").
  const first = cleanNum(s).match(/-?\d+(?:\.\d+)?/);
  const amt = cleanNum(s).match(/^(?:[£€₹]\s*)?(-?\d+(?:\.\d+)?)\s*(GBP|USD|EUR|CAD|AUD|NZD|INR)?\b/i);
  const cur = amt && (/^[£€₹]/.test(cleanNum(s)) || amt[2]) ? currencyIn(amt[0]) : null;
  if (amt && cur) {
    const extra = cleanNum(s).slice(amt[0].length).replace(/^[\s/,;-]+/, '').trim();
    return { raw, kind: 'amount', value: trimZeros(amt[1]), currency: cur, note: extra || null, needsReview: false };
  }
  if (first && Number(first[0]) >= 100 && rowCurrency === null && !currencyIn(s)) {
    return { raw, kind: 'amount', value: trimZeros(first[0]), currency: null, note: 'Currency not stated', needsReview: true };
  }
  return { raw, kind: 'unclear', value: null, currency: null, note: 'Could not read a rate or amount', needsReview: true };
}

const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

type Role = 'university' | 'market' | 'received' | 'portal' | 'tier_1' | 'margin' | 'tier_2' | 'tier_3' | 'other';
function roleOf(header: string, col: string): Role {
  const h = norm(header);
  if (/tier\s*1\b/.test(h)) return 'tier_1';
  if (/tier\s*2\b/.test(h)) return 'tier_2';
  if (/tier\s*3\b/.test(h)) return 'tier_3';
  if (/profit|margin/.test(h)) return 'margin';
  if (/what we get|we get|received|gross|our commission(?!.*tier)/.test(h)) return 'received';
  if (/portal|provider|route|through|via/.test(h)) return 'portal';
  if (/universit|institution/.test(h)) return 'university';
  if (/country|market|nationality|region/.test(h)) return 'market';
  if (!h && col === 'A') return 'university';
  if (!h && col === 'B') return 'market';
  return 'other';
}

/** Reads the first worksheet that has commission tier columns. */
export function parseCommissionSheet(sheets: Sheet[], countryName: string): CommissionParse {
  const errors: string[] = [];
  const sheet = sheets.find((s) => s.rows.some((r) => Object.values(r.cells).some((v) => /tier\s*[123]/i.test(v)))) ?? sheets[0];
  if (!sheet) return { sheet: '', headers: [], rows: [], errors: ['The workbook has no worksheets.'] };
  const headerRow = sheet.rows.find((r) => Object.values(r.cells).some((v) => /tier\s*[123]/i.test(v)));
  if (!headerRow) return { sheet: sheet.name, headers: [], rows: [], errors: ['No header row with Tier 1 / Tier 2 / Tier 3 columns was found.'] };
  const cols = [...new Set(sheet.rows.flatMap((r) => Object.keys(r.cells)))].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const headers = cols.map((c) => {
    const header = headerRow.cells[c] ?? '';
    return { column: c, header: header || `(column ${c})`, role: roleOf(header, c) as string };
  });
  const col = (role: Role) => headers.find((h) => h.role === role)?.column;
  for (const need of ['university', 'portal', 'tier_1', 'tier_2', 'tier_3'] as Role[]) {
    if (!col(need)) errors.push(`Column not found: ${need.replace('_', ' ')}.`);
  }
  if (errors.length) return { sheet: sheet.name, headers, rows: [], errors };
  const rows: CommissionRow[] = [];
  for (const r of sheet.rows) {
    if (r.r <= headerRow.r) continue;
    const get = (role: Role) => { const c = col(role); return c ? (r.cells[c] ?? '').trim() : ''; };
    const uniCell = get('university');
    if (!uniCell) continue;
    const [uniLine, ...rest] = uniCell.split('\n').map((x) => x.trim()).filter(Boolean);
    const portalRaw = get('portal').replace(/\s+/g, ' ');
    const level = portalRaw.match(/^(UG|PG)\s*-\s*/i)?.[1]?.toUpperCase() ?? get('received').match(/^(UG|PG)\s*-\s*/i)?.[1]?.toUpperCase() ?? null;
    const providerText = portalRaw.replace(/^(UG|PG)\s*-\s*/i, '').trim();
    const direct = /^direct\b/i.test(providerText);
    const variant = get('received').match(/^([A-Za-z][A-Za-z .&'-]*?)\s*-\s*\d/)?.[1]?.trim();
    const realVariant = variant && !/^(UG|PG)$/i.test(variant) ? variant : null;
    const rowText = Object.values(r.cells).join(' ');
    const currency = currencyIn(rowText);
    const reasons: string[] = [];
    if (!providerText) reasons.push('Portal / route not stated');
    if (/[/,&]| and /i.test(providerText) && !direct) reasons.push('More than one portal in one cell');
    const tiers = (['tier_1', 'tier_2', 'tier_3'] as const).map((t) => {
      const v = parseValue(get(t), currency);
      if (v.needsReview) reasons.push(`${t.replace('tier_', 'Tier ')}: ${v.note ?? 'check value'}`);
      return { tier_id: t, raw_value: v.raw, value_kind: v.kind, value: v.value, currency: v.kind === 'amount' ? v.currency : null, note: v.note, needs_review: v.needsReview };
    });
    const rec = parseValue(get('received'), currency);
    const mar = parseValue(get('margin'), currency);
    // In the sheet, Tier 1 + profit = what SSI GLOBAL receives; flag rows where that does not hold.
    const t1 = tiers[0];
    if (rec.kind === t1.value_kind && mar.kind === t1.value_kind && rec.value && mar.value && t1.value
        && Math.round((Number(t1.value) + Number(mar.value)) * 10000) !== Math.round(Number(rec.value) * 10000)) {
      reasons.push('Tier 1 + profit does not equal the commission received');
    }
    const sourceRow: Record<string, string> = {};
    for (const h of headers) if (r.cells[h.column] !== undefined) sourceRow[h.header] = r.cells[h.column];
    rows.push({
      source_key: `sheet:${slug(countryName)}|${norm(uniLine)}|${norm(portalRaw)}|${norm(realVariant)}`,
      source_row_number: r.r,
      university_name: uniLine,
      intake: rest.join(' ') || null,
      study_level: level,
      variant: realVariant,
      student_market: get('market') || null,
      route: direct ? 'direct' : 'portal',
      provider_label: direct ? null : providerText || null,
      currency,
      conditions: null, // bonus terms in the sheet belong to SSI GLOBAL's own agreement and stay internal
      needs_review: reasons.length > 0,
      review_notes: reasons.length ? [...new Set(reasons)].join('; ') : null,
      tiers,
      internal: {
        received_raw: rec.raw || null, received_kind: rec.raw ? rec.kind : null, received_value: rec.value,
        margin_raw: mar.raw || null, margin_kind: mar.raw ? mar.kind : null, margin_value: mar.value,
      },
      source_row: sourceRow,
    });
  }
  if (!rows.length) errors.push('No commission rows were found under the header row.');
  return { sheet: sheet.name, headers, rows, errors };
}
