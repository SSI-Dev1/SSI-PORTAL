// Realistic fictional demo data. Dates are generated relative to "now" so the
// demo always looks current. A seeded RNG keeps the data stable between resets.
import {
  APP_STATUSES,
  type Activity,
  type Announcement,
  type AppStatus,
  type Application,
  type Assessment,
  type Course,
  type DB,
  type DocType,
  type DocumentRecord,
  type Partner,
  type Payment,
  type Student,
  type StudyLevel,
  type Task,
  type University,
} from './types';

export const DB_VERSION = 4;

let seed = 20251028;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;

const DAY = 86400000;
export const daysFromNow = (d: number, hour = 10) => {
  const t = new Date(Date.now() + d * DAY);
  t.setHours(hour, int(0, 59), 0, 0);
  return t.toISOString();
};

export const INTAKES = ['Jan 2026', 'Feb 2026', 'May 2026', 'Jul 2026', 'Sep 2026', 'Jan 2027'];
export const COUNTRIES = ['Australia', 'United Kingdom', 'Canada', 'United States', 'New Zealand', 'Germany', 'Ireland'];

export const checklistTemplate = () => [
  { label: 'Passport copy', done: false },
  { label: 'Academic transcripts', done: false },
  { label: 'English test result', done: false },
  { label: 'Statement of purpose', done: false },
  { label: 'Letters of recommendation', done: false },
  { label: 'Financial documents', done: false },
];

const partners: Partner[] = [
  { id: 'p1', name: 'Horizon Edu Consultants', code: 'HEC', contactName: 'Meera Krishnan', email: 'meera@horizonedu.in', phone: '+91 98470 21234', city: 'Kochi', country: 'India', website: 'horizonedu.in', status: 'Active', tier: 'Platinum', branches: ['Kochi', 'Trivandrum', 'Calicut'], joinedAt: daysFromNow(-720), commissionRate: 15 },
  { id: 'p2', name: 'BrightPath Overseas', code: 'BPO', contactName: 'Rahul Verma', email: 'rahul@brightpath.co', phone: '+91 99860 44120', city: 'Bengaluru', country: 'India', website: 'brightpath.co', status: 'Active', tier: 'Gold', branches: ['Bengaluru', 'Mysuru'], joinedAt: daysFromNow(-540), commissionRate: 12 },
  { id: 'p3', name: 'Global Scholars Hub', code: 'GSH', contactName: 'Fatima Sheikh', email: 'fatima@globalscholars.ae', phone: '+971 50 214 8890', city: 'Dubai', country: 'UAE', website: 'globalscholars.ae', status: 'Active', tier: 'Gold', branches: ['Dubai', 'Sharjah'], joinedAt: daysFromNow(-410), commissionRate: 12 },
  { id: 'p4', name: 'Pinnacle Study Abroad', code: 'PSA', contactName: 'Anand Pillai', email: 'anand@pinnaclestudy.in', phone: '+91 94470 88213', city: 'Chennai', country: 'India', website: 'pinnaclestudy.in', status: 'Active', tier: 'Silver', branches: ['Chennai'], joinedAt: daysFromNow(-300), commissionRate: 10 },
  { id: 'p5', name: 'Nexus Education Partners', code: 'NEP', contactName: 'Sanjana Rao', email: 'sanjana@nexusedu.lk', phone: '+94 77 412 6620', city: 'Colombo', country: 'Sri Lanka', website: 'nexusedu.lk', status: 'Onboarding', tier: 'Silver', branches: ['Colombo'], joinedAt: daysFromNow(-40), commissionRate: 10 },
  { id: 'p6', name: 'EduBridge Global', code: 'EBG', contactName: 'Daniel Joseph', email: 'daniel@edubridge.np', phone: '+977 980 112 4455', city: 'Kathmandu', country: 'Nepal', website: 'edubridge.np', status: 'Active', tier: 'Gold', branches: ['Kathmandu', 'Pokhara'], joinedAt: daysFromNow(-260), commissionRate: 12 },
];

const universities: University[] = [
  { id: 'u1', name: 'University of Melbourne', country: 'Australia', city: 'Melbourne', ranking: 14, type: 'Public', partnerSince: '2019', website: 'unimelb.edu.au' },
  { id: 'u2', name: 'Monash University', country: 'Australia', city: 'Melbourne', ranking: 42, type: 'Public', partnerSince: '2018', website: 'monash.edu' },
  { id: 'u3', name: 'University of Sydney', country: 'Australia', city: 'Sydney', ranking: 18, type: 'Public', partnerSince: '2020', website: 'sydney.edu.au' },
  { id: 'u4', name: 'University of Manchester', country: 'United Kingdom', city: 'Manchester', ranking: 34, type: 'Public', partnerSince: '2019', website: 'manchester.ac.uk' },
  { id: 'u5', name: 'University of Leeds', country: 'United Kingdom', city: 'Leeds', ranking: 82, type: 'Public', partnerSince: '2021', website: 'leeds.ac.uk' },
  { id: 'u6', name: 'Coventry University', country: 'United Kingdom', city: 'Coventry', ranking: 520, type: 'Public', partnerSince: '2017', website: 'coventry.ac.uk' },
  { id: 'u7', name: 'University of Toronto', country: 'Canada', city: 'Toronto', ranking: 21, type: 'Public', partnerSince: '2020', website: 'utoronto.ca' },
  { id: 'u8', name: 'University of British Columbia', country: 'Canada', city: 'Vancouver', ranking: 38, type: 'Public', partnerSince: '2021', website: 'ubc.ca' },
  { id: 'u9', name: 'Humber College', country: 'Canada', city: 'Toronto', ranking: 0, type: 'Public', partnerSince: '2018', website: 'humber.ca' },
  { id: 'u10', name: 'Arizona State University', country: 'United States', city: 'Tempe', ranking: 179, type: 'Public', partnerSince: '2022', website: 'asu.edu' },
  { id: 'u11', name: 'Northeastern University', country: 'United States', city: 'Boston', ranking: 375, type: 'Private', partnerSince: '2021', website: 'northeastern.edu' },
  { id: 'u12', name: 'University of Auckland', country: 'New Zealand', city: 'Auckland', ranking: 65, type: 'Public', partnerSince: '2020', website: 'auckland.ac.nz' },
  { id: 'u13', name: 'Massey University', country: 'New Zealand', city: 'Palmerston North', ranking: 239, type: 'Public', partnerSince: '2022', website: 'massey.ac.nz' },
  { id: 'u14', name: 'Technical University of Munich', country: 'Germany', city: 'Munich', ranking: 28, type: 'Public', partnerSince: '2023', website: 'tum.de' },
  { id: 'u15', name: 'Trinity College Dublin', country: 'Ireland', city: 'Dublin', ranking: 87, type: 'Public', partnerSince: '2021', website: 'tcd.ie' },
];

const currencyFor: Record<string, string> = {
  Australia: 'AUD', 'United Kingdom': 'GBP', Canada: 'CAD', 'United States': 'USD', 'New Zealand': 'NZD', Germany: 'EUR', Ireland: 'EUR',
};

const courseCatalog: [string, StudyLevel, string, string][] = [
  ['Master of Data Science', 'Postgraduate', 'Computer Science & IT', '2 years'],
  ['Master of Business Administration (MBA)', 'Postgraduate', 'Business & Management', '2 years'],
  ['Bachelor of Computer Science', 'Undergraduate', 'Computer Science & IT', '3 years'],
  ['Master of Engineering (Civil)', 'Postgraduate', 'Engineering', '2 years'],
  ['Bachelor of Nursing', 'Undergraduate', 'Health & Medicine', '3 years'],
  ['MSc Artificial Intelligence', 'Postgraduate', 'Computer Science & IT', '1 year'],
  ['Master of Public Health', 'Postgraduate', 'Health & Medicine', '1.5 years'],
  ['Bachelor of Commerce', 'Undergraduate', 'Business & Management', '3 years'],
  ['Diploma in Hospitality Management', 'Diploma', 'Hospitality & Tourism', '1 year'],
  ['MSc Finance & Investment', 'Postgraduate', 'Business & Management', '1 year'],
  ['Foundation in Engineering', 'Foundation', 'Engineering', '1 year'],
  ['PhD in Biotechnology', 'PhD', 'Life Sciences', '3–4 years'],
  ['Master of Cyber Security', 'Postgraduate', 'Computer Science & IT', '2 years'],
  ['Postgraduate Diploma in Project Management', 'Diploma', 'Business & Management', '1 year'],
];

const courses: Course[] = [];
universities.forEach((u, ui) => {
  const count = 3 + (ui % 2);
  for (let k = 0; k < count; k++) {
    const [name, level, field, duration] = courseCatalog[(ui * 3 + k * 2) % courseCatalog.length];
    const base = level === 'Postgraduate' ? 38000 : level === 'Undergraduate' ? 32000 : level === 'PhD' ? 30000 : 18000;
    courses.push({
      id: `c${courses.length + 1}`,
      universityId: u.id,
      name,
      level,
      field,
      duration,
      tuition: u.country === 'Germany' ? int(1, 3) * 1500 : Math.round((base + int(-4000, 12000)) / 500) * 500,
      currency: currencyFor[u.country],
      intakes: INTAKES.filter((_, i) => (i + ui + k) % 2 === 0 || i === 4),
      ieltsMin: level === 'Postgraduate' || level === 'PhD' ? pick([6.5, 6.5, 7]) : pick([6, 6.5]),
    });
  }
});

const firstF = ['Aisha', 'Priya', 'Ananya', 'Sneha', 'Fathima', 'Nikita', 'Diya', 'Kavya', 'Riya', 'Sara', 'Neha', 'Lakshmi', 'Anjali', 'Shreya', 'Hiba'];
const firstM = ['Arjun', 'Rahul', 'Aditya', 'Vikram', 'Rohan', 'Karthik', 'Nikhil', 'Aman', 'Rizwan', 'Joel', 'Sidharth', 'Akash', 'Varun', 'Irfan', 'Dev'];
const lasts = ['Nair', 'Menon', 'Sharma', 'Pillai', 'Thomas', 'Reddy', 'Iyer', 'Khan', 'Joseph', 'Gupta', 'Varghese', 'Das', 'Kurian', 'Patel', 'Rao', 'George', 'Mathew'];
const quals = [
  ['B.Tech Computer Science', 'Undergraduate degree'],
  ['B.Com', 'Undergraduate degree'],
  ['Higher Secondary (Science)', 'Grade 12'],
  ['BBA', 'Undergraduate degree'],
  ['B.Sc Nursing', 'Undergraduate degree'],
  ['B.E Civil Engineering', 'Undergraduate degree'],
];
const institutions = ['Cochin University (CUSAT)', 'Anna University', 'University of Kerala', 'Christ University', 'St. Xavier’s College', 'Kathmandu University', 'Amity University'];
const nationalityFor: Record<string, string> = { India: 'Indian', UAE: 'Indian', 'Sri Lanka': 'Sri Lankan', Nepal: 'Nepalese' };

const students: Student[] = [];
const studentsPerPartner: Record<string, number> = { p1: 14, p2: 10, p3: 8, p4: 6, p5: 3, p6: 7 };
const usedNames = new Set<string>();
Object.entries(studentsPerPartner).forEach(([pid, n]) => {
  const partner = partners.find((p) => p.id === pid)!;
  for (let i = 0; i < n; i++) {
    const female = rand() > 0.5;
    let firstName = '';
    let lastName = '';
    do {
      firstName = pick(female ? firstF : firstM);
      lastName = pick(lasts);
    } while (usedNames.has(firstName + lastName));
    usedNames.add(firstName + lastName);
    const [qual] = pick(quals);
    const ug = qual.startsWith('Higher');
    const prefs = [pick(COUNTRIES)];
    if (rand() > 0.5) {
      const second = pick(COUNTRIES);
      if (!prefs.includes(second)) prefs.push(second);
    }
    const test = pick(['IELTS', 'IELTS', 'PTE', 'TOEFL', 'Not taken'] as const);
    students.push({
      id: `s${students.length + 1}`,
      partnerId: pid,
      firstName,
      lastName,
      email: `${firstName}.${lastName}`.toLowerCase() + '@mail.com',
      phone: partner.phone.slice(0, partner.phone.indexOf(' ') + 1) + int(70000, 99999) + ' ' + int(10000, 99999),
      dob: new Date(1998 + int(0, 7), int(0, 11), int(1, 28)).toISOString().slice(0, 10),
      gender: female ? 'Female' : 'Male',
      nationality: nationalityFor[partner.country] ?? 'Indian',
      passportNo: String.fromCharCode(65 + int(0, 25)) + int(1000000, 9999999),
      address: `${int(12, 240)}, ${pick(['MG Road', 'Park Avenue', 'Lake View', 'Temple Street', 'Marine Drive'])}, ${partner.city}`,
      qualification: qual,
      institution: pick(institutions),
      gpa: ug ? `${int(72, 96)}%` : `${(rand() * 2 + 7).toFixed(1)} CGPA`,
      graduationYear: String(int(2021, 2025)),
      englishTest: test,
      englishScore: test === 'IELTS' ? pick(['6.0', '6.5', '7.0', '7.5']) : test === 'PTE' ? String(int(58, 79)) : test === 'TOEFL' ? String(int(88, 110)) : '',
      preferredCountries: prefs,
      preferredLevel: ug ? 'Undergraduate' : 'Postgraduate',
      preferredIntake: pick(INTAKES.slice(0, 5)),
      budget: pick(['$20k – $30k', '$30k – $40k', '$40k+', '$15k – $20k']),
      status: pick(['Active', 'Active', 'Active', 'Lead', 'Enrolled', 'On Hold']),
      createdAt: daysFromNow(-int(5, 200)),
    });
  }
});

const statusWeights: AppStatus[] = [
  'Draft', 'Pending Assessment', 'Pending Assessment', 'Submitted', 'Submitted', 'Offer Pending', 'Offer Pending',
  'Conditional Offer', 'Conditional Offer', 'Unconditional Offer', 'Unconditional Offer', 'Visa Lodged', 'Visa Lodged',
  'Visa Granted', 'Visa Granted', 'Visa Granted', 'Visa Refused',
];

const actors = ['SSI Admissions', 'Partner Counsellor', 'SSI Visa Desk'];
const applications: Application[] = [];
students.forEach((s) => {
  if (s.status === 'Lead' && rand() > 0.3) return;
  const n = rand() > 0.6 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const country = i === 0 ? s.preferredCountries[0] : pick(COUNTRIES);
    const unis = universities.filter((u) => u.country === country);
    const uni = pick(unis);
    const uniCourses = courses.filter((c) => c.universityId === uni.id);
    const course = uniCourses.find((c) => c.level === s.preferredLevel) ?? pick(uniCourses);
    const status = pick(statusWeights);
    const stage = APP_STATUSES.indexOf(status);
    const appliedDaysAgo = int(3, 175);
    const path: AppStatus[] = APP_STATUSES.slice(0, Math.min(stage, 7) + 1).filter((st) => st !== 'Visa Granted' && st !== 'Visa Refused');
    if (status === 'Visa Granted' || status === 'Visa Refused') path.push(status);
    // Spread status changes between the application date and a recent "last touched" date.
    const lastDaysAgo = int(0, Math.min(appliedDaysAgo - 1, 45));
    const span = appliedDaysAgo - lastDaysAgo;
    const timeline = path.map((st, idx) => ({
      status: st,
      at: daysFromNow(-appliedDaysAgo + Math.round((idx * span) / Math.max(path.length - 1, 1)), 9 + idx),
      by: st === 'Draft' ? 'Partner Counsellor' : pick(actors),
      note: st === 'Conditional Offer' ? 'Offer subject to final transcripts.' : undefined,
    }));
    const doneCount = Math.min(6, stage + 1 + int(0, 2));
    applications.push({
      id: `a${applications.length + 1}`,
      ref: `SSI-${(24100 + applications.length * 7).toString()}`,
      studentId: s.id,
      partnerId: s.partnerId,
      universityId: uni.id,
      courseId: course.id,
      intake: pick(course.intakes),
      appliedAt: timeline[0].at,
      status,
      checklist: checklistTemplate().map((c, idx) => ({ ...c, done: idx < doneCount })),
      timeline,
    });
  }
});

const docTypes: DocType[] = ['Passport', 'Academic Transcript', 'English Test Result', 'Statement of Purpose', 'CV / Resume', 'Financial Documents', 'Offer Letter'];
const documents: DocumentRecord[] = [];
students.forEach((s) => {
  const n = int(1, 5);
  for (let i = 0; i < n; i++) {
    const type = docTypes[i];
    const ext = type === 'CV / Resume' || type === 'Statement of Purpose' ? 'docx' : 'pdf';
    documents.push({
      id: `d${documents.length + 1}`,
      studentId: s.id,
      partnerId: s.partnerId,
      name: `${type} — ${s.firstName} ${s.lastName}`,
      type,
      fileName: `${s.firstName}_${type.split(' ')[0]}.${ext}`.replace(/[^\w.]/g, '_'),
      size: int(180, 4200) * 1024,
      uploadedAt: daysFromNow(-int(1, 120)),
      status: pick(['Verified', 'Verified', 'Pending', 'Pending', 'Rejected']),
    });
  }
});

const assessments: Assessment[] = [];
students.slice(0).forEach((s) => {
  if (rand() > 0.55) return;
  const prefCourses = courses.filter((c) => {
    const u = universities.find((x) => x.id === c.universityId)!;
    return s.preferredCountries.includes(u.country);
  });
  const course = prefCourses.length ? pick(prefCourses) : pick(courses);
  const status = pick(['Pending', 'Pending', 'In Review', 'Eligible', 'Not Eligible'] as const);
  assessments.push({
    id: `as${assessments.length + 1}`,
    studentId: s.id,
    partnerId: s.partnerId,
    courseId: course.id,
    status,
    requestedAt: daysFromNow(-int(1, 40)),
    notes:
      status === 'Eligible'
        ? 'Meets academic and English requirements.'
        : status === 'Not Eligible'
          ? 'English score below minimum. Suggest pathway programme.'
          : '',
  });
});

const payments: Payment[] = [];
applications.forEach((a) => {
  if (rand() > 0.55) return;
  const type = pick(['Application Fee', 'Tuition Deposit', 'Service Fee'] as const);
  const amount = type === 'Application Fee' ? pick([150, 200, 250]) : type === 'Tuition Deposit' ? pick([5000, 7500, 10000]) : pick([500, 750, 1000]);
  const status = pick(['Paid', 'Paid', 'Pending', 'Overdue', 'Partially Paid'] as const);
  const s = students.find((x) => x.id === a.studentId)!;
  payments.push({
    id: `pay${payments.length + 1}`,
    invoiceNo: `INV-${(5100 + payments.length).toString()}`,
    partnerId: a.partnerId,
    studentId: a.studentId,
    type,
    description: `${type} — ${s.firstName} ${s.lastName}`,
    amount,
    paid: status === 'Paid' ? amount : status === 'Partially Paid' ? Math.round(amount / 2) : 0,
    dueDate: daysFromNow(status === 'Overdue' ? -int(3, 20) : int(-30, 30)),
    status,
  });
});
partners.forEach((p) => {
  payments.push({
    id: `pay${payments.length + 1}`,
    invoiceNo: `COM-${(800 + payments.length).toString()}`,
    partnerId: p.id,
    type: 'Commission',
    description: `Commission payout — ${p.name}`,
    amount: int(2, 9) * 1000,
    paid: 0,
    dueDate: daysFromNow(int(5, 25)),
    status: 'Pending',
  });
});

const tasks: Task[] = [
  { id: 't1', title: 'Review pending assessments for July intake', due: daysFromNow(0, 15), priority: 'High', done: false, assignee: 'Admissions Team', related: 'Assessments' },
  { id: 't2', title: 'Follow up Monash CAS deadline with BrightPath', due: daysFromNow(1), priority: 'High', done: false, assignee: 'Aisha Rahman', related: 'BrightPath Overseas' },
  { id: 't3', title: 'Onboarding call — Nexus Education Partners', due: daysFromNow(2, 11), priority: 'Medium', done: false, assignee: 'Partner Success', related: 'Nexus Education Partners' },
  { id: 't4', title: 'Publish UK visa financial requirement update', due: daysFromNow(3), priority: 'Medium', done: false, assignee: 'Aisha Rahman' },
  { id: 't5', title: 'Reconcile September commission invoices', due: daysFromNow(5), priority: 'Normal', done: false, assignee: 'Finance' },
  { id: 't6', title: 'University of Toronto webinar prep', due: daysFromNow(7), priority: 'Normal', done: false, assignee: 'Marketing' },
  { id: 't7', title: 'Verify passport scans uploaded this week', due: daysFromNow(-1), priority: 'High', done: true, assignee: 'Documents Desk' },
  { id: 't8', title: 'Send quarterly report to partners', due: daysFromNow(-3), priority: 'Normal', done: true, assignee: 'Aisha Rahman' },
];

const announcements: Announcement[] = [
  { id: 'n1', title: 'Australia July 2026 Intake Now Open', category: 'Admissions', priority: 'High', body: 'Applications are now open for the July 2026 intake at our partner universities across Australia, including Melbourne, Monash and Sydney. Submit early to secure priority assessment.', published: true, publishAt: daysFromNow(-8), expiresAt: daysFromNow(40), createdAt: daysFromNow(-9), audience: 'all' },
  { id: 'n2', title: 'UK Student Visa Financial Requirements Updated', category: 'Visa Updates', priority: 'Medium', body: 'UKVI has revised the maintenance funds requirement for student visa applicants. Please review the updated checklist before lodging new applications.', published: true, publishAt: daysFromNow(-10), expiresAt: daysFromNow(20), createdAt: daysFromNow(-11), audience: 'all' },
  { id: 'n3', title: 'Canada Study Permit Document Checklist Revised', category: 'Documentation', priority: 'Normal', body: 'We have updated the SOP guidelines and document checklist for Canadian study permit applications, including the new provincial attestation letter (PAL) requirement.', published: true, publishAt: daysFromNow(-13), expiresAt: daysFromNow(17), createdAt: daysFromNow(-13), audience: 'all' },
  { id: 'n4', title: 'Germany Master’s Scholarship Opportunities', category: 'Scholarships', priority: 'High', body: 'New merit scholarships are available for Master’s programmes at TU Munich for the Winter 2026 intake. Eligible students should apply before the priority deadline.', published: true, publishAt: daysFromNow(4), expiresAt: daysFromNow(34), createdAt: daysFromNow(-2), audience: 'all' },
  { id: 'n5', title: 'Scheduled System Maintenance', category: 'System Updates', priority: 'Normal', body: 'The partner portal will be briefly unavailable on Saturday from 11:00 PM to 2:00 AM IST for scheduled maintenance.', published: false, publishAt: daysFromNow(6), expiresAt: daysFromNow(8), createdAt: daysFromNow(-1), audience: 'all' },
  { id: 'n6', title: 'Partner Excellence Awards 2025 — Winners', category: 'Events', priority: 'Normal', body: 'Congratulations to all partners recognised at the annual Partner Excellence Awards. Thank you for an outstanding year.', published: true, publishAt: daysFromNow(-60), expiresAt: daysFromNow(-20), createdAt: daysFromNow(-61), audience: 'all' },
  { id: 'n7', title: 'Kerala Region: Monash Spot-Admission Day', category: 'Events', priority: 'Medium', body: 'Monash University representatives will be at our Kochi office for on-the-spot assessments. Book your students’ slots through SSI Admissions.', published: true, publishAt: daysFromNow(-3), expiresAt: daysFromNow(12), createdAt: daysFromNow(-4), audience: ['p1'] },
];

const stuName = (id: string) => {
  const s = students.find((x) => x.id === id)!;
  return `${s.firstName} ${s.lastName}`;
};
const activities: Activity[] = applications
  .slice()
  .sort((a, b) => b.timeline[b.timeline.length - 1].at.localeCompare(a.timeline[a.timeline.length - 1].at))
  .slice(0, 18)
  .map((a, i) => {
    const last = a.timeline[a.timeline.length - 1];
    const uni = universities.find((u) => u.id === a.universityId)!;
    return {
      id: `ac${i + 1}`,
      at: last.at,
      partnerId: a.partnerId,
      kind: a.timeline.length === 1 ? 'application' : 'status',
      title: a.timeline.length === 1 ? 'New application created' : `Status changed to ${last.status}`,
      detail: `${stuName(a.studentId)} · ${uni.name}`,
    } satisfies Activity;
  });

export function createSeed(): DB {
  return JSON.parse(
    JSON.stringify({
      version: DB_VERSION,
      partners,
      students,
      universities,
      courses,
      applications,
      documents,
      assessments,
      payments,
      tasks,
      announcements,
      activities,
      readAt: '',
    } satisfies DB),
  );
}
