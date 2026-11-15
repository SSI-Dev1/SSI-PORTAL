// Standard Webhooks signature check (used by Supabase Auth Hooks): HMAC-SHA256 over
// "<webhook-id>.<webhook-timestamp>.<body>" with the base64 secret, compared in constant time.
const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** True when the headers carry a valid, fresh (±5 min) signature of `body` for `secret` ("v1,whsec_…" or bare base64). */
export async function verifyStandardWebhook(secret: string, headers: Headers, body: string, now = Date.now()): Promise<boolean> {
  const id = headers.get('webhook-id');
  const ts = headers.get('webhook-timestamp');
  const sigs = headers.get('webhook-signature');
  const key = secret.replace(/^v1,/, '').replace(/^whsec_/, '');
  if (!id || !ts || !sigs || !key) return false;
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300) return false;
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = fromB64(key);
  } catch {
    return false;
  }
  const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = b64(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${id}.${ts}.${body}`))));
  return sigs.split(' ').some((s) => {
    const [v, sig] = s.split(',');
    return v === 'v1' && !!sig && same(sig, expected);
  });
}

/** For tests: sign like Supabase does. */
export async function signStandardWebhook(secret: string, id: string, ts: number, body: string): Promise<string> {
  const raw = fromB64(secret.replace(/^v1,/, '').replace(/^whsec_/, ''));
  const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `v1,${b64(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${id}.${ts}.${body}`))))}`;
}
