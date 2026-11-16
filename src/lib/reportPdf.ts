// Daily Work Report as a PDF: a clean, branded A4 document printed through the browser's own
// "Save as PDF" (no extra library, nothing sent anywhere). Built only from what the report page
// already shows the signed-in user — figures, timeline, pending work and their written summary.

export interface ReportPdfData {
  employee: string;
  designation: string;
  department: string | null;
  date: string;
  dateLabel: string;
  status: string;
  submittedAt: string | null;
  templateName: string;
  sections: { title: string; counts: { label: string; value: number; kind: string }[]; texts: { label: string; value: string }[] }[];
  completed: number;
  openWork: number;
  timeline: { occurred_at: string; label: string; entity_name: string | null; manual: boolean; quantity: number; from_status: string | null; to_status: string | null }[];
  pending: { title: string; when: string; overdue: boolean }[];
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const timeIST = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });

export function reportPdfHtml(d: ReportPdfData, logoUrl: string): string {
  const sections = d.sections.map((s) => {
    const counts = s.counts.length ? `
      <table class="figs"><tbody>
        ${s.counts.map((c) => `<tr><td>${esc(c.label)}${c.kind !== 'activity' ? ' <span class="tag">open now</span>' : ''}</td><td class="num">${c.value}</td></tr>`).join('')}
      </tbody></table>` : '';
    const texts = s.texts.filter((t) => t.value.trim()).map((t) => `<div class="note"><div class="nl">${esc(t.label)}</div><div class="nv">${esc(t.value)}</div></div>`).join('');
    if (!counts && !texts) return '';
    return `<section><h2>${esc(s.title)}</h2>${counts}${texts}</section>`;
  }).join('');
  const timeline = d.timeline.length ? `<table class="tl"><thead><tr><th>Time</th><th>Activity</th><th>Record</th></tr></thead><tbody>
      ${d.timeline.map((r) => `<tr><td class="t">${timeIST(r.occurred_at)}</td><td>${esc(r.label)}${r.quantity > 1 ? ` × ${r.quantity}` : ''}${r.manual ? ' <span class="tag">manual</span>' : ''}${r.from_status || r.to_status ? `<div class="sub">${esc(r.from_status ?? '—')} → ${esc(r.to_status ?? '—')}</div>` : ''}</td><td>${esc(r.entity_name ?? '')}</td></tr>`).join('')}
    </tbody></table>` : '<p class="muted">No activities recorded on this day.</p>';
  const pending = d.pending.length ? `<table class="tl"><tbody>${d.pending.map((p) => `<tr><td>${esc(p.title)}</td><td class="t ${p.overdue ? 'od' : ''}">${p.overdue ? 'Overdue · ' : ''}${esc(p.when)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nothing pending.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>SSI GLOBAL Daily Work Report — ${esc(d.employee)} — ${esc(d.date)}</title>
<style>
  @page { size: A4; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 11px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1d2f36; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  header { display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: #06242F; color: #fff; border-radius: 10px; }
  header img { width: 34px; height: 34px; }
  header .brand { font-size: 15px; line-height: 1.05; } header .brand b { display: block; letter-spacing: .5px; }
  header .title { margin-left: auto; text-align: right; } header .title div:first-child { font-size: 14px; font-weight: 700; }
  header .title div + div { color: #b9cad0; }
  .bar { height: 4px; margin: 8px 0 12px; border-radius: 4px; background: linear-gradient(90deg, #FBA51E, #B94A12); }
  .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
  .meta div { border: 1px solid #e3e9eb; border-radius: 8px; padding: 7px 9px; } .meta span { display: block; color: #6c7f86; font-size: 9px; text-transform: uppercase; letter-spacing: .6px; }
  .meta b { font-size: 12px; }
  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px; }
  .kpis div { border-radius: 8px; padding: 9px 11px; background: #fff6e6; border-left: 4px solid #FBA51E; } .kpis b { font-size: 18px; display: block; color: #06242F; }
  h2 { font-size: 12.5px; color: #06242F; margin: 14px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #e3e9eb; }
  section { break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; }
  .figs td { padding: 4px 6px; border-bottom: 1px solid #f0f3f4; } .figs .num { text-align: right; font-weight: 700; width: 60px; color: #06242F; }
  .tl th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .6px; color: #6c7f86; padding: 4px 6px; border-bottom: 1px solid #e3e9eb; }
  .tl td { padding: 4px 6px; border-bottom: 1px solid #f0f3f4; vertical-align: top; } .tl .t { white-space: nowrap; width: 80px; color: #4b5f66; } .od { color: #b42318; font-weight: 600; }
  .sub { color: #6c7f86; font-size: 10px; }
  .tag { display: inline-block; font-size: 8.5px; padding: 0 5px; border-radius: 6px; background: #eef2f3; color: #4b5f66; vertical-align: 1px; }
  .note { margin: 6px 0; } .nl { font-weight: 700; color: #06242F; } .nv { white-space: pre-wrap; }
  .muted { color: #6c7f86; }
  footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #e3e9eb; color: #6c7f86; font-size: 9px; display: flex; justify-content: space-between; }
</style></head><body>
<header>
  <img src="${esc(logoUrl)}" alt="">
  <div class="brand"><b>SSI</b>GLOBAL</div>
  <div class="title"><div>Daily Work Report</div><div>${esc(d.templateName)}</div></div>
</header>
<div class="bar"></div>
<div class="meta">
  <div><span>Employee</span><b>${esc(d.employee)}</b></div>
  <div><span>Designation</span><b>${esc(d.designation)}</b></div>
  <div><span>Department</span><b>${esc(d.department ?? '—')}</b></div>
  <div><span>Reporting date</span><b>${esc(d.dateLabel)}</b></div>
</div>
<div class="kpis">
  <div><b>${d.completed}</b>Activities completed</div>
  <div><b>${d.openWork}</b>Open / pending work (not completed)</div>
  <div><b>${esc(d.status)}</b>${d.submittedAt ? `Submitted ${esc(new Date(d.submittedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }))}` : 'Report status'}</div>
</div>
${sections}
<section><h2>Activity timeline (IST)</h2>${timeline}</section>
<section><h2>Pending work</h2>${pending}</section>
<footer><span>Figures come from work recorded in SSI GLOBAL${d.status === 'Not submitted' || d.status === 'Draft' ? ' (live — not yet submitted)' : ' (as submitted)'}.</span><span>Generated ${esc(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }))} IST</span></footer>
</body></html>`;
}

/** Opens the browser's print dialog for the report; choose "Save as PDF" to download it. */
export function printReportPdf(d: ReportPdfData) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(reportPdfHtml(d, new URL('email/ssi-global-mark.png', document.baseURI).href));
  doc.close();
  const go = () => {
    const prev = document.title;
    // The page title becomes the suggested PDF file name.
    document.title = doc.title;
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => { document.title = prev; frame.remove(); }, 1500);
  };
  const img = doc.querySelector('img');
  if (img && !img.complete) { img.onload = go; img.onerror = go; } else setTimeout(go, 50);
}
