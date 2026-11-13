// Agency List → Import from Excel (administrators). The workbook is read in the browser; the
// server matches every row (preview_agency_import) and nothing is saved until the administrator
// confirms. Existing agencies are never overwritten, no login or partner is created, and the
// import is not counted as anyone's work.
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp } from 'lucide-react';
import { Alert, Badge, Button, Checkbox, FilterSelect, Modal, Table } from '../../components/ui';
import { KPI } from '../../components/hr';
import { useToast } from '../../components/feedback';
import { rpc } from '../../lib/agencies';
import { parseAgencyWorkbook, statusLabel, type AgencyParse } from '../../lib/agencyImport';
import { MAX_IMPORT_BYTES } from '../../lib/catalogueImport';

type Result = 'new' | 'new_linked' | 'new_reconcile' | 'existing' | 'duplicate_in_file' | 'invalid';
interface Item { row: number; result: Result; stage: string; reason: string | null; existing: string | null; partner_id: string | null }
interface Preview { items: Item[]; counts: Partial<Record<Result, number>>; stages: Record<string, number> | null }
const RESULT: Record<Result, { label: string; tone: 'green' | 'navy' | 'amber' | 'slate' | 'red' }> = {
  new: { label: 'New', tone: 'green' }, new_linked: { label: 'New · linked to partner', tone: 'navy' }, new_reconcile: { label: 'New · needs reconciliation', tone: 'amber' },
  existing: { label: 'Already in the list — skipped', tone: 'slate' }, duplicate_in_file: { label: 'Repeated in the file — skipped', tone: 'slate' }, invalid: { label: 'Cannot import', tone: 'red' },
};
const STAGE_LABEL: Record<string, string> = { onboarded: 'Onboarded', proposal_sent: 'Proposal Sent', mou_sent: 'MOU Sent', closed: 'Closed', inactive: 'Inactive', new_prospect: 'New prospect' };

export function ImportAgencies({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<AgencyParse | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [show, setShow] = useState<'' | Result>('');
  const [req] = useState(() => crypto.randomUUID());

  const read = async (f: File) => {
    setFile(f); setParsed(null); setPreview(null); setErr(''); setConfirm(false);
    if (f.size > MAX_IMPORT_BYTES) return setErr('The file is larger than 5 MB.');
    try {
      const p = parseAgencyWorkbook(new Uint8Array(await f.arrayBuffer()));
      if (!p.rows.length) return setErr('No agency rows were found in the sheet.');
      setParsed(p);
      setBusy(true);
      const r = await rpc<Preview>('preview_agency_import', { p_rows: p.rows });
      setBusy(false);
      if (!r.ok) return setErr(r.error);
      setPreview(r.data);
    } catch (e) {
      setBusy(false);
      setErr((e as Error).message || 'The file could not be read.');
    }
  };
  const rowOf = useMemo(() => new Map((parsed?.rows ?? []).map((r) => [r.row, r])), [parsed]);
  const creating = preview ? (preview.counts.new ?? 0) + (preview.counts.new_linked ?? 0) + (preview.counts.new_reconcile ?? 0) : 0;
  const skipping = preview ? preview.items.length - creating : 0;
  const shown = (preview?.items ?? []).filter((i) => (show ? i.result === show : i.result !== 'new'));

  const run = async () => {
    if (!parsed || !file) return;
    setBusy(true);
    const r = await rpc<{ created: number; skipped: number }>('import_agencies', { p_file: file.name, p_sheet: parsed.sheet, p_rows: parsed.rows, p_request: req });
    setBusy(false);
    if (!r.ok) return toast.error('Import failed — nothing was saved', r.error);
    toast.success(`${r.data.created} agencies imported`, r.data.skipped ? `${r.data.skipped} rows skipped (already in the list or repeated).` : undefined);
    onDone(); onClose();
  };

  return (
    <Modal open onClose={onClose} size="wide" dirty={!!preview} title="Import agencies from Excel"
      subtitle="Columns such as Agent Name · POC · Number · Email · status (bpq). Original values are kept; nothing is saved until you confirm."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button icon={FileUp} disabled={!preview || !creating || !confirm || busy} onClick={() => void run()}>{busy ? 'Working…' : `Import ${creating} agencies`}</Button></>}>
      <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-line p-4 text-sm hover:border-brand-300">
        <FileUp className="h-5 w-5 text-rust" />
        <span className="min-w-0 flex-1 truncate">{file ? file.name : 'Choose an .xlsx file…'}</span>
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }} />
      </label>
      {err && <Alert tone="error" className="mt-3">{err}</Alert>}
      {busy && !preview && <p className="mt-3 text-sm text-ink-soft" role="status">Checking every row against the Agency List and Clients & Branches…</p>}
      {parsed && preview && (
        <>
          <p className="mt-4 text-sm text-ink-soft">Sheet <b className="text-heading">{parsed.sheet}</b> · {parsed.rows.length} rows · columns {Object.values(parsed.headers).join(' · ')}
            {parsed.rows.some((r) => r.phoneFromNumber) && <> · {parsed.rows.filter((r) => r.phoneFromNumber).length} phone numbers were stored by Excel as numbers and are kept digit for digit (a leading 0 or + that Excel removed cannot be restored)</>}</p>
          {parsed.problems.map((p) => <Alert key={p} tone="warning" className="mt-2">{p}</Alert>)}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KPI label="Will be added" value={creating} icon={CheckCircle2} tone="green" />
            <KPI label="Linked to an existing partner" value={preview.counts.new_linked ?? 0} icon={CheckCircle2} tone="navy" />
            <KPI label="Onboarded — need reconciliation" value={preview.counts.new_reconcile ?? 0} icon={AlertTriangle} tone="amber" />
            <KPI label="Skipped (already listed / repeated / invalid)" value={skipping} icon={AlertTriangle} tone="red" />
          </div>
          {preview.stages && (
            <p className="mt-3 text-sm">Status of the agencies being added: {Object.entries(preview.stages).sort().map(([k, n]) => <Badge key={k} tone="slate" className="mr-1">{STAGE_LABEL[k] ?? k} {n}</Badge>)}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <FilterSelect label="Show" value={show} onChange={(v) => setShow(v as '' | Result)} options={[{ value: '', label: 'Rows needing attention' }, ...Object.entries(RESULT).map(([v, x]) => ({ value: v, label: x.label }))]} />
            <span className="text-xs text-ink-mute">{shown.length} rows</span>
          </div>
          <div className="mt-2 max-h-[300px] overflow-auto rounded-2xl border border-line">
            {shown.length === 0 ? <p className="p-4 text-sm text-ink-soft">Nothing to show.</p> : (
              <Table className="hr-table" head={['Row', 'Agency', 'Contact', 'Original status', 'Result']}>
                {shown.slice(0, 300).map((i) => {
                  const r = rowOf.get(i.row);
                  return (
                    <tr key={i.row}>
                      <td className="tabular-nums">{i.row}</td>
                      <td className="min-w-[160px]">{r?.name ?? <span className="text-ink-mute">—</span>}</td>
                      <td className="text-xs">{[r?.poc, r?.phone, r?.email].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="text-sm">{r?.status ?? '—'}<div className="text-xs text-ink-mute">→ {statusLabel(r?.status ?? null)}</div></td>
                      <td><Badge tone={RESULT[i.result].tone}>{RESULT[i.result].label}</Badge>{i.reason && <div className="mt-1 max-w-[280px] text-xs text-ink-mute">{i.reason}</div>}</td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </div>
          <Alert tone="info" className="mt-4">Imported agencies keep their original status, row number and values. Contact status starts as “Not recorded”, no officer is assigned, no login or partner account is created, and the import is not counted in anyone's Daily Work Report. “Onboarded” rows without a matching partner account stay historical until an administrator reconciles them.</Alert>
          <div className="mt-3"><Checkbox checked={confirm} onCheckedChange={setConfirm} label={`Add ${creating} agencies to the Agency List`} description={skipping ? `${skipping} rows are skipped; existing agencies are not changed.` : undefined} /></div>
        </>
      )}
    </Modal>
  );
}
