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
  /** Super Admin controls (read-only for everyone else). */
  portalEnabled?: boolean;
  modules?: string[];
  archivedAt?: string | null;
  address?: string | null;
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
  active?: boolean;
  casDeposit?: string | null;
  paymentPlan?: string | null;
  moiAccepted?: string[];
  notes?: string | null;
  source?: string | null;
  updatedAt?: string;
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
  /** Labels of open intakes ("Jan 2027"), maintained by the database from course_intakes. */
  intakes: string[];
  ieltsMin: number;
  active?: boolean;
  faculty?: string | null;
  scholarship?: string | null;
  tuitionAfterScholarship?: number | null;
  earlyBird?: string | null;
  accommodation?: string | null;
  academicRequirement?: string | null;
  englishRequirement?: string | null;
  complianceRequirement?: string | null;
  courseRequirement?: string | null;
  documentsRequired?: string | null;
  source?: string | null;
  updatedAt?: string;
}

export type IntakeStatus = 'Available' | 'Upcoming' | 'Closed';

/** One intake of a course; editable by Admin without code changes. */
export interface CourseIntake {
  id: ID;
  courseId: ID;
  intakeMonth: number;
  intakeYear: number;
  inductionDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  applicationDeadline?: string | null;
  enrolmentDeadline?: string | null;
  status: IntakeStatus;
  active: boolean;
  notes?: string | null;
  source?: string | null;
  updatedAt?: string;
}

export interface BlacklistedInstitution {
  id: ID;
  name: string;
  source?: string | null;
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
  /** Employee responsible for this application. */
  assignedTo?: string | null;
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
  storagePath?: string;
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
  /** Employee the task is assigned to (they are notified). */
  assignedTo?: string | null;
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
  kind: 'application' | 'status' | 'student' | 'document' | 'partner' | 'update' | 'assessment' | 'payment' | 'task' | 'account';
  title: string;
  detail: string;
  refId?: string;
  /** Stamped by the database from the signed-in user — never supplied by the browser. */
  actorName?: string;
  actorRole?: string;
  actorOrg?: string;
  studentName?: string;
}

/** Per-user notification written by database triggers. */
export interface AppNotification {
  id: ID;
  createdAt: string;
  kind: string;
  title: string;
  body?: string | null;
  /** Portal-relative path, e.g. "applications?open=…". */
  link?: string | null;
  readAt?: string | null;
}

/** Active SSI GLOBAL employee (for assigning work). */
export interface StaffMember {
  id: string;
  fullName: string;
  role: UserRole;
  department?: string | null;
}

export type UserRole =
  | 'super_admin'
  | 'admin_staff'
  | 'application_manager'
  | 'assessment_staff'
  | 'finance_staff'
  | 'support_staff'
  | 'partner_admin'
  | 'partner_staff';

/**
 * The signed-in user, always derived from the server (Supabase Auth + profiles table).
 * It is held in memory only; the database enforces access regardless of this value.
 */
export interface Session {
  /** Which portal: Admin (Super Admin / Admin Staff), Staff (other employees) or Client (partners). */
  role: 'admin' | 'staff' | 'client';
  userRole: UserRole;
  userId: string;
  partnerId?: ID;
  name: string;
  email: string;
  title: string;
  /** Employee modules (server-computed). Empty for partner users. */
  permissions: string[];
  /** Modules enabled for the partner organisation (server-computed). */
  partnerModules: string[];
  /** Set while staff preview a partner's portal (UI only); holds the staff session to return to. */
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
  courseIntakes: CourseIntake[];
  blacklist: BlacklistedInstitution[];
  notifications: AppNotification[];
  staff: StaffMember[];
}
