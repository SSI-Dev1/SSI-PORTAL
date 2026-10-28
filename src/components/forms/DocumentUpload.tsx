import { useEffect, useRef, useState } from 'react';
import { FileUp, FileText, X } from 'lucide-react';
import { Button, Field, Modal, Select } from '../ui';
import { useToast } from '../feedback';
import { useScoped, useStore } from '../../store/store';
import { DOC_TYPES, type DocType } from '../../data/types';
import { cn, fileSize, fullName } from '../../lib/utils';
import { prepareUpload } from '../../lib/files';

export function DocumentUpload({ open, onClose, studentId }: { open: boolean; onClose: () => void; studentId?: string }) {
  const { actions } = useStore();
  const scoped = useScoped();
  const toast = useToast();
  const [student, setStudent] = useState('');
  const [type, setType] = useState<DocType>('Passport');
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setStudent(studentId ?? '');
      setFiles([]);
      setError('');
      setBusy(false);
    }
  }, [open, studentId]);

  // Files are checked by content (not just extension) before they are accepted.
  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const accepted: File[] = [];
    for (const f of Array.from(list)) {
      try {
        await prepareUpload(f);
        accepted.push(f);
      } catch (e) {
        return setError((e as Error).message);
      }
    }
    setError('');
    setFiles((f) => [...f, ...accepted].slice(0, 5));
  };

  const save = async () => {
    if (!student) return setError('Select a student.');
    if (!files.length) return setError('Add at least one file.');
    const s = scoped.students.find((x) => x.id === student);
    if (!s) return setError('Select a student.');
    setBusy(true);
    let done = 0;
    for (const file of files) {
      try {
        await actions.addDocument({ studentId: s.id, type, file });
        done++;
      } catch (e) {
        setError(`${file.name}: ${(e as Error).message}`);
        break;
      }
    }
    setBusy(false);
    if (done) toast.success(`${done} document${done > 1 ? 's' : ''} uploaded for ${fullName(s)}`, 'Stored privately; pending verification by SSI GLOBAL.');
    if (done === files.length) onClose();
    else setFiles((f) => f.slice(done));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload documents"
      subtitle="PDF, DOCX, JPG or PNG · up to 10 MB each"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={FileUp} onClick={save} loading={busy}>
            Upload
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Student" required>
          <Select value={student} onChange={(e) => setStudent(e.target.value)} disabled={!!studentId}>
            <option value="">Select student…</option>
            {scoped.students.map((s) => (
              <option key={s.id} value={s.id}>
                {fullName(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Document type" required>
          <Select value={type} onChange={(e) => setType(e.target.value as DocType)}>
            {DOC_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          'mt-4 flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-9 text-center transition',
          drag ? 'border-rust bg-brand-50' : 'border-line bg-canvas/50 hover:border-brand-300 hover:bg-brand-50/40',
        )}
      >
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface text-rust shadow-card">
          <FileUp className="h-5 w-5" />
        </span>
        <span className="text-sm font-semibold text-heading">Drag & drop files here, or click to browse</span>
        <span className="mt-1 text-xs text-ink-mute">Up to 5 files at once</span>
      </button>
      <input ref={inputRef} type="file" multiple hidden accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => addFiles(e.target.files)} />
      {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}
      {files.length > 0 && (
        <ul className="mt-4 space-y-2">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
              <FileText className="h-5 w-5 text-rust" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-heading">{f.name}</span>
                <span className="text-xs text-ink-mute">{fileSize(f.size)}</span>
              </span>
              <button type="button" aria-label="Remove file" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} className="rounded-md p-1 text-ink-mute hover:bg-canvas hover:text-red-600">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
