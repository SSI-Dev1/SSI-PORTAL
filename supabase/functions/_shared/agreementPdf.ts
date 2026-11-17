// Partnership Agreement PDFs (partner-registration function).
//
// fillAgreement: the approved template with the Partner's particulars filled in. Only the placeholder
// areas listed in the template's layout are changed — every clause, page and the SSI signatory block
// stay exactly as approved. The Partner paragraph is redrawn with the template's exact wording and the
// values inserted (shrunk to fit its original area), the SSI signature date is left blank until SSI
// countersigns, and Annexure A pages are appended when supplied. Each page carries a small reference
// line (registration, template version, page n of N) so a signed copy can be matched to its version.
//
// inspectPdf: checks an uploaded PDF before it is accepted (real PDF, not encrypted, no scripts,
// launch actions or embedded files, page count).
import { PDFDict, PDFDocument, PDFName, PDFStream, StandardFonts, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1';

export interface Particulars {
  companyName: string;
  countryState: string;
  address: string;
  representativeName: string;
  representativeDesignation: string;
  /** ISO date (YYYY-MM-DD) of the agreement. */
  agreementDate: string;
  reference: string;
  templateLabel: string;
}

/** Placeholder areas of a known template, in PDF points (origin bottom-left). */
export interface AgreementLayout {
  id: string;
  pages: number;
  dateBox: { page: number; x: number; y: number; w: number; h: number };
  partnerParagraph: { page: number; x: number; y: number; w: number; h: number; size: number; leading: number };
  ssiDateBox: { page: number; x: number; y: number; w: number; h: number };
  partnerBlock: { page: number; signatory: [number, number]; company: [number, number]; designation: [number, number]; right: number };
}

// "MEMORANDUM OF UNDERSTANDING / STRATEGIC RECRUITMENT PARTNER AGREEMENT" — Domestic, 13 pages
// (measured from the supplied PDF). A different template needs its own measured layout.
export const LAYOUTS: Record<string, AgreementLayout> = {
  ssi_domestic_v1: {
    id: 'ssi_domestic_v1',
    pages: 13,
    dateBox: { page: 0, x: 205, y: 552, w: 123, h: 19 },
    partnerParagraph: { page: 0, x: 51, y: 262, w: 492, h: 101, size: 11.2, leading: 19.9 },
    ssiDateBox: { page: 12, x: 80.5, y: 289, w: 75, h: 18 },
    partnerBlock: { page: 12, signatory: [174, 194.2], company: [145, 176.6], designation: [124, 159.6], right: 540 },
  },
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');

/** Text the standard PDF fonts can draw (anything else becomes "?"), on one line. */
export function encodable(font: PDFFont, s: string): string {
  let out = '';
  for (const ch of String(s ?? '').replace(/\s+/g, ' ').trim()) {
    try { font.encodeText(ch); out += ch; } catch { out += '?'; }
  }
  return out;
}

type Run = { text: string; bold: boolean };

/** Word-wraps runs of normal / bold text into lines no wider than `width`. */
export function wrapRuns(runs: Run[], fonts: { normal: PDFFont; bold: PDFFont }, size: number, width: number): Run[][] {
  const words: Run[] = [];
  for (const r of runs) for (const w of r.text.split(/(?<=\s)/)) if (w) words.push({ text: w, bold: r.bold });
  const lines: Run[][] = [];
  let line: Run[] = [];
  let lw = 0;
  const wOf = (r: Run) => (r.bold ? fonts.bold : fonts.normal).widthOfTextAtSize(r.text, size);
  for (const w of words) {
    const ww = wOf({ text: w.text.trimEnd(), bold: w.bold });
    if (line.length && lw + ww > width) { lines.push(line); line = []; lw = 0; }
    line.push(w);
    lw += wOf(w);
  }
  if (line.length) lines.push(line);
  return lines;
}

function whiteOut(page: PDFPage, b: { x: number; y: number; w: number; h: number }) {
  page.drawRectangle({ x: b.x, y: b.y, width: b.w, height: b.h, color: rgb(1, 1, 1) });
}

function drawFitted(page: PDFPage, font: PDFFont, text: string, x: number, y: number, maxWidth: number, size = 11.2, min = 6.5) {
  let s = size;
  while (s > min && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.25;
  page.drawText(text, { x, y, size: s, font, color: rgb(0.08, 0.08, 0.08) });
}

export async function fillAgreement(template: Uint8Array, p: Particulars, layoutId: string, annexure?: Uint8Array | null): Promise<{ bytes: Uint8Array; pages: number }> {
  const layout = LAYOUTS[layoutId];
  if (!layout) throw new Error('LAYOUT_UNKNOWN');
  const doc = await PDFDocument.load(template);
  if (doc.getPageCount() !== layout.pages) throw new Error('TEMPLATE_LAYOUT_MISMATCH');
  const normal = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const small = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  // Effective date: "<d><th> day of <Month> <yyyy>"
  const [yy, mm, dd] = p.agreementDate.split('-').map(Number);
  if (!yy || !mm || !dd) throw new Error('DATE_INVALID');
  {
    const b = layout.dateBox;
    const pg = pages[b.page];
    whiteOut(pg, b);
    drawFitted(pg, normal, `${dd}${ordinal(dd)} day of ${MONTHS[mm - 1]} ${yy}`, b.x + 2, b.y + 4, b.w - 4);
  }

  // Partner paragraph: the template's exact words, with the particulars in bold.
  {
    const b = layout.partnerParagraph;
    const pg = pages[b.page];
    const v = (s: string) => encodable(bold, s);
    const runs: Run[] = [
      { text: v(p.companyName.toUpperCase()), bold: true },
      { text: ', a company/firm duly organized and existing under the applicable laws of ', bold: false },
      { text: v(p.countryState), bold: true },
      { text: ', having its principal office at ', bold: false },
      { text: v(p.address), bold: true },
      { text: ', represented herein by ', bold: false },
      { text: v(`${p.representativeName}, ${p.representativeDesignation}`), bold: true },
      { text: ' (hereinafter referred to as the “Partner” or party “B”), which expression shall unless repugnant to the context or meaning thereof include its successors, legal representatives, and permitted assigns.', bold: false },
    ];
    let size = b.size;
    let leading = b.leading;
    let lines = wrapRuns(runs, { normal, bold }, size, b.w);
    while (lines.length * leading > b.h && size > 7) {
      size -= 0.25;
      leading = size * (b.leading / b.size);
      lines = wrapRuns(runs, { normal, bold }, size, b.w);
    }
    if (lines.length * leading > b.h) throw new Error('PARTICULARS_TOO_LONG');
    whiteOut(pg, b);
    let y = b.y + b.h - size - 2;
    for (const line of lines) {
      let x = b.x + 1;
      line.forEach((r, i) => {
        const t = i === line.length - 1 ? r.text.trimEnd() : r.text;
        const f = r.bold ? bold : normal;
        pg.drawText(t, { x, y, size, font: f, color: rgb(0.08, 0.08, 0.08) });
        x += f.widthOfTextAtSize(t, size);
      });
      y -= leading;
    }
  }

  // SSI signature date: blank until SSI countersigns (the template's historical date is removed).
  whiteOut(pages[layout.ssiDateBox.page], layout.ssiDateBox);

  // Partner signature block: name, company and designation (the date is left for the signer).
  {
    const b = layout.partnerBlock;
    const pg = pages[b.page];
    drawFitted(pg, normal, encodable(normal, p.representativeName), b.signatory[0], b.signatory[1], b.right - b.signatory[0]);
    drawFitted(pg, normal, encodable(normal, p.companyName), b.company[0], b.company[1], b.right - b.company[0]);
    drawFitted(pg, normal, encodable(normal, p.representativeDesignation), b.designation[0], b.designation[1], b.right - b.designation[0]);
  }

  if (annexure) {
    const ann = await PDFDocument.load(annexure);
    const copied = await doc.copyPages(ann, ann.getPageIndices());
    copied.forEach((pg) => doc.addPage(pg));
  }

  const total = doc.getPageCount();
  doc.getPages().forEach((pg, i) => {
    pg.drawText(encodable(small, `${p.reference} · ${p.templateLabel} · page ${i + 1} of ${total}`), { x: 52, y: 47, size: 6.5, font: small, color: rgb(0.45, 0.5, 0.52) });
  });
  doc.setTitle(`SSI GLOBAL Partnership Agreement — ${encodable(small, p.companyName)}`);
  doc.setProducer('SSI GLOBAL Portal');
  doc.setCreationDate(new Date());
  return { bytes: await doc.save(), pages: total };
}

/** Problems with an uploaded PDF; empty when it can be accepted. */
export async function inspectPdf(bytes: Uint8Array): Promise<{ problems: string[]; pages: number }> {
  if (bytes.length < 8 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') return { problems: ['This is not a PDF file.'], pages: 0 };
  const problems: string[] = [];
  const active = 'The PDF contains scripts, attachments or interactive content. Save it as a plain PDF (Print → Save as PDF) and upload again.';
  if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)\b/.test(new TextDecoder('latin1').decode(bytes))) problems.push(active);
  let pages = 0;
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    pages = doc.getPageCount();
    if (pages === 0) problems.push('The PDF has no pages.');
    // Objects inside compressed object streams are only visible once parsed.
    const risky = ['JavaScript', 'JS', 'Launch', 'EmbeddedFile', 'EmbeddedFiles', 'RichMedia', 'XFA'].map((n) => PDFName.of(n));
    const isRisky = (d: PDFDict) => risky.some((k) => d.has(k)) || d.get(PDFName.of('S')) === PDFName.of('JavaScript') || d.get(PDFName.of('S')) === PDFName.of('Launch');
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
      if (dict && isRisky(dict)) { if (!problems.includes(active)) problems.push(active); break; }
    }
  } catch (e) {
    problems.push(String(e).includes('encrypted') ? 'The PDF is password-protected. Upload a copy without a password.' : 'The PDF could not be read. It may be damaged — scan or save it again.');
  }
  return { problems, pages };
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
