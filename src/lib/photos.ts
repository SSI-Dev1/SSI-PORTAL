// Employee profile photos live in the private "employee-photos" bucket (staff-only). Pages ask
// for short-lived signed links in one batch; links are cached until shortly before they expire.
import { useEffect, useState } from 'react';
import { supabase } from '../auth/auth';

export const PHOTO_BUCKET = 'employee-photos';
const TTL_SECONDS = 3600;
const cache = new Map<string, { url: string; until: number }>();

/** Signed links for the given storage paths (missing or failed paths are simply absent). */
export function usePhotoUrls(paths: (string | null | undefined)[]) {
  const key = [...new Set(paths.filter(Boolean) as string[])].sort().join('|');
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const list = key ? key.split('|') : [];
    const now = Date.now();
    const known: Record<string, string> = {};
    const need: string[] = [];
    for (const p of list) {
      const c = cache.get(p);
      if (c && c.until > now) known[p] = c.url;
      else need.push(p);
    }
    setUrls(known);
    if (!need.length || !supabase) return;
    let alive = true;
    void supabase.storage.from(PHOTO_BUCKET).createSignedUrls(need, TTL_SECONDS).then(({ data }) => {
      const add: Record<string, string> = {};
      for (const r of data ?? []) {
        if (r.signedUrl && r.path) {
          cache.set(r.path, { url: r.signedUrl, until: Date.now() + (TTL_SECONDS - 120) * 1000 });
          add[r.path] = r.signedUrl;
        }
      }
      if (alive) setUrls((u) => ({ ...u, ...add }));
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return urls;
}

const SIGS: { mime: string; ext: string; sig: number[] }[] = [
  { mime: 'image/jpeg', ext: 'jpg', sig: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', ext: 'png', sig: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/webp', ext: 'webp', sig: [0x52, 0x49, 0x46, 0x46] },
];

/** Checks a photo by its contents (JPG, PNG or WebP, up to 2 MB). */
export async function checkPhoto(file: File) {
  if (file.size === 0) throw new Error('The file is empty.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Choose a photo up to 2 MB.');
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const kind = SIGS.find((k) => k.sig.every((b, i) => head[i] === b) && (k.ext !== 'webp' || String.fromCharCode(...head.slice(8, 12)) === 'WEBP'));
  if (!kind) throw new Error('Choose a JPG, PNG or WebP image.');
  return kind;
}
