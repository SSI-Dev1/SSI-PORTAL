// Partnership Agreement actions of the partner-registration function (0054).
//
// Public (registration link token — opens only its own registration):
//   agreement            current agreement for the form: generates it from the template and the saved
//                        answers when needed, returns its status and short-lived preview / download URL
//   agreement_upload_url one-time signed upload URL for the signed PDF
//   attach_agreement     checks the uploaded PDF and records it as a new partner-signed version
//   remove_agreement     withdraws the latest signed upload before submission (kept in history)
// Public (delivery token from the "countersigned agreement" email):
//   delivery             short-lived download URL of the final countersigned agreement
// Staff (signed in):
//   agreement_file_url, annexure_upload_url / attach_annexure, template_upload_url / attach_template,
//   countersign_upload_url / attach_countersigned (Countersign Agreement permission), send_agreement
// Partner (signed in, activated):
//   my_agreement         download URL of the partner's own countersigned agreement
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { LAYOUTS, fillAgreement, inspectPdf, sha256, type Particulars } from '../_shared/agreementPdf.ts';
import { sendViaBrevo, escapeHtml, type MailConfig } from '../_shared/credentials.ts';
import { safeFileName, sha256Hex } from '../_shared/registration.ts';

export const BUCKET = 'partner-registration-files';
export const MAX_AGREEMENT = 10 * 1024 * 1024;
const URL_SECONDS = 600;

export class AgreementFail extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type Answers = Record<string, unknown>;
const str = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const todayIST = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Agreement particulars from the registration answers, or the labels of what is missing. */
export function particularsFrom(a: Answers, companyName: string): { values: Omit<Particulars, 'agreementDate' | 'reference' | 'templateLabel'>; missing: string[] } {
  const values = {
    companyName: str(a.legal_name) || str(companyName),
    countryState: [str(a.state), str(a.country)].filter(Boolean).join(', '),
    address: [str(a.office_address), str(a.city), str(a.postal_code)].filter(Boolean).join(', '),
    representativeName: str(a.acceptance_full_name),
    representativeDesignation: str(a.acceptance_designation),
  };
  const missing: string[] = [];
  if (!values.companyName) missing.push('Company / Agency Name');
  if (!str(a.country) || !str(a.state)) missing.push('Country and State');
  if (!str(a.office_address)) missing.push('Full Office Address');
  if (!values.representativeName) missing.push('Your full legal name (Declaration)');
  if (!values.representativeDesignation) missing.push('Designation (Declaration)');
  return { values, missing };
}

async function signedUrl(admin: SupabaseClient, path: string, download?: string) {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, URL_SECONDS, download ? { download } : undefined);
  if (error || !data) throw new AgreementFail(500, 'The document link could not be created.');
  return data.signedUrl;
}

async function nextVersion(admin: SupabaseClient, regId: string, kind: string) {
  const { data } = await admin.from('registration_agreement_files').select('version').eq('registration_id', regId).eq('kind', kind).order('version', { ascending: false }).limit(1);
  return ((data?.[0]?.version as number | undefined) ?? 0) + 1;
}

async function currentFile(admin: SupabaseClient, regId: string, kind: string) {
  const { data } = await admin.from('registration_agreement_files').select('*').eq('registration_id', regId).eq('kind', kind).is('superseded_at', null)
    .order('version', { ascending: false }).limit(1);
  return (data?.[0] ?? null) as Record<string, unknown> | null;
}

async function storeFile(admin: SupabaseClient, regId: string, kind: string, bytes: Uint8Array, meta: { name: string; pages: number; templateId?: string | null; by?: string | null }) {
  const version = await nextVersion(admin, regId, kind);
  const path = `${regId}/agreement/${kind}-v${version}-${crypto.randomUUID()}.pdf`;
  const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (up.error) throw new AgreementFail(500, 'The document could not be stored.');
  const { data, error } = await admin.from('registration_agreement_files').insert({
    registration_id: regId, kind, version, template_id: meta.templateId ?? null, storage_path: path, sha256: await sha256(bytes), size: bytes.length,
    pages: meta.pages, file_name: meta.name, uploaded_by: meta.by ?? null, review_status: kind === 'partner_signed' ? 'pending' : null,
  }).select('*').single();
  if (error || !data) { await admin.storage.from(BUCKET).remove([path]); throw new AgreementFail(500, 'The document could not be recorded.'); }
  return data as Record<string, unknown>;
}

async function supersede(admin: SupabaseClient, regId: string, kind: string, exceptId?: string) {
  let q = admin.from('registration_agreement_files').update({ superseded_at: new Date().toISOString() }).eq('registration_id', regId).eq('kind', kind).is('superseded_at', null);
  if (exceptId) q = q.neq('id', exceptId);
  await q;
}

const event = (admin: SupabaseClient, regId: string, action: string, detail: Record<string, unknown> = {}, actor: string | null = null) =>
  admin.from('partner_registration_events').insert({ registration_id: regId, actor, action, detail });

const SIGNED_STATES = ['pending_review', 'approved_for_countersign', 'countersigned', 'sent', 'completed', 'rejected'];

/**
 * The agreement for a registration that is still being filled in: works out the template and annexure,
 * (re)generates the document when the particulars, date, template or annexure changed (an earlier
 * signed upload that no longer matches is withdrawn — it must be signed again), and returns what the
 * form needs.
 */
export async function ensureAgreement(admin: SupabaseClient, reg: { id: string; reference: string; company_name: string; agreement_required: boolean }, answers: Answers) {
  if (!reg.agreement_required) return { required: false as const };
  await admin.from('registration_agreements').upsert({ registration_id: reg.id }, { onConflict: 'registration_id', ignoreDuplicates: true });
  const { data: ag } = await admin.from('registration_agreements').select('*').eq('registration_id', reg.id).single();
  const setStatus = async (status: string, extra: Record<string, unknown> = {}) => {
    if (ag.status !== status || Object.keys(extra).length) await admin.from('registration_agreements').update({ status, updated_at: new Date().toISOString(), ...extra }).eq('registration_id', reg.id);
    ag.status = status;
  };
  if (SIGNED_STATES.includes(ag.status)) return { required: true as const, status: ag.status as string };

  const { data: agency } = await admin.from('agency_prospects').select('agency_type').eq('registration_id', reg.id).limit(1).maybeSingle();
  const type = (agency?.agency_type as string | null) ?? null;
  if (!type) { await setStatus('template_missing', { agency_type: null }); return { required: true as const, status: 'template_missing', reason: 'type' }; }
  const { data: tpl } = await admin.from('agreement_templates').select('*').eq('agency_type', type).eq('status', 'approved').maybeSingle();
  if (!tpl) { await setStatus('template_missing', { agency_type: type }); return { required: true as const, status: 'template_missing', reason: 'template' }; }
  const annexure = tpl.requires_annexure ? await currentFile(admin, reg.id, 'annexure') : null;
  if (tpl.requires_annexure && !annexure && !ag.annexure_resolution) {
    await setStatus('annexure_missing', { agency_type: type, template_id: tpl.id });
    return { required: true as const, status: 'annexure_missing' };
  }
  const { values, missing } = particularsFrom(answers, reg.company_name);
  if (missing.length) return { required: true as const, status: ag.status === 'not_generated' ? 'not_generated' : ag.status, missing };

  const date = (ag.agreement_date as string | null) ?? todayIST();
  const particulars: Particulars = { ...values, agreementDate: date, reference: reg.reference, templateLabel: `${tpl.agency_type === 'domestic' ? 'Domestic' : 'International'} agreement v${tpl.version}` };
  const hash = await sha256Hex(JSON.stringify({ particulars, template: tpl.id, annexure: annexure?.id ?? null, resolution: ag.annexure_resolution ?? null }));
  let generated = await currentFile(admin, reg.id, 'generated');
  if (!generated || ag.particulars_hash !== hash) {
    const { data: tblob, error: te } = await admin.storage.from(BUCKET).download(tpl.storage_path);
    if (te || !tblob) throw new AgreementFail(503, 'The agreement template could not be loaded. SSI GLOBAL has been notified.');
    const tbytes = new Uint8Array(await tblob.arrayBuffer());
    if ((await sha256(tbytes)) !== tpl.sha256) throw new AgreementFail(503, 'The agreement template failed its integrity check. SSI GLOBAL has been notified.');
    let annBytes: Uint8Array | null = null;
    if (annexure) {
      const { data: ablob } = await admin.storage.from(BUCKET).download(String(annexure.storage_path));
      if (!ablob) throw new AgreementFail(503, 'Annexure A could not be loaded.');
      annBytes = new Uint8Array(await ablob.arrayBuffer());
    }
    let out: { bytes: Uint8Array; pages: number };
    try {
      out = await fillAgreement(tbytes, particulars, String(tpl.layout), annBytes);
    } catch (e) {
      const m = String((e as Error).message);
      if (m === 'PARTICULARS_TOO_LONG') throw new AgreementFail(422, 'The company name and address are too long to fit the agreement. Shorten the address (for example, leave out the landmark) and try again.');
      throw new AgreementFail(503, 'The agreement could not be prepared. SSI GLOBAL has been notified.');
    }
    const file = await storeFile(admin, reg.id, 'generated', out.bytes, { name: `SSI-GLOBAL-Partnership-Agreement-${reg.reference}.pdf`, pages: out.pages, templateId: tpl.id });
    await supersede(admin, reg.id, 'generated', String(file.id));
    // A signed copy of an earlier version no longer matches: it is withdrawn (kept in history).
    const signed = await currentFile(admin, reg.id, 'partner_signed');
    if (signed && ag.particulars_hash && signed.review_status === 'pending') {
      await supersede(admin, reg.id, 'partner_signed');
      await event(admin, reg.id, 'agreement_signed_copy_withdrawn', { reason: 'agreement details changed', file: signed.id });
    }
    await admin.from('registration_agreements').update({ agency_type: type, template_id: tpl.id, agreement_date: date, particulars, particulars_hash: hash, updated_at: new Date().toISOString() })
      .eq('registration_id', reg.id);
    await event(admin, reg.id, 'agreement_generated', { version: file.version, sha256: file.sha256 });
    generated = file;
  }
  const signed = await currentFile(admin, reg.id, 'partner_signed');
  const pendingSigned = signed && signed.review_status === 'pending' ? signed : null;
  if (ag.status !== 'changes_requested' || pendingSigned) await setStatus(pendingSigned ? 'partner_signed' : 'ready', { agency_type: type, template_id: tpl.id });
  return {
    required: true as const, status: ag.status as string, date,
    agreement: { name: String(generated.file_name), pages: Number(generated.pages), version: Number(generated.version),
      previewUrl: await signedUrl(admin, String(generated.storage_path)), downloadUrl: await signedUrl(admin, String(generated.storage_path), String(generated.file_name)) },
    signed: pendingSigned ? { id: pendingSigned.id, name: pendingSigned.file_name, size: pendingSigned.size, pages: pendingSigned.pages, uploadedAt: pendingSigned.uploaded_at,
      previewUrl: await signedUrl(admin, String(pendingSigned.storage_path)) } : null,
    review: ag.status === 'changes_requested' ? ag.review : null,
  };
}

/** Public actions with a registration link. */
export async function publicAgreementAction(admin: SupabaseClient, action: string, body: Record<string, unknown>, state: Record<string, unknown>) {
  const id = String(state.id);
  const { data: reg } = await admin.from('partner_registrations').select('id, reference, company_name, agreement_required, answers').eq('id', id).single();
  if (!reg) throw new AgreementFail(404, 'Registration not found.');
  if (action === 'agreement') return await ensureAgreement(admin, reg, (reg.answers ?? {}) as Answers);

  const { data: ag } = await admin.from('registration_agreements').select('status').eq('registration_id', id).maybeSingle();
  if (!reg.agreement_required || !ag || !['ready', 'partner_signed', 'changes_requested'].includes(String(ag.status))) {
    throw new AgreementFail(409, 'The agreement cannot be changed now.');
  }
  if (action === 'agreement_upload_url') {
    const size = Number(body.size ?? 0);
    if (!(size > 0 && size <= MAX_AGREEMENT)) throw new AgreementFail(400, 'The signed agreement must be a PDF of up to 10 MB.');
    const path = `${id}/agreement/upload-${crypto.randomUUID()}.pdf`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new AgreementFail(500, 'The upload could not be prepared.');
    return { path, uploadToken: data.token };
  }
  if (action === 'attach_agreement') {
    const path = String(body.path ?? '');
    if (!path.startsWith(`${id}/agreement/upload-`) || path.includes('..')) throw new AgreementFail(400, 'Unknown upload.');
    const { data: blob, error } = await admin.storage.from(BUCKET).download(path);
    if (error || !blob) throw new AgreementFail(400, 'The file did not finish uploading. Please try again.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await admin.storage.from(BUCKET).remove([path]);
    if (bytes.length === 0 || bytes.length > MAX_AGREEMENT) throw new AgreementFail(400, 'The signed agreement must be a PDF of up to 10 MB.');
    const check = await inspectPdf(bytes);
    if (check.problems.length) throw new AgreementFail(400, check.problems[0]);
    const generated = await currentFile(admin, id, 'generated');
    if (!generated) throw new AgreementFail(409, 'Open the agreement first, then upload the signed copy.');
    // The same file uploaded again (retry / double click) is not a new version.
    const digest = await sha256(bytes);
    const existing = await currentFile(admin, id, 'partner_signed');
    if (existing && existing.sha256 === digest && existing.review_status === 'pending') return { ok: true, duplicate: true };
    const file = await storeFile(admin, id, 'partner_signed', bytes, { name: safeFileName(String(body.name ?? 'signed-agreement.pdf')), pages: check.pages, templateId: String(generated.template_id ?? '') || null });
    await supersede(admin, id, 'partner_signed', String(file.id));
    await admin.from('registration_agreements').update({ status: 'partner_signed', updated_at: new Date().toISOString() }).eq('registration_id', id);
    await event(admin, id, 'agreement_signed_uploaded', { version: file.version, sha256: file.sha256, pages: check.pages, expected_pages: generated.pages });
    return { ok: true, pagesWarning: check.pages < Number(generated.pages) ? `The signed copy has ${check.pages} pages; the agreement has ${generated.pages}. Check that every page is included.` : null };
  }
  if (action === 'remove_agreement') {
    const cur = await currentFile(admin, id, 'partner_signed');
    if (cur && cur.review_status === 'pending') {
      await supersede(admin, id, 'partner_signed');
      await admin.from('registration_agreements').update({ status: ag.status === 'changes_requested' ? 'changes_requested' : 'ready', updated_at: new Date().toISOString() }).eq('registration_id', id);
      await event(admin, id, 'agreement_signed_removed', { version: cur.version });
    }
    return { ok: true };
  }
  throw new AgreementFail(400, 'Unknown request.');
}

/** Final countersigned agreement through the emailed delivery link. */
export async function deliveryDownload(admin: SupabaseClient, token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new AgreementFail(404, 'This link is not valid.');
  const { data: ag } = await admin.from('registration_agreements').select('registration_id, status, delivery_expires_at').eq('delivery_token_hash', await sha256Hex(token)).maybeSingle();
  if (!ag || !['sent', 'completed'].includes(String(ag.status))) throw new AgreementFail(404, 'This link is not valid. Ask SSI GLOBAL for a new one.');
  if (new Date(String(ag.delivery_expires_at)) < new Date()) throw new AgreementFail(410, 'This link has expired. Ask SSI GLOBAL to send the agreement again.');
  const file = await currentFile(admin, String(ag.registration_id), 'countersigned');
  if (!file) throw new AgreementFail(404, 'The agreement is not available.');
  const { data: reg } = await admin.from('partner_registrations').select('company_name, reference').eq('id', ag.registration_id).single();
  if (ag.status === 'sent') {
    await admin.from('registration_agreements').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('registration_id', ag.registration_id).eq('status', 'sent');
    await event(admin, String(ag.registration_id), 'agreement_downloaded_by_partner');
  }
  return { companyName: reg?.company_name ?? null, reference: reg?.reference ?? null, name: file.file_name, url: await signedUrl(admin, String(file.storage_path), String(file.file_name)),
    previewUrl: await signedUrl(admin, String(file.storage_path)), sha256: file.sha256 };
}

/** Staff and partner actions (signed in). `user` is a client with the caller's token. */
export async function staffAgreementAction(admin: SupabaseClient, user: SupabaseClient, action: string, body: Record<string, unknown>, mail: MailConfig) {
  const { data: who } = await user.auth.getUser();
  const me = who.user?.id ?? null;
  if (!me) throw new AgreementFail(401, 'Sign in again.');
  const can = async (fn: string) => (await user.rpc(fn)).data === true;

  if (action === 'my_agreement') {
    const { data: pid } = await user.rpc('my_partner_id');
    if (!pid) throw new AgreementFail(403, 'Not available.');
    const { data: reg } = await admin.from('partner_registrations').select('id').eq('partner_id', String(pid)).order('activated_at', { ascending: false }).limit(1).maybeSingle();
    const { data: ag } = reg ? await admin.from('registration_agreements').select('status, countersigned_at').eq('registration_id', reg.id).maybeSingle() : { data: null };
    const file = reg && ag && ['sent', 'completed'].includes(String(ag.status)) ? await currentFile(admin, reg.id, 'countersigned') : null;
    if (!file) return { agreement: null };
    return { agreement: { name: file.file_name, status: 'Completed', countersignedAt: ag!.countersigned_at, previewUrl: await signedUrl(admin, String(file.storage_path)),
      url: await signedUrl(admin, String(file.storage_path), String(file.file_name)) } };
  }

  const manager = await can('can_manage_registrations');
  const signer = await can('can_countersign_agreements');
  const superAdmin = await can('is_super_admin');
  const regId = String(body.registrationId ?? '');

  if (action === 'agreement_file_url') {
    if (!manager && !signer) throw new AgreementFail(403, 'Not allowed.');
    const { data: f } = await admin.from('registration_agreement_files').select('storage_path, file_name, registration_id').eq('id', String(body.fileId ?? '')).maybeSingle();
    if (!f) throw new AgreementFail(404, 'File not found.');
    await event(admin, String(f.registration_id), 'agreement_file_viewed', { file: body.fileId }, me);
    return { url: await signedUrl(admin, String(f.storage_path), body.download ? String(f.file_name) : undefined) };
  }

  const uploadUrl = async (prefix: string) => {
    const size = Number(body.size ?? 0);
    if (!(size > 0 && size <= MAX_AGREEMENT)) throw new AgreementFail(400, 'Upload a PDF of up to 10 MB.');
    const path = `${prefix}/staff-upload-${crypto.randomUUID()}.pdf`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new AgreementFail(500, 'The upload could not be prepared.');
    return { path, uploadToken: data.token };
  };
  const takeUpload = async (prefix: string) => {
    const path = String(body.path ?? '');
    if (!path.startsWith(`${prefix}/staff-upload-`) || path.includes('..')) throw new AgreementFail(400, 'Unknown upload.');
    const { data: blob, error } = await admin.storage.from(BUCKET).download(path);
    if (error || !blob) throw new AgreementFail(400, 'The file did not finish uploading.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await admin.storage.from(BUCKET).remove([path]);
    const check = await inspectPdf(bytes);
    if (check.problems.length) throw new AgreementFail(400, check.problems[0]);
    return { bytes, pages: check.pages };
  };

  if (action === 'template_upload_url' || action === 'attach_template') {
    if (!superAdmin) throw new AgreementFail(403, 'Only a Super Admin can manage agreement templates.');
    if (action === 'template_upload_url') return await uploadUrl('templates');
    const type = String(body.agencyType ?? '');
    const layout = String(body.layout ?? '');
    if (!['domestic', 'international'].includes(type)) throw new AgreementFail(400, 'Choose Domestic or International.');
    if (!LAYOUTS[layout]) throw new AgreementFail(400, 'This template layout is not supported yet. Ask the development team to measure the template before it can be used.');
    const { bytes, pages } = await takeUpload('templates');
    if (pages !== LAYOUTS[layout].pages) throw new AgreementFail(400, `This layout expects ${LAYOUTS[layout].pages} pages; the uploaded template has ${pages}.`);
    const { data: last } = await admin.from('agreement_templates').select('version').eq('agency_type', type).order('version', { ascending: false }).limit(1);
    const version = ((last?.[0]?.version as number | undefined) ?? 0) + 1;
    const path = `templates/${type}-v${version}-${crypto.randomUUID()}.pdf`;
    const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf' });
    if (up.error) throw new AgreementFail(500, 'The template could not be stored.');
    const { data: t, error } = await admin.from('agreement_templates').insert({
      agency_type: type, version, name: str(body.name) || `${type === 'domestic' ? 'Domestic' : 'International'} Partnership Agreement`, layout, storage_path: path,
      sha256: await sha256(bytes), pages, requires_annexure: body.requiresAnnexure !== false, ssi_signatory_name: str(body.signatoryName) || null,
      ssi_signatory_designation: str(body.signatoryDesignation) || null, notes: str(body.notes) || null, uploaded_by: me,
    }).select('id, version').single();
    if (error || !t) throw new AgreementFail(500, 'The template could not be recorded.');
    await admin.from('audit_log').insert({ actor_id: me, actor_role: 'super_admin', action: 'agreement_template_uploaded', entity: 'agreement_templates', entity_id: t.id, changes: { agency_type: type, version } });
    return { ok: true, id: t.id, version: t.version };
  }

  if (!/^[0-9a-f-]{36}$/.test(regId)) throw new AgreementFail(400, 'Unknown registration.');
  const { data: reg } = await admin.from('partner_registrations').select('id, reference, company_name, answers, intended_email').eq('id', regId).maybeSingle();
  if (!reg) throw new AgreementFail(404, 'Registration not found.');
  const { data: ag } = await admin.from('registration_agreements').select('*').eq('registration_id', regId).maybeSingle();

  if (action === 'annexure_upload_url' || action === 'attach_annexure') {
    if (!manager) throw new AgreementFail(403, 'Only authorised administrators can attach Annexure A.');
    if (ag && !['not_generated', 'template_missing', 'annexure_missing', 'ready', 'changes_requested'].includes(String(ag.status))) {
      throw new AgreementFail(409, 'Annexure A cannot change after the agency has signed. Request changes first.');
    }
    if (action === 'annexure_upload_url') return await uploadUrl(`${regId}/agreement`);
    const { bytes, pages } = await takeUpload(`${regId}/agreement`);
    await admin.from('registration_agreements').upsert({ registration_id: regId }, { onConflict: 'registration_id', ignoreDuplicates: true });
    const file = await storeFile(admin, regId, 'annexure', bytes, { name: safeFileName(String(body.name ?? 'annexure-a.pdf')), pages, by: me });
    await supersede(admin, regId, 'annexure', String(file.id));
    await admin.from('registration_agreements').update({ particulars_hash: null, status: ag?.status === 'annexure_missing' ? 'not_generated' : (ag?.status ?? 'not_generated'), updated_at: new Date().toISOString() })
      .eq('registration_id', regId);
    await event(admin, regId, 'agreement_annexure_attached', { version: file.version, sha256: file.sha256 }, me);
    return { ok: true };
  }

  if (action === 'countersign_upload_url' || action === 'attach_countersigned') {
    if (!signer) throw new AgreementFail(403, 'Only an authorised SSI GLOBAL signatory can countersign agreements.');
    if (!ag || ag.status !== 'approved_for_countersign') throw new AgreementFail(409, 'Approve the partner-signed agreement for countersigning first.');
    if (action === 'countersign_upload_url') return await uploadUrl(`${regId}/agreement`);
    const { bytes, pages } = await takeUpload(`${regId}/agreement`);
    const signedCopy = await currentFile(admin, regId, 'partner_signed');
    const digest = await sha256(bytes);
    if (signedCopy && signedCopy.sha256 === digest) throw new AgreementFail(400, 'This is the partner-signed copy without SSI GLOBAL’s signature. Upload the countersigned PDF.');
    const flag = signedCopy && pages !== Number(signedCopy.pages) ? `Page count differs: partner-signed copy ${signedCopy.pages}, countersigned copy ${pages}.` : null;
    const file = await storeFile(admin, regId, 'countersigned', bytes, { name: `SSI-GLOBAL-Partnership-Agreement-${reg.reference}-countersigned.pdf`, pages, by: me });
    await supersede(admin, regId, 'countersigned', String(file.id));
    await admin.from('registration_agreements').update({ status: 'countersigned', countersigned_by: me, countersigned_at: new Date().toISOString(), version_flag: flag, updated_at: new Date().toISOString() })
      .eq('registration_id', regId).eq('status', 'approved_for_countersign');
    await event(admin, regId, 'agreement_countersigned', { version: file.version, sha256: file.sha256, flag }, me);
    return { ok: true, flag };
  }

  if (action === 'send_agreement') {
    if (!manager && !signer) throw new AgreementFail(403, 'Not allowed.');
    if (!ag || !['countersigned', 'sent', 'completed'].includes(String(ag.status))) throw new AgreementFail(409, 'Countersign the agreement before sending it.');
    const file = await currentFile(admin, regId, 'countersigned');
    if (!file) throw new AgreementFail(409, 'Upload the countersigned agreement first.');
    const a = (reg.answers ?? {}) as Answers;
    const to = str(body.email) || str(a.registered_email) || str(a.company_email) || str(a.contact_email) || str(reg.intended_email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new AgreementFail(400, 'No email address for this agency.');
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    const expires = new Date(Date.now() + 30 * 86400_000);
    const url = `${mail.portalUrl.replace(/\/$/, '')}/#/agreement/${token}`;
    let status: 'accepted' | 'failed' | 'not_configured' = 'not_configured';
    let detail: string | null = 'Email is not configured';
    if (mail.apiKey && mail.fromAddress) {
      const sent = await sendViaBrevo(mail, { email: to, name: reg.company_name }, countersignedEmail(reg.company_name, url, expires), fetch, 'agreement-final');
      status = sent.ok ? 'accepted' : 'failed';
      detail = sent.ok ? null : sent.detail;
    }
    await admin.from('registration_agreements').update({
      delivery_token_hash: await sha256Hex(token), delivery_expires_at: expires.toISOString(), sent_by: me, sent_at: new Date().toISOString(),
      email_status: status, email_detail: detail, status: ag.status === 'completed' ? 'completed' : 'sent', updated_at: new Date().toISOString(),
    }).eq('registration_id', regId);
    await event(admin, regId, 'agreement_sent', { email_status: status }, me);
    // The link is returned once so it can be shared another way if email fails (never stored in clear).
    return { ok: true, emailStatus: status, detail, link: url, expiresAt: expires.toISOString() };
  }
  throw new AgreementFail(400, 'Unknown request.');
}

export function countersignedEmail(company: string, url: string, expires: Date) {
  const until = expires.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const subject = 'SSI GLOBAL — Your Countersigned Partnership Agreement';
  const text = `Dear Partner,\n\nWe are pleased to share the countersigned copy of your Partnership Agreement with SSI GLOBAL.\n\nPlease find your completed agreement available for secure download:\n${url}\n(This private link works until ${until}.)\n\nThank you for your cooperation.\nWe look forward to a successful partnership.\n\nBest regards,\nSSI GLOBAL Partnerships Team`;
  const html = `<!doctype html><html><body style="margin:0;background:#F2F5F6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F2F5F6;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#06242F;padding:22px 28px;color:#fff;font-size:20px;line-height:1.1;"><b>SSI</b><br><span style="font-weight:300;letter-spacing:1px;">GLOBAL</span></td></tr>
<tr><td style="height:4px;background:#FBA51E;background-image:linear-gradient(90deg,#FBA51E,#B94A12);font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:28px;color:#33454C;font-size:15px;line-height:1.6;">
<p style="margin:0 0 12px;color:#06242F;">Dear Partner,</p>
<p style="margin:0 0 12px;">We are pleased to share the countersigned copy of your Partnership Agreement with SSI GLOBAL${company ? ` (${escapeHtml(company)})` : ''}.</p>
<p style="margin:0 0 18px;">Please find your completed agreement available for secure download.</p>
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:10px;background:#FBA51E;background-image:linear-gradient(90deg,#FBA51E,#B94A12);">
<a href="${escapeHtml(url)}" style="display:inline-block;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;">DOWNLOAD AGREEMENT</a></td></tr></table>
<p style="margin:14px 0 0;font-size:12px;color:#6C7F86;">This private link works until ${escapeHtml(until)}. Please do not forward it.</p>
<p style="margin:18px 0 0;">Thank you for your cooperation.<br>We look forward to a successful partnership.</p>
<p style="margin:18px 0 0;">Best regards,<br><b style="color:#06242F;">SSI GLOBAL Partnerships Team</b></p></td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html, text };
}
