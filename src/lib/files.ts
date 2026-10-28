// Upload validation. The file's real type is detected from its first bytes (magic
// numbers), not trusted from the extension or the browser-reported MIME type. The
// storage bucket enforces the same size/MIME limits server-side.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const KINDS = [
  { ext: 'pdf', mime: 'application/pdf', sig: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { ext: 'png', mime: 'image/png', sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: 'jpg', mime: 'image/jpeg', sig: [0xff, 0xd8, 0xff] },
  { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sig: [0x50, 0x4b, 0x03, 0x04] },
  { ext: 'doc', mime: 'application/msword', sig: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
] as const;

const EXT_ALIASES: Record<string, string> = { jpeg: 'jpg' };

export class UploadError extends Error {}

/** Display-safe file name: no paths, control characters or unusual symbols. */
export function safeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.normalize('NFKC').replace(/[^\w.\- ()]/g, '_').replace(/\.{2,}/g, '.').replace(/^\.+/, '').trim();
  return (cleaned || 'file').slice(0, 120);
}

export async function prepareUpload(file: File) {
  if (file.size === 0) throw new UploadError(`${file.name} is empty.`);
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError(`${file.name} is larger than 10 MB.`);
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const kind = KINDS.find((k) => k.sig.every((b, i) => head[i] === b));
  if (!kind) throw new UploadError(`${file.name} is not a supported PDF, Word, JPG or PNG file.`);
  const rawExt = (file.name.split('.').pop() ?? '').toLowerCase();
  const ext = EXT_ALIASES[rawExt] ?? rawExt;
  // A .docx is a zip; reject other zip-based files renamed to .docx and mismatched extensions.
  if (ext !== kind.ext) throw new UploadError(`${file.name}: the file contents don't match its extension.`);
  return { ext: kind.ext, mime: kind.mime, safeName: safeFileName(file.name) };
}
