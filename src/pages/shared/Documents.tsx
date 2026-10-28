import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, ExternalLink, Eye, FileText, FileUp, FolderOpen, MoreHorizontal, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { Badge, Button, Card, EmptyState, FilterSelect, Menu, Modal, PageHeader, Pagination, SearchInput, Table, usePaged } from '../../components/ui';
import { useConfirm, useToast } from '../../components/feedback';
import { DocumentUpload } from '../../components/forms/DocumentUpload';
import { useLookup, useScoped, useStore } from '../../store/store';
import { DOC_TYPES, type DocStatus, type DocumentRecord } from '../../data/types';
import { cn, fileSize, formatDate, formatDateTime, fullName, matches, type Tone } from '../../lib/utils';

export const docTone: Record<DocStatus, Tone> = { Verified: 'green', Pending: 'amber', Rejected: 'red' };

export default function Documents() {
  const scoped = useScoped();
  const lk = useLookup();
  const { actions } = useStore();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [upload, setUpload] = useState(false);
  const [preview, setPreview] = useState<DocumentRecord>();

  const rows = useMemo(
    () =>
      scoped.documents
        .filter((d) => matches(q, d.fileName, d.type, fullName(lk.student.get(d.studentId))))
        .filter((d) => !type || d.type === type)
        .filter((d) => !status || d.status === status)
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
    [scoped.documents, lk, q, type, status],
  );
  const paged = usePaged(rows, 12, `${q}${type}${status}`);
  const count = (s: DocStatus) => scoped.documents.filter((d) => d.status === s).length;

  const setDocStatus = (d: DocumentRecord, s: DocStatus) => {
    actions.setDocumentStatus(d.id, s);
    toast.success(`Document ${s.toLowerCase()}`, d.fileName);
  };
  // Opens the file via a 60-second signed URL issued after a server-side access check.
  // The tab is opened synchronously (so pop-up blockers allow it) and then pointed at the file.
  const openFile = async (d: DocumentRecord) => {
    const w = window.open('about:blank', '_blank');
    try {
      const url = await actions.documentUrl(d.id);
      if (w) {
        w.opener = null;
        w.location.href = url;
      }
    } catch (e) {
      w?.close();
      toast.error('Cannot open document', (e as Error).message);
    }
  };

  const remove = async (d: DocumentRecord) => {
    if (await confirm({ title: 'Delete document?', message: `${d.fileName} will be permanently removed.`, confirmLabel: 'Delete', danger: true })) {
      actions.removeDocument(d.id);
      toast.success('Document deleted');
    }
  };

  const stats = [
    { label: 'Total documents', value: scoped.documents.length, icon: FolderOpen, cls: 'bg-navy-50 text-heading', filter: '' },
    { label: 'Verified', value: count('Verified'), icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-600', filter: 'Verified' },
    { label: 'Pending review', value: count('Pending'), icon: Clock, cls: 'bg-amber-50 text-amber-600', filter: 'Pending' },
    { label: 'Rejected', value: count('Rejected'), icon: XCircle, cls: 'bg-red-50 text-red-600', filter: 'Rejected' },
  ];

  return (
    <>
      <PageHeader
        title="Documents"
        subtitle={scoped.isAdmin ? 'Review and verify student documents from every partner.' : 'Upload and manage your students’ documents.'}
        actions={<Button icon={FileUp} onClick={() => setUpload(true)}>Upload Documents</Button>}
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => setStatus(status === s.filter ? '' : s.filter)}
            className={cn('flex items-center gap-3 rounded-2xl border bg-surface p-4 text-left shadow-card transition hover:-translate-y-0.5', status === s.filter && s.filter ? 'border-rust ring-2 ring-brand/20' : 'border-line')}
          >
            <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', s.cls)}>
              <s.icon className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-xs font-medium text-ink-soft">{s.label}</span>
              <span className="block font-display text-xl font-semibold text-heading">{s.value}</span>
            </span>
          </button>
        ))}
      </div>
      <Card>
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search file, type or student…" className="lg:w-96" />
          <div className="flex flex-wrap gap-2.5 lg:ml-auto">
            <FilterSelect label="All types" value={type} onChange={setType} options={[...DOC_TYPES]} />
            <FilterSelect label="All statuses" value={status} onChange={setStatus} options={['Verified', 'Pending', 'Rejected']} />
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={FileText} title="No documents found" description="Upload documents or adjust your filters." action={<Button icon={FileUp} onClick={() => setUpload(true)}>Upload</Button>} />
        ) : (
          <>
            <Table head={['Document', 'Student', ...(scoped.isAdmin ? ['Partner'] : []), 'Type', 'Size', 'Uploaded', 'Status', '']}>
              {paged.rows.map((d) => {
                const s = lk.student.get(d.studentId);
                return (
                  <tr key={d.id} className="transition hover:bg-brand-50/30">
                    <td className="px-5 py-3">
                      <button type="button" onClick={() => setPreview(d)} className="flex items-center gap-3 text-left">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-[10px] font-bold uppercase text-rust">
                          {d.fileName.split('.').pop()}
                        </span>
                        <span className="max-w-[220px] truncate font-semibold text-heading hover:text-rust">{d.fileName}</span>
                      </button>
                    </td>
                    <td className="px-5 py-3">
                      <Link to={`${scoped.base}/students/${d.studentId}`} className="font-medium text-ink-soft hover:text-rust">
                        {fullName(s)}
                      </Link>
                    </td>
                    {scoped.isAdmin && <td className="px-5 py-3 text-ink-soft">{lk.partner.get(d.partnerId)?.code}</td>}
                    <td className="whitespace-nowrap px-5 py-3 text-ink-soft">{d.type}</td>
                    <td className="px-5 py-3 text-ink-soft">{fileSize(d.size)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-ink-soft">{formatDate(d.uploadedAt)}</td>
                    <td className="px-5 py-3">
                      <Badge tone={docTone[d.status]} dot>
                        {d.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-3">
                      <Menu
                        trigger={() => (
                          <button type="button" aria-label="Document actions" className="rounded-lg p-1.5 text-ink-mute hover:bg-canvas hover:text-heading">
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        )}
                        items={[
                          { label: 'Details', icon: Eye, onClick: () => setPreview(d) },
                          ...(d.storagePath ? [{ label: 'Open file', icon: ExternalLink, onClick: () => void openFile(d) }] : []),
                          ...(scoped.isAdmin
                            ? [
                                { label: 'Mark verified', icon: ShieldCheck, onClick: () => setDocStatus(d, 'Verified') },
                                { label: 'Reject', icon: XCircle, onClick: () => setDocStatus(d, 'Rejected') },
                              ]
                            : []),
                          { label: 'Delete', icon: Trash2, onClick: () => remove(d), danger: true },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={rows.length} label="documents" />
          </>
        )}
      </Card>

      <DocumentUpload open={upload} onClose={() => setUpload(false)} />
      <Modal
        open={!!preview}
        onClose={() => setPreview(undefined)}
        title={preview?.fileName}
        subtitle={preview && `${preview.type} · ${fullName(lk.student.get(preview.studentId))}`}
        footer={
          preview && scoped.isAdmin ? (
            <>
              <Button variant="secondary" icon={XCircle} onClick={() => { setDocStatus(preview, 'Rejected'); setPreview(undefined); }}>
                Reject
              </Button>
              <Button icon={ShieldCheck} onClick={() => { setDocStatus(preview, 'Verified'); setPreview(undefined); }}>
                Verify document
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setPreview(undefined)}>
              Close
            </Button>
          )
        }
      >
        {preview && (
          <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
            <div className="flex aspect-[3/4] flex-col gap-2 rounded-xl border border-line bg-canvas p-4">
              <div className="h-3 w-2/3 rounded bg-navy-100" />
              <div className="h-2 w-full rounded bg-slate-200" />
              <div className="h-2 w-5/6 rounded bg-slate-200" />
              <div className="h-2 w-4/6 rounded bg-slate-200" />
              <div className="mt-2 h-14 rounded-lg bg-brand-100" />
              <div className="h-2 w-full rounded bg-slate-200" />
              <div className="h-2 w-3/4 rounded bg-slate-200" />
              <div className="mt-auto text-center text-[10px] font-semibold uppercase text-ink-mute">Preview</div>
            </div>
            <dl className="space-y-3 text-sm">
              {[
                ['Status', <Badge key="b" tone={docTone[preview.status]} dot>{preview.status}</Badge>],
                ['File size', fileSize(preview.size)],
                ['Uploaded', formatDateTime(preview.uploadedAt)],
                ['Partner', lk.partner.get(preview.partnerId)?.name],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-[11.5px] font-medium uppercase tracking-wide text-ink-mute">{k}</dt>
                  <dd className="mt-0.5 font-medium text-heading">{v}</dd>
                </div>
              ))}
              {preview.storagePath ? (
                <Button variant="secondary" icon={ExternalLink} onClick={() => void openFile(preview)}>
                  Open file
                </Button>
              ) : (
                <p className="rounded-xl bg-canvas p-3 text-xs text-ink-soft">No file is attached to this record.</p>
              )}
              <p className="text-[11px] text-ink-mute">Files are stored privately. Each open is access-checked, logged, and uses a link that expires after 60 seconds.</p>
            </dl>
          </div>
        )}
      </Modal>
    </>
  );
}
