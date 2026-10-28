// Domain model for the SSI GLOBAL CRM.
// These shapes map 1:1 to future database tables (e.g. Supabase), so the
// local store in src/store can later be swapped for API calls.

export type ID = string;

export type PartnerStatus = 'Active' | 'Onboarding' | 'Inactive';
export type PartnerTier = 'Platinum' | 'Gold' | 'Silver';

export interface Partner {
  id: ID;
  name: string;
  code: string;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  website?: string;
  status: PartnerStatus;
  tier: PartnerTier;
  branches: string[];
  joinedAt: string;
  commissionRate: number;
}

export type StudentStatus = 'Lead' | 'Active' | 'Enrolled' | 'On Hold';
export type StudyLevel = 'Foundation' | 'Diploma' | 'Undergraduate' | 'Postgraduate' | 'PhD';

export interface Student {
  id: ID;
  partnerId: ID;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dob: string;
  gender: 'Female' | 'Male' | 'Other';
  nationality: string;
  passportNo: string;
  address: string;
  qualification: string;
  institution: string;
  gpa: string;
  graduationYear: string;
  englishTest: 'IELTS' | 'PTE' | 'TOEFL' | 'Duolingo' | 'Not taken';
  englishScore: string;
  preferredCountries: string[];
  preferredLevel: StudyLevel;
  preferredIntake: string;
  budget: string;
  status: StudentStatus;
  createdAt: string;
}

export interface University {
  id: ID;
  name: string;
  country: string;
  city: string;
  ranking: number;
  type: 'Public' | 'Private';
  partnerSince: string;
  website: string;
}

export interface Course {
  id: ID;
  universityId: ID;
  name: string;
  level: StudyLevel;
  field: string;
  duration: string;
  tuition: number;
  currency: string;
  intakes: string[];
  ieltsMin: number;
}

export const APP_STATUSES = [
  'Draft',
  'Pending Assessment',
  'Submitted',
  'Offer Pending',
  'Conditional Offer',
  'Unconditional Offer',
  'Visa Lodged',
  'Visa Granted',
  'Visa Refused',
] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

export interface TimelineEntry {
  status: AppStatus;
  at: string;
  note?: string;
  by: string;
}

export interface ChecklistItem {
  label: string;
  done: boolean;
}

export interface Application {
  id: ID;
  ref: string;
  studentId: ID;
  partnerId: ID;
  universityId: ID;
  courseId: ID;
  intake: string;
  appliedAt: string;
  status: AppStatus;
  checklist: ChecklistItem[];
  timeline: TimelineEntry[];
}

export type DocStatus = 'Verified' | 'Pending' | 'Rejected';
export const DOC_TYPES = [
  'Passport',
  'Academic Transcript',
  'Degree Certificate',
  'English Test Result',
  'Statement of Purpose',
  'CV / Resume',
  'Letter of Recommendation',
  'Financial Documents',
  'Offer Letter',
  'Visa Document',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export interface DocumentRecord {
  id: ID;
  studentId: ID;
  partnerId: ID;
  name: string;
  type: DocType;
  fileName: string;
  size: number;
  uploadedAt: string;
  status: DocStatus;
}

export type AssessmentStatus = 'Pending' | 'In Review' | 'Eligible' | 'Not Eligible';

export interface Assessment {
  id: ID;
  studentId: ID;
  partnerId: ID;
  courseId: ID;
  status: AssessmentStatus;
  requestedAt: string;
  notes: string;
}

export type PaymentStatus = 'Paid' | 'Pending' | 'Overdue' | 'Partially Paid';
export type PaymentType = 'Application Fee' | 'Tuition Deposit' | 'Service Fee' | 'Commission';

export interface Payment {
  id: ID;
  invoiceNo: string;
  partnerId: ID;
  studentId?: ID;
  type: PaymentType;
  description: string;
  amount: number;
  paid: number;
  dueDate: string;
  status: PaymentStatus;
}

export type Priority = 'High' | 'Medium' | 'Normal';

export interface Task {
  id: ID;
  title: string;
  due: string;
  priority: Priority;
  done: boolean;
  assignee: string;
  related?: string;
}

export const UPDATE_CATEGORIES = [
  'Admissions',
  'Visa Updates',
  'Documentation',
  'Scholarships',
  'System Updates',
  'Events',
] as const;
export type UpdateCategory = (typeof UPDATE_CATEGORIES)[number];

export interface Announcement {
  id: ID;
  title: string;
  category: UpdateCategory;
  priority: Priority;
  body: string;
  published: boolean; // false = draft
  publishAt: string;
  expiresAt: string;
  createdAt: string;
  audience: 'all' | ID[];
}

export type DerivedUpdateStatus = 'Active' | 'Scheduled' | 'Expired' | 'Draft';

export interface Activity {
  id: ID;
  at: string;
  partnerId?: ID;
  kind: 'application' | 'status' | 'student' | 'document' | 'partner' | 'update' | 'assessment' | 'payment';
  title: string;
  detail: string;
}

export interface Session {
  role: 'admin' | 'client';
  partnerId?: ID;
  name: string;
  email: string;
  title: string;
  provider?: 'demo' | 'supabase';
  /** Set while an admin previews a partner's portal; holds the admin session to return to. */
  previewOf?: Session;
}

export interface DB {
  version: number;
  partners: Partner[];
  students: Student[];
  universities: University[];
  courses: Course[];
  applications: Application[];
  documents: DocumentRecord[];
  assessments: Assessment[];
  payments: Payment[];
  tasks: Task[];
  announcements: Announcement[];
  activities: Activity[];
  readAt: { admin: string; client: Record<ID, string> };
}
