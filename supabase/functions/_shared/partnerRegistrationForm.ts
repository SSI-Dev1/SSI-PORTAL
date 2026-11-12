// Partner Registration Form — one definition shared by the public form (browser), the
// partner-registration function (server-side validation) and the admin review screen.
// Fields marked source: 'screenshot' come from the seven reference screenshots; 'added' are
// extra fields SSI GLOBAL asked for in the specification. Change FORM_VERSION when fields change:
// every submission stores the version it was made with.

export const FORM_VERSION = 'v1-2026-11';

export type FieldType = 'text' | 'textarea' | 'email' | 'tel' | 'url' | 'year' | 'count' | 'select' | 'file' | 'checkbox' | 'signature';

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  source: 'screenshot' | 'added';
  hint?: string;
  options?: string[];
  /** Files: accepted kinds. */
  accept?: ('pdf' | 'image')[];
  max?: number;
  /** Shown only when another field has this value. */
  showWhen?: { key: string; equals: string };
  /** Filled by the system, not typed by the applicant. */
  locked?: boolean;
}

export interface FormSection { id: string; title: string; description?: string; fields: FormField[] }

export const ORGANISATION_TYPES = ['Education Consultancy', 'Recruitment Agency', 'Sub-Agent', 'Overseas Education Group', 'Institutional Partner', 'Independent Education Consultant', 'Other'];

export const FORM_SECTIONS: FormSection[] = [
  {
    id: 'company', title: 'Company / Agency Details', description: 'Mandatory information',
    fields: [
      { key: 'company_name', label: 'Company / Agency Name', type: 'text', required: true, source: 'screenshot', locked: true, max: 160 },
      { key: 'company_name_correction', label: 'Correction to the company name (if needed)', type: 'text', source: 'added', max: 160, hint: 'SSI GLOBAL reviews any correction. The registration stays linked to the company it was created for.' },
      { key: 'legal_name', label: 'Registered legal name (if different)', type: 'text', source: 'added', max: 160 },
      { key: 'registration_number', label: 'Company Registration Number (if applicable)', type: 'text', source: 'screenshot', max: 80 },
      { key: 'year_established', label: 'Year of Establishment', type: 'year', required: true, source: 'screenshot' },
      { key: 'country', label: 'Country', type: 'text', required: true, source: 'screenshot', max: 80 },
      { key: 'state', label: 'State', type: 'text', required: true, source: 'screenshot', max: 80 },
      { key: 'city', label: 'City', type: 'text', required: true, source: 'screenshot', max: 80 },
      { key: 'postal_code', label: 'Postal code', type: 'text', source: 'added', max: 20 },
      { key: 'office_address', label: 'Full Office Address', type: 'textarea', required: true, source: 'screenshot', max: 500 },
      { key: 'website', label: 'Website (if available)', type: 'url', source: 'screenshot', max: 200 },
      { key: 'company_email', label: 'Company Email Address', type: 'email', required: true, source: 'screenshot', max: 200 },
      { key: 'contact_number', label: 'Official Contact Number', type: 'tel', required: true, source: 'screenshot' },
      { key: 'company_logo', label: 'Company Logo (Upload)', type: 'file', accept: ['image'], source: 'screenshot', hint: 'JPG or PNG, up to 5 MB.' },
    ],
  },
  {
    id: 'contact', title: 'Primary Contact Person',
    fields: [
      { key: 'contact_full_name', label: "Contact Person's Full Name", type: 'text', required: true, source: 'screenshot', max: 120 },
      { key: 'contact_designation', label: 'Designation', type: 'text', required: true, source: 'screenshot', max: 120 },
      { key: 'contact_email', label: 'Official Email ID', type: 'email', required: true, source: 'screenshot', max: 200 },
      { key: 'contact_mobile', label: 'Mobile Number / WhatsApp Number', type: 'tel', required: true, source: 'screenshot' },
      { key: 'contact_alternative', label: 'Alternative Contact Number', type: 'tel', source: 'screenshot' },
    ],
  },
  {
    id: 'business', title: 'Business Profile',
    fields: [
      { key: 'organisation_type', label: 'Type of Organisation', type: 'select', required: true, source: 'screenshot', options: ORGANISATION_TYPES },
      { key: 'organisation_type_other', label: 'Please specify', type: 'text', required: true, source: 'screenshot', max: 120, showWhen: { key: 'organisation_type', equals: 'Other' } },
      { key: 'primary_markets', label: 'Primary Recruitment Markets', type: 'textarea', required: true, source: 'screenshot', max: 1000, hint: 'Countries or regions your students come from.' },
      { key: 'countries_promoting', label: 'Countries Currently Promoting', type: 'textarea', required: true, source: 'screenshot', max: 1000, hint: 'Study destinations you send students to today.' },
      { key: 'countries_interested', label: 'Countries Interested in Promoting', type: 'textarea', required: true, source: 'screenshot', max: 1000 },
      { key: 'institutions_representing', label: 'Universities / Institutions Currently Representing', type: 'textarea', source: 'screenshot', max: 2000 },
      { key: 'avg_applications_per_intake', label: 'Average Student Applications Per Intake', type: 'count', source: 'screenshot' },
      { key: 'number_of_branches', label: 'Number of Branches', type: 'count', source: 'screenshot' },
      { key: 'number_of_counsellors', label: 'Number of Counsellors / Employees', type: 'count', source: 'screenshot' },
      { key: 'aggregator_partnerships', label: 'Existing Aggregator Partnerships (if any)', type: 'textarea', source: 'screenshot', max: 1000 },
    ],
  },
  {
    id: 'documents', title: 'Documents Upload', description: 'PDF, JPG or PNG, up to 10 MB each. Files are stored privately and only SSI GLOBAL can open them.',
    fields: [
      { key: 'doc_registration_certificate', label: 'Company Registration Certificate (if applicable)', type: 'file', accept: ['pdf', 'image'], source: 'screenshot' },
      { key: 'doc_business_licence', label: 'Business Licence (if applicable)', type: 'file', accept: ['pdf', 'image'], source: 'screenshot' },
      { key: 'doc_tax_gst', label: 'Tax Registration / GST Certificate (if applicable)', type: 'file', accept: ['pdf', 'image'], source: 'screenshot' },
      { key: 'doc_company_profile', label: 'Company Profile (PDF)', type: 'file', accept: ['pdf'], source: 'screenshot' },
      { key: 'doc_signatory_id', label: 'Authorised Signatory ID (if required)', type: 'file', accept: ['pdf', 'image'], source: 'screenshot' },
    ],
  },
  {
    id: 'login', title: 'Portal Login Details',
    description: 'The email address your Partner Admin will sign in with once SSI GLOBAL approves your registration. You set your own password at your first sign-in — no password is collected here.',
    fields: [
      { key: 'registered_email', label: 'Registered Email ID', type: 'email', required: true, source: 'screenshot', max: 200, hint: 'We send a 6-digit code to confirm this address.' },
    ],
  },
  {
    id: 'declaration', title: 'Declaration',
    fields: [
      { key: 'decl_accurate', label: 'I confirm that the information provided is accurate.', type: 'checkbox', required: true, source: 'screenshot' },
      { key: 'decl_terms', label: "I agree to SSI Global's Partner Terms & Conditions.", type: 'checkbox', required: true, source: 'screenshot' },
      { key: 'decl_guidelines', label: "I agree to comply with SSI Global's recruitment and application guidelines.", type: 'checkbox', required: true, source: 'screenshot' },
      { key: 'decl_consent', label: 'I consent to the processing of business contact information for partnership purposes.', type: 'checkbox', required: true, source: 'screenshot' },
      { key: 'decl_authorised', label: 'I am authorised to submit this registration on behalf of the company.', type: 'checkbox', required: true, source: 'added' },
      { key: 'decl_review', label: 'I understand that submitting this form is a partnership enquiry: it does not create a partnership agreement or give portal access until SSI GLOBAL approves it.', type: 'checkbox', required: true, source: 'added' },
      { key: 'acceptance_full_name', label: "Your full legal name", type: 'text', required: true, source: 'screenshot', max: 120 },
      { key: 'acceptance_designation', label: 'Designation', type: 'text', required: true, source: 'screenshot', max: 120 },
      { key: 'acceptance_signature', label: 'Digital signature (type your full name)', type: 'signature', required: true, source: 'screenshot', max: 120, hint: 'Must match your full legal name.' },
    ],
  },
];

export const ALL_FIELDS = FORM_SECTIONS.flatMap((s) => s.fields);
export const FILE_FIELDS = ALL_FIELDS.filter((f) => f.type === 'file').map((f) => f.key);
export const fieldByKey = new Map(ALL_FIELDS.map((f) => [f.key, f]));

export type Answers = Record<string, string | boolean | null>;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const TEL = /^\+?[0-9 ()-]{6,20}$/;

/** Keeps only known fields with safe types and lengths (never trusts the browser). */
export function sanitizeAnswers(input: unknown): Answers {
  const out: Answers = {};
  if (!input || typeof input !== 'object') return out;
  const src = input as Record<string, unknown>;
  for (const f of ALL_FIELDS) {
    if (f.locked || f.type === 'file') continue;
    const v = src[f.key];
    if (v === undefined || v === null) continue;
    if (f.type === 'checkbox') { out[f.key] = v === true; continue; }
    const s = String(v).replace(/\u0000/g, '').trim();
    if (!s) continue;
    out[f.key] = s.slice(0, f.max ?? (f.type === 'textarea' ? 2000 : 200));
  }
  return out;
}

const visible = (f: FormField, a: Answers) => !f.showWhen || a[f.showWhen.key] === f.showWhen.equals;

/** Field problems for one field (empty string = fine). */
export function fieldProblem(f: FormField, a: Answers, year = new Date().getUTCFullYear()): string {
  if (!visible(f, a) || f.locked || f.type === 'file') return '';
  const v = a[f.key];
  if (f.type === 'checkbox') return f.required && v !== true ? 'Please confirm' : '';
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return f.required ? 'Required' : '';
  if (f.type === 'email' && !EMAIL.test(s)) return 'Enter a valid email address';
  if (f.type === 'tel' && !TEL.test(s)) return 'Enter a valid phone number (digits, +, spaces)';
  if (f.type === 'url' && !/^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i.test(s)) return 'Enter a valid website';
  if (f.type === 'year' && !(/^\d{4}$/.test(s) && Number(s) >= 1900 && Number(s) <= year)) return `Enter a year between 1900 and ${year}`;
  if (f.type === 'count' && !(/^\d{1,6}$/.test(s))) return 'Enter a whole number';
  if (f.type === 'select' && f.options && !f.options.includes(s)) return 'Choose an option';
  if (f.type === 'signature') {
    const name = String(a.acceptance_full_name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (name && s.toLowerCase().replace(/\s+/g, ' ') !== name) return 'Type your full legal name exactly';
  }
  return '';
}

/** Every problem on the form, by field key. */
export function formProblems(a: Answers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of ALL_FIELDS) {
    const p = fieldProblem(f, a);
    if (p) out[f.key] = p;
  }
  return out;
}

export const sectionOf = (key: string) => FORM_SECTIONS.find((s) => s.fields.some((f) => f.key === key));
