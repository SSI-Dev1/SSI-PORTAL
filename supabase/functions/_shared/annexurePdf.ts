// Annexure A (commission schedule) built from the proposal the agency accepted (0063).
//
// The Partnership Agreement template requires Annexure A. Before, staff had to upload it by hand for
// every registration; until they did, the agreement stayed "annexure_missing" and the partner never
// saw an agreement to download. The accepted proposal already holds the exact, partner-confirmed
// rates, so the annexure is produced from that snapshot: university, country, level / campus, intake,
// commission and conditions — values exactly as confirmed, nothing rounded or invented. Staff can still
// replace it with their own upload before the partner signs.
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'npm:pdf-lib@1.17.1';
import { encodable } from './agreementPdf.ts';
import { fmtRate, type ProposalArrangement } from './proposal.ts';

export interface AnnexureMeta { companyName: string; proposalReference: string; confirmedAt: string | null; confirmedBy: string | null; registrationReference: string }

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = encodable(font, text).split(' ').filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/** One row per university in the accepted proposal; throws EMPTY_ARRANGEMENT when there is none. */
export async function annexureFromProposal(arr: ProposalArrangement, m: AnnexureMeta): Promise<{ bytes: Uint8Array; pages: number }> {
  const rows = (arr?.universities ?? []).filter((u) => u && String(u.university ?? '').trim());
  if (!rows.length) throw new Error('EMPTY_ARRANGEMENT');
  const doc = await PDFDocument.create();
  doc.setTitle(`Annexure A — ${m.companyName}`);
  doc.setProducer('SSI GLOBAL');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 48;
  const cols = [
    { h: 'University', w: 150 }, { h: 'Country', w: 70 }, { h: 'Level / campus', w: 80 }, { h: 'Intake', w: 55 }, { h: 'Commission', w: 70 }, { h: 'Conditions', w: W - 2 * M - 425 },
  ];
  const size = 8.5, lh = 11;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const header = (first: boolean) => {
    if (first) {
      page.drawText('ANNEXURE A — COMMISSION SCHEDULE', { x: M, y, size: 14, font: bold, color: rgb(0.05, 0.1, 0.2) }); y -= 20;
      for (const line of [
        `Partner: ${m.companyName}`,
        `From partnership proposal ${m.proposalReference}${m.confirmedAt ? `, accepted on ${m.confirmedAt}` : ''}${m.confirmedBy ? ` by ${m.confirmedBy}` : ''}.`,
        'Rates exactly as stated in the accepted proposal. Commission is payable as set out in the Partnership Agreement.',
      ]) for (const l of wrap(line, font, 9.5, W - 2 * M)) { page.drawText(l, { x: M, y, size: 9.5, font, color: rgb(0.15, 0.15, 0.2) }); y -= 13; }
      y -= 8;
    }
    let x = M;
    page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 16, color: rgb(0.92, 0.94, 0.97) });
    for (const c of cols) { page.drawText(c.h, { x: x + 3, y, size: 8.5, font: bold }); x += c.w; }
    y -= 18;
  };
  header(true);
  for (const u of rows) {
    const cells = [
      String(u.university), String(u.country ?? ''), [u.study_level, u.variant].filter(Boolean).join(' · '), String(u.intake ?? ''),
      fmtRate(u.commission_kind, u.commission_value, u.currency), String(u.conditions ?? ''),
    ].map((t, i) => wrap(t || '—', font, size, cols[i].w - 6));
    const h = Math.max(...cells.map((c) => c.length)) * lh + 4;
    if (y - h < M + 20) { page = doc.addPage([W, H]); y = H - M; header(false); }
    let x = M;
    cells.forEach((lines, i) => { lines.forEach((l, k) => page.drawText(l, { x: x + 3, y: y - k * lh, size, font })); x += cols[i].w; });
    y -= h;
    page.drawLine({ start: { x: M, y: y + lh - 4 }, end: { x: W - M, y: y + lh - 4 }, thickness: 0.4, color: rgb(0.8, 0.82, 0.86) });
  }
  const pages = doc.getPages();
  pages.forEach((p, i) => p.drawText(encodable(font, `${m.registrationReference} · Annexure A · page ${i + 1} of ${pages.length}`), { x: M, y: 24, size: 7, font, color: rgb(0.45, 0.45, 0.5) }));
  return { bytes: await doc.save(), pages: pages.length };
}
