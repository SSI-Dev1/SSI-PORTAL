// Daily Work Report PDF: a real A4 PDF file built in the browser with pdf-lib (loaded only when a
// report is downloaded) from the same ReportView the report screen shows — so the screen and the
// PDF always carry the same figures, timeline, pending work and summary. Works the same on Windows,
// macOS, Linux, Android and iOS (a file download, not the print dialog).
import type { ReportView } from './dailyReport';

const NAVY = [6, 36, 47] as const;
const ORANGE = [251, 165, 30] as const;
const RUST = [185, 74, 18] as const;
const INK = [29, 47, 54] as const;
const MUTE = [108, 127, 134] as const;
const LINE = [227, 233, 235] as const;

const timeIST = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
const dateTimeIST = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const longDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function reportFileName(v: ReportView) {
  const who = v.employee.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'Employee';
  return `SSI-GLOBAL-Daily-Work-Report-${who}-${v.date}.pdf`;
}

export async function buildReportPdf(v: ReportView, logoUrl?: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(`SSI GLOBAL Daily Work Report — ${v.employee} — ${v.date}`);
  doc.setAuthor('SSI GLOBAL');
  doc.setCreator('SSI GLOBAL Portal');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const c = (x: readonly number[]) => rgb(x[0] / 255, x[1] / 255, x[2] / 255);
  let logo: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
  if (logoUrl) {
    try { logo = await doc.embedPng(await (await fetch(logoUrl)).arrayBuffer()); } catch { logo = null; }
  }

  const W = 595.28, H = 841.89, M = 42, BOTTOM = 56;
  const CW = W - M * 2;
  // Standard fonts cover Western European text; anything else is shown as "?" rather than breaking.
  const safe = (s: string) => Array.from(String(s ?? '')).map((ch) => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
  const wrap = (s: string, f: typeof font, size: number, width: number): string[] => {
    const out: string[] = [];
    for (const raw of String(s ?? '').replace(/\r\n?/g, '\n').split('\n')) {
      const para = safe(raw.replace(/\t/g, ' '));
      let line = '';
      for (const word of para.split(/\s+/)) {
        if (!word) continue;
        const next = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
        if (line) out.push(line);
        if (f.widthOfTextAtSize(word, size) <= width) { line = word; continue; }
        // a single word longer than the line: break it
        let part = '';
        for (const ch of word) { if (f.widthOfTextAtSize(part + ch, size) > width) { out.push(part); part = ''; } part += ch; }
        line = part;
      }
      out.push(line);
    }
    return out.length ? out : [''];
  };

  let page = doc.addPage([W, H]);
  let y = H;
  const newPage = () => {
    page = doc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: c(NAVY) });
    page.drawText(safe(`Daily Work Report · ${v.employee} · ${longDate(v.date)}`), { x: M, y: H - 28, size: 8, font, color: c(MUTE) });
    y = H - 44;
  };
  const need = (h: number) => { if (y - h < BOTTOM) newPage(); };
  const text = (s: string, x: number, size: number, f = font, color: readonly number[] = INK) => page.drawText(safe(s), { x, y, size, font: f, color: c(color) });

  // ---------------------------------------------------------------- header band
  page.drawRectangle({ x: 0, y: H - 92, width: W, height: 92, color: c(NAVY) });
  page.drawRectangle({ x: 0, y: H - 96, width: W, height: 4, color: c(ORANGE) });
  if (logo) page.drawImage(logo, { x: M, y: H - 70, width: 40, height: 40 });
  page.drawText('SSI', { x: M + (logo ? 50 : 0), y: H - 46, size: 15, font: bold, color: rgb(1, 1, 1) });
  page.drawText('GLOBAL', { x: M + (logo ? 50 : 0), y: H - 63, size: 12, font, color: rgb(1, 1, 1) });
  const title = 'Daily Work Report';
  page.drawText(title, { x: W - M - bold.widthOfTextAtSize(title, 18), y: H - 48, size: 18, font: bold, color: rgb(1, 1, 1) });
  const sub = safe(v.templateName);
  page.drawText(sub, { x: W - M - font.widthOfTextAtSize(sub, 9), y: H - 64, size: 9, font, color: rgb(0.73, 0.79, 0.82) });
  y = H - 120;

  // ---------------------------------------------------------------- employee information
  const info: [string, string][] = [['Employee', v.employee], ['Designation', v.designation], ['Department', v.department ?? '—'], ['Reporting date', longDate(v.date)]];
  const colW = CW / 4;
  info.forEach(([k, val], i) => {
    const x = M + i * colW;
    page.drawText(k.toUpperCase(), { x, y, size: 7, font: bold, color: c(MUTE) });
    wrap(val, bold, 9.5, colW - 10).slice(0, 2).forEach((l, j) => page.drawText(l, { x, y: y - 13 - j * 11, size: 9.5, font: bold, color: c(INK) }));
  });
  y -= 44;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: c(LINE) });
  y -= 18;

  // ---------------------------------------------------------------- KPI summary
  const kpis: [string, string][] = [
    ['Activities completed', String(v.completed)],
    ['Open / pending work', String(v.openWork)],
    ['Timeline entries', String(v.timeline.length)],
    ['Report status', v.status],
  ];
  const kw = (CW - 3 * 10) / 4;
  kpis.forEach(([k, val], i) => {
    const x = M + i * (kw + 10);
    page.drawRectangle({ x, y: y - 46, width: kw, height: 50, color: rgb(1, 0.965, 0.9) });
    page.drawRectangle({ x, y: y - 46, width: 3, height: 50, color: c(i === 1 ? RUST : ORANGE) });
    page.drawText(safe(val), { x: x + 11, y: y - 20, size: val.length > 10 ? 11 : 17, font: bold, color: c(NAVY) });
    page.drawText(k, { x: x + 11, y: y - 37, size: 7.5, font, color: c(MUTE) });
  });
  y -= 66;
  if (v.submittedAt) { text(`Submitted ${dateTimeIST(v.submittedAt)} IST — figures as submitted.`, M, 8, font, MUTE); y -= 14; }
  else { text('Not yet submitted — live figures at the time of download.', M, 8, font, MUTE); y -= 14; }

  const heading = (s: string) => {
    need(40);
    y -= 10;
    text(s, M, 11.5, bold, NAVY);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: c(ORANGE) });
    y -= 14;
  };

  // ---------------------------------------------------------------- report heads (activity breakdown)
  for (const s of v.sections) {
    if (!s.counts.length) continue;
    heading(s.title);
    for (const row of s.counts) {
      const lines = wrap(row.label + (row.kind !== 'activity' ? '  (open now)' : ''), font, 9.5, CW - 70);
      need(lines.length * 12 + 6);
      lines.forEach((l, i) => { text(l, M + 4, 9.5, font, row.kind !== 'activity' ? MUTE : INK); if (i < lines.length - 1) y -= 12; });
      const val = String(row.value);
      page.drawText(val, { x: W - M - 4 - bold.widthOfTextAtSize(val, 10.5), y, size: 10.5, font: bold, color: c(row.value ? NAVY : MUTE) });
      y -= 8;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: c(LINE) });
      y -= 12;
    }
  }

  // ---------------------------------------------------------------- activity timeline
  heading(`Activity timeline (IST) — ${v.timeline.length} ${v.timeline.length === 1 ? 'entry' : 'entries'}`);
  if (!v.timeline.length) { need(16); text('No activities recorded on this day.', M + 4, 9.5, font, MUTE); y -= 16; }
  const tCol = 64, aCol = 230;
  if (v.timeline.length) {
    need(18);
    text('TIME', M + 4, 7, bold, MUTE); text('ACTIVITY', M + tCol, 7, bold, MUTE); text('RECORD / DETAILS', M + tCol + aCol, 7, bold, MUTE);
    y -= 12;
  }
  for (const r of v.timeline) {
    const act = wrap(`${r.label}${r.quantity > 1 ? ` x ${r.quantity}` : ''}${r.manual ? ' (manual)' : ''}`, font, 9, aCol - 10);
    const det = wrap([r.entity_name, r.application_id ? `Application ${r.application_id}` : null, r.from_status || r.to_status ? `${r.from_status ?? '-'} -> ${r.to_status ?? '-'}` : null, r.note]
      .filter(Boolean).join(' · ') || '—', font, 9, CW - tCol - aCol - 4);
    const rows = Math.max(act.length, det.length);
    need(rows * 11.5 + 8);
    text(timeIST(r.occurred_at), M + 4, 9, font, MUTE);
    const y0 = y;
    act.forEach((l, i) => { y = y0 - i * 11.5; text(l, M + tCol, 9, font, INK); });
    det.forEach((l, i) => { y = y0 - i * 11.5; text(l, M + tCol + aCol, 9, font, MUTE); });
    y = y0 - (rows - 1) * 11.5 - 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: c(LINE) });
    y -= 11;
  }

  // ---------------------------------------------------------------- pending work
  if (v.pending !== null || v.pendingNotes.length) {
    heading('Pending work');
    const items = v.pending ?? [];
    if (!items.length && !v.pendingNotes.length) { need(16); text('Nothing pending.', M + 4, 9.5, font, MUTE); y -= 16; }
    for (const p of items) {
      const lines = wrap(p.title, font, 9.5, CW - 150);
      need(lines.length * 12 + 6);
      const y0 = y;
      lines.forEach((l, i) => { y = y0 - i * 12; text(l, M + 4, 9.5, font, INK); });
      y = y0;
      const when = `${p.overdue ? 'Overdue · ' : ''}${p.when}`;
      page.drawText(safe(when), { x: W - M - 4 - font.widthOfTextAtSize(safe(when), 9), y, size: 9, font: p.overdue ? bold : font, color: c(p.overdue ? [180, 35, 24] : MUTE) });
      y -= (lines.length - 1) * 12 + 8;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: c(LINE) });
      y -= 11;
    }
    for (const n of v.pendingNotes) { need(14); text(`• ${n}`, M + 4, 9, font, MUTE); y -= 13; }
  }

  // ---------------------------------------------------------------- daily summary
  // Only a summary that was actually written (older reports) — same rule as the report screen.
  const texts = v.sections.flatMap((s) => s.texts).filter((t) => t.value);
  if (texts.length) {
    heading('Summary written with this report');
    for (const t of texts) {
      const lines = wrap(t.value || '—', font, 9.5, CW - 8);
      need(28);
      text(t.label, M + 4, 9.5, bold, NAVY);
      y -= 13;
      for (const l of lines) { need(12); text(l, M + 4, 9.5, font, t.value ? INK : MUTE); y -= 12; }
      y -= 6;
    }
  }

  // ---------------------------------------------------------------- footer on every page
  const pages = doc.getPages();
  const stamp = `Generated ${dateTimeIST(new Date().toISOString())} IST · ${v.live ? 'live figures (not yet submitted)' : 'submitted report snapshot'}`;
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, thickness: 0.5, color: c(LINE) });
    p.drawText(safe(`SSI GLOBAL · ${stamp}`), { x: M, y: 27, size: 7.5, font, color: c(MUTE) });
    const pn = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pn, { x: W - M - font.widthOfTextAtSize(pn, 7.5), y: 27, size: 7.5, font, color: c(MUTE) });
  });
  return await doc.save();
}

/** Builds the PDF and saves it as a file (desktop browsers download; mobile browsers open / share it). */
export async function downloadReportPdf(v: ReportView) {
  const bytes = await buildReportPdf(v, new URL('email/ssi-global-mark.png', document.baseURI).href);
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = reportFileName(v);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
