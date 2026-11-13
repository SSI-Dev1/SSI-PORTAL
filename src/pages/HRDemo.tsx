// Development-only harness (route #/ui/hr/<page>): the real employee and HR pages rendered with
// clearly fake sample data and an in-memory "server", to check layout and interactions.
// Business rules are tested against PostgreSQL in supabase/tests/70_hr_tests.sql.
import { useMemo, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { StoreContext, type StoreValue } from '../store/store';
import { HRContext, type HRData, type HRValue } from '../store/hr';
import type { DB, Session } from '../data/types';
import { addDays, companyDate } from '../data/hr';
import WorkDashboard from './work/WorkDashboard';
import MyReport from './work/MyReport';
import MyAttendance from './work/MyAttendance';
import MyLeave from './work/MyLeave';
import Holidays from './work/Holidays';
import Team from './work/Team';
import HRDashboard from './hr/HRDashboard';
import Employees from './hr/Employees';
import WorkReports from './hr/WorkReports';
import HRLeave from './hr/HRLeave';
import { HRSettings } from './hr/HRMisc';
import { Departments, Designations } from './hr/OrgStructure';
import { AttendanceExceptions, LeaveCalendar, WorkforceCalendar, type WorkforceDay } from './hr/HRCalendars';
import { CompanyAssets, EmployeeDocuments, MyAssignedTasks, MyDocumentsAndAssets, WorkAssignments } from './hr/HRWork';
import { HRReports } from './hr/HRMisc';
import Management from './hr/Management';
import { MyDocuments, MyTeamMembers } from './work/SelfService';
import Commissions from './shared/Commissions';
import { CommissionDemo, type CommissionData } from '../lib/commissions';
import { AgencyDemo, type AgencyData } from '../lib/agencies';
import Agencies from './shared/Agencies';
import AgencyDetail from './shared/AgencyDetail';
import PartnershipDashboard from './shared/PartnershipDashboard';
import { AttendanceControl } from '../components/AttendanceControl';
import HRAttendance from './hr/HRAttendance';

const T = companyDate();
const ME = 'demo-mgr';
const at = (d: string, t: string) => new Date(`${d}T${t}:00+05:30`).toISOString();

function sample(): HRData {
  const person = (id: string, fullName: string, code: string, designationId: string, manager: string | null, status: 'Active' | 'Probation' = 'Active') =>
    ({ id, fullName, employeeCode: code, designationId, departmentId: designationId.startsWith('partner') ? 'partnerships' : 'applications', reportingManagerId: manager, employmentStatus: status, accountStatus: 'active', role: 'support_staff' });
  const directory = [
    person(ME, 'Manu Manager (sample)', 'DEMO-1', 'senior_international_recruitment_manager', null),
    person('demo-po', 'Priya Partnerships (sample)', 'DEMO-2', 'partnership_officer', ME, 'Probation'),
    person('demo-app', 'Arun Applications (sample)', 'DEMO-3', 'application_team', ME),
  ];
  const templates = [{
    id: 'senior_recruitment_manager', version: 1, name: 'Senior International Recruitment Manager — Daily Work Report', active: true,
    sections: [
      { id: 'development', title: 'Partner Development', fields: [{ key: 'pd_new_partners_contacted', label: 'New partners contacted', type: 'count' }, { key: 'pd_partners_onboarded', label: 'Partners onboarded', type: 'count' }] },
      { id: 'summary', title: 'Daily Summary', fields: [{ key: 'achievements', label: 'Key Achievements', type: 'text' }, { key: 'tomorrow_plan', label: "Tomorrow's Plan", type: 'text' }] },
    ],
  }, {
    id: 'partnership_officer', version: 1, name: 'Partnership Officer — Daily Work Report', active: true,
    sections: [{ id: 'outreach', title: 'Partner Outreach & Onboarding', fields: [{ key: 'po_new_partners_contacted', label: 'New partners contacted', type: 'count' }, { key: 'po_mous_signed', label: 'MOUs signed', type: 'count' }] },
      { id: 'updates', title: 'Key Updates', fields: [{ key: 'achievements', label: "Today's Achievements", type: 'text' }] }],
  }] as HRData['templates'];
  const day = (id: string, emp: string, d: string, inT: string, outT: string | null, brk: number, late = false) => {
    const effIn = at(d, inT);
    const effOut = outT ? at(d, outT) : null;
    const gross = effOut ? (new Date(effOut).getTime() - new Date(effIn).getTime()) / 60000 : (Date.now() - new Date(effIn).getTime()) / 60000;
    return { id, employeeId: emp, workDate: d, punchInAt: effIn, punchOutAt: effOut, correctedInAt: null, correctedOutAt: null, effIn, effOut, closedReason: null, source: 'punch' as const,
      locationStatusIn: 'captured', locationStatusOut: outT ? 'denied' : null, locationVerifiedAt: null, earlyCheckoutId: null, state: (outT ? 'Checked Out' : 'Checked In') as 'Checked Out',
      grossMinutes: Math.round(gross), breakMinutes: brk, netMinutes: Math.round(gross - brk), requiredMinutes: 480, late, earlyCheckout: !!outT && gross - brk < 480, updatedAt: effIn,
      shortMinutes: outT ? Math.max(0, 480 - Math.round(gross - brk)) : null, extraMinutes: outT ? Math.max(0, Math.round(gross - brk) - 480) : null,
      reopenedAt: null, reopenedBy: null, reopenReason: null, previousPunchOutAt: null,
      cutoffAt: new Date(new Date(`${d}T00:00:00+05:30`).getTime() + 86_400_000).toISOString(), autoClosedAt: null, closureNote: null,
      reviewStatus: null, outKind: (outT ? 'manual' : null) as 'manual' | null, recordedMinutes: null, unverifiedMinutes: 0, correctionPending: false };
  };
  return {
    employees: directory.map((p) => ({ id: p.id, employeeCode: p.employeeCode, designationId: p.designationId, additionalDesignations: [], departmentId: p.departmentId, reportingManagerId: p.reportingManagerId, joiningDate: '2025-01-06', employmentStatus: p.employmentStatus, probationEndDate: null, dateOfBirth: null, shiftId: 'standard', workLocation: 'Kochi', updatedAt: T })),
    directory,
    departments: [{ id: 'partnerships', name: 'Partnerships', active: true }, { id: 'applications', name: 'Applications', active: true }],
    designations: [
      { id: 'senior_international_recruitment_manager', name: 'Senior International Recruitment Manager', departmentId: 'partnerships', reportTemplate: 'senior_recruitment_manager', workspace: 'x', defaultRole: 'application_manager', defaultPermissions: null, active: true },
      { id: 'partnership_officer', name: 'Partnership Officer', departmentId: 'partnerships', reportTemplate: 'partnership_officer', workspace: 'x', defaultRole: 'support_staff', defaultPermissions: null, active: true },
      { id: 'application_team', name: 'Application Team', departmentId: 'applications', reportTemplate: 'application_team', workspace: 'x', defaultRole: 'application_manager', defaultPermissions: null, active: true },
    ],
    shifts: [{ id: 'standard', name: 'Standard (Mon–Sat, 8 hours)', flexible: false, startTime: '09:30:00', endTime: '18:30:00', graceMinutes: 15, requiredMinutes: 480, workingDays: [1, 2, 3, 4, 5, 6], unpaidBreaks: true, active: true }],
    salaries: [],
    settings: [{ key: 'location_policy', value: 'optional', label: null }, { key: 'early_checkout_monthly_limit', value: 2, label: null }, { key: 'leave_approval', value: 'manager_or_hr', label: null }, { key: 'saturday_offs_per_month', value: 1, label: null }, { key: 'leave_year_start_month', value: 1, label: null }, { key: 'location_retention_days', value: 180, label: null }, { key: 'leave_counts_non_working_days', value: false, label: null }],
    attendance: [day('a1', ME, T, '09:20', null, 15), day('a2', 'demo-po', T, '09:52', null, 0, true), day('a3', ME, addDays(T, -1), '09:25', '18:40', 60), day('a4', 'demo-app', addDays(T, -1), '10:05', '17:10', 45, true),
      // Forgot to clock out: closed at midnight by the server, waiting for review.
      { ...day('a5', 'demo-po', addDays(T, -2), '10:00', null, 0), state: 'Auto Clock-Out' as const, closedReason: 'auto_midnight', grossMinutes: null, netMinutes: 0,
        autoClosedAt: at(addDays(T, -1), '00:00'), closureNote: 'Missed Manual Clock-Out — System Auto-Closed', reviewStatus: 'pending_review' as const,
        outKind: 'auto' as const, recordedMinutes: 840, unverifiedMinutes: 840 }],
    breaks: [{ id: 'b1', sessionId: 'a1', startAt: at(T, '11:00'), endAt: at(T, '11:15') }],
    corrections: [{ id: 'c1', employeeId: 'demo-app', workDate: addDays(T, -2), correctionType: 'missed_punch_out', requestedInAt: null, requestedOutAt: at(addDays(T, -2), '18:35'), requestedBreakMinutes: null, reason: 'Forgot after client call (sample)', details: null, status: 'Pending', original: { punch_in_at: at(addDays(T, -2), '09:30'), punch_out_at: null }, applied: null, decidedBy: null, decidedAt: null, decisionComment: null, createdAt: T }],
    earlyCheckouts: [{ id: 'e1', employeeId: 'demo-po', workDate: T, requestedTime: at(T, '15:30'), reason: 'Family emergency (sample)', status: 'Pending', decidedBy: null, decidedAt: null, decisionComment: null, override: false, overrideReason: null, actualCheckoutAt: null, createdAt: T }],
    leaveTypes: [{ id: 'paid', name: 'Paid Leave', annualDays: 12, carryForward: true, carryForwardMax: null, accrual: 'upfront', prorateNewJoiners: false, eligibleAfterDays: 0, requiresReason: true, active: true },
      { id: 'sick', name: 'Sick Leave', annualDays: 12, carryForward: false, carryForwardMax: null, accrual: 'upfront', prorateNewJoiners: false, eligibleAfterDays: 0, requiresReason: true, active: true }],
    leaveRequests: [{ id: 'l1', employeeId: 'demo-po', leaveType: 'paid', startDate: addDays(T, 9), endDate: addDays(T, 10), days: 2, reason: 'Wedding (sample)', status: 'Pending', managerApprovedBy: null, managerApprovedAt: null, decidedBy: null, decidedAt: null, decisionComment: null, createdAt: T }],
    balances: directory.flatMap((p) => [
      { employeeId: p.id, leaveType: 'paid', name: 'Paid Leave', leaveYear: Number(T.slice(0, 4)), entitled: 12, carried: 3, accrued: 12, adjusted: 0, used: 2, pending: p.id === 'demo-po' ? 2 : 0, available: p.id === 'demo-po' ? 11 : 13 },
      { employeeId: p.id, leaveType: 'sick', name: 'Sick Leave', leaveYear: Number(T.slice(0, 4)), entitled: 12, carried: 0, accrued: 12, adjusted: 0, used: 1, pending: 0, available: 11 },
    ]),
    holidays: [{ id: 'h1', holidayDate: addDays(T, 6), name: 'Sample Festival', kind: 'Public', locations: [], departmentIds: [], active: true }],
    calendar: [],
    reports: [{ id: 'r1', employeeId: 'demo-po', templateId: 'partnership_officer', templateVersion: 1, designationId: 'partnership_officer', departmentId: 'partnerships', managerId: ME, reportDate: T, status: 'Submitted', metrics: { po_new_partners_contacted: 6, po_mous_signed: 1 }, notes: { achievements: 'Signed MOU with a sample agency.' }, sources: {}, submittedAt: at(T, '17:45'), reviewedBy: null, reviewedAt: null, reviewComment: null, createdAt: T, updatedAt: T }],
    templates,
    myTemplates: [{ ...templates[0], designationId: 'senior_international_recruitment_manager', designation: 'Senior International Recruitment Manager' }],
    activities: [
      { id: '1', employeeId: ME, designationId: 'senior_international_recruitment_manager', activityType: 'partner_onboarded', source: 'crm', entityType: 'partner', entityId: 'p1', applicationId: null, studentId: null, partnerId: 'p1', quantity: 1, fromStatus: null, toStatus: null, note: null, occurredAt: at(T, '11:05'), reportDate: T, voidedAt: null, voidedBy: null, voidReason: null },
      { id: '2', employeeId: ME, designationId: 'senior_international_recruitment_manager', activityType: 'partner_contact', source: 'logged', entityType: null, entityId: null, applicationId: null, studentId: null, partnerId: null, quantity: 3, fromStatus: null, toStatus: null, note: 'Agencies in Kochi (sample)', occurredAt: at(T, '12:40'), reportDate: T, voidedAt: null, voidedBy: null, voidReason: null },
    ],
    activityTypes: [
      { id: 'partner_onboarded', label: 'Partner added to the CRM', source: 'crm', description: 'You added a partner organisation', sort: 24 },
      { id: 'partner_contact', label: 'New partner contacted', source: 'logged', description: null, sort: 40 },
    ],
    metricSources: [
      { templateId: 'senior_recruitment_manager', fieldKey: 'pd_new_partners_contacted', kind: 'activity', activityTypes: ['partner_contact'], workload: null },
      { templateId: 'senior_recruitment_manager', fieldKey: 'pd_partners_onboarded', kind: 'activity', activityTypes: ['partner_onboarded'], workload: null },
    ],
    assignments: [
      { id: 't1', kind: 'assignment', title: 'Prepare partner pitch deck (sample)', description: 'For the roadshow', assignedTo: 'demo-po', assignedBy: ME, priority: 'High', due: at(addDays(T, 5), '18:00'), startDate: T, status: 'In Progress', progress: 40, completedAt: null, lastNote: 'Outline done', createdAt: T, updatedAt: T },
      { id: 't2', kind: 'assignment', title: 'Chase pending CAS letters (sample)', description: null, assignedTo: 'demo-app', assignedBy: ME, priority: 'Medium', due: at(addDays(T, -1), '18:00'), startDate: null, status: 'Not Started', progress: 0, completedAt: null, lastNote: null, createdAt: T, updatedAt: T },
      { id: 't3', kind: 'assignment', title: 'Weekly pipeline review (sample)', description: null, assignedTo: ME, assignedBy: 'demo-hr', priority: 'Normal', due: at(addDays(T, 2), '18:00'), startDate: null, status: 'Not Started', progress: 0, completedAt: null, lastNote: null, createdAt: T, updatedAt: T },
    ],
    assets: [
      { id: 'as1', assetTag: 'LAP-001', name: 'Laptop 14" (sample)', category: 'Laptop', serialNumber: 'SAMPLE-123', status: 'Assigned', purchaseDate: '2025-04-01', warrantyUntil: '2027-04-01', notes: null, createdAt: T, updatedAt: T },
      { id: 'as2', assetTag: 'MON-004', name: 'Monitor 24" (sample)', category: 'Monitor', serialNumber: null, status: 'Available', purchaseDate: null, warrantyUntil: null, notes: null, createdAt: T, updatedAt: T },
    ],
    assetAssignments: [{ id: 'aa1', assetId: 'as1', employeeId: 'demo-po', issuedOn: addDays(T, -40), expectedReturn: null, returnedOn: null, conditionOut: 'New', conditionIn: null, notes: null, issuedBy: ME, returnedBy: null }],
    documents: [{ id: 'd2', employeeId: ME, category: 'Qualification', title: 'MBA certificate (sample)', fileName: 'mba.pdf', size: 80400, mime: 'application/pdf', storagePath: `${ME}/d2.pdf`, visibleToEmployee: true, status: 'Active', expiresOn: null, uploadedBy: ME, uploadedAt: at(addDays(T, -2), '10:00'), archivedBy: null, archivedAt: null, archiveReason: null, source: 'employee', reviewStatus: 'Pending Review', reviewNote: null },
      { id: 'd3', employeeId: ME, category: 'Offer Letter', title: 'Offer letter (sample)', fileName: 'offer.pdf', size: 90400, mime: 'application/pdf', storagePath: `${ME}/d3.pdf`, visibleToEmployee: true, status: 'Active', expiresOn: null, uploadedBy: 'demo-hr', uploadedAt: at(addDays(T, -60), '10:00'), archivedBy: null, archivedAt: null, archiveReason: null, source: 'hr', reviewStatus: null },
      { id: 'd1', employeeId: 'demo-po', category: 'Offer Letter', title: 'Offer letter (sample)', fileName: 'offer.pdf', size: 120400, mime: 'application/pdf', storagePath: 'demo-po/d1.pdf', visibleToEmployee: true, status: 'Active', expiresOn: null, uploadedBy: ME, uploadedAt: at(addDays(T, -30), '11:00'), archivedBy: null, archivedAt: null, archiveReason: null }],
  } as HRData;
}

const PAGES: [string, string, React.ReactNode][] = [
  ['work', 'Employee dashboard', <WorkDashboard key="w" />], ['report', 'Daily report', <MyReport key="r" />], ['attendance', 'My attendance', <MyAttendance key="a" />],
  ['leave', 'My leave', <MyLeave key="l" />], ['team', 'Team', <Team key="t" />], ['holidays', 'Holidays', <Holidays key="h" />],
  ['hr', 'HR dashboard', <HRDashboard key="hd" />], ['employees', 'Employees', <Employees key="e" />], ['hr-attendance', 'HR attendance', <HRAttendance key="ha" />],
  ['hr-leave', 'HR leave', <HRLeave key="hl" />], ['reports', 'Work reports', <WorkReports key="wr" />], ['settings', 'HR settings', <HRSettings key="s" />],
  ['departments', 'Departments', <Departments key="dp" />], ['exceptions', 'Exceptions', <AttendanceExceptions key="ex" />], ['leave-calendar', 'Leave calendar', <LeaveCalendar key="lc" />], ['workforce', 'Workforce calendar', <WorkforceCalendar key="wf" />], ['work-assign', 'Work assignment', <WorkAssignments key="wa" />], ['my-tasks', 'My tasks', <MyAssignedTasks key="mt" />], ['assets', 'Assets', <CompanyAssets key="as" />], ['documents', 'Documents', <EmployeeDocuments key="dc" />], ['my-docs', 'My docs & assets', <MyDocumentsAndAssets key="md" />], ['reports-hr', 'HR reports', <HRReports key="hrr" />], ['management', 'Management', <Management key="mg" />], ['my-documents', 'My documents', <MyDocuments key="mdx" />], ['team-members', 'Team members', <MyTeamMembers key="tm" />], ['commissions', 'Commissions', <Commissions key="cm" />], ['partnership', 'Partnership dashboard', <PartnershipDashboard key="pd" />], ['agencies', 'Agencies', <Agencies key="ag" />], ['designations', 'Designations', <Designations key="dg" />],
];

// Clearly fake commission data (not from any real agreement) for layout checks only.
const COMMISSION_SAMPLE: CommissionData = {
  countries: [{ id: 'sampleland', name: 'Sampleland', active: true }],
  providers: [{ id: 'pv1', name: 'SAMPLE PORTAL', notes: null, active: true }],
  tiers: [{ id: 'tier_1', label: 'Tier 1', description: null, sort: 1, active: true }, { id: 'tier_2', label: 'Tier 2', description: null, sort: 2, active: true }, { id: 'tier_3', label: 'Tier 3', description: null, sort: 3, active: true }],
  records: [
    { id: 'cr1', sourceKey: 'demo1', countryId: 'sampleland', universityName: 'Sample University (demo)', universityId: null, intake: 'January 2099', studyLevel: null, variant: null, studentMarket: 'Demo', route: 'portal', providerId: 'pv1', providerLabel: 'SAMPLE PORTAL', currency: null, conditions: null, effectiveFrom: null, effectiveTo: null, status: 'active', needsReview: false, reviewNotes: null, sourceSheet: 'Demo', sourceRow: 2, updatedAt: '' },
    { id: 'cr2', sourceKey: 'demo2', countryId: 'sampleland', universityName: 'Example College (demo)', universityId: null, intake: null, studyLevel: 'UG', variant: null, studentMarket: 'Demo', route: 'direct', providerId: null, providerLabel: null, currency: 'XXX', conditions: null, effectiveFrom: null, effectiveTo: null, status: 'active', needsReview: true, reviewNotes: 'Demo review note', sourceSheet: 'Demo', sourceRow: 3, updatedAt: '' },
  ],
  rates: [
    { recordId: 'cr1', tierId: 'tier_1', rawValue: '0.1', valueKind: 'percent', value: '10', currency: null, note: null, needsReview: false },
    { recordId: 'cr1', tierId: 'tier_2', rawValue: '0.09', valueKind: 'percent', value: '9', currency: null, note: null, needsReview: false },
    { recordId: 'cr1', tierId: 'tier_3', rawValue: '0.08', valueKind: 'percent', value: '8', currency: null, note: null, needsReview: false },
    { recordId: 'cr2', tierId: 'tier_1', rawValue: '1000', valueKind: 'amount', value: '1000', currency: 'XXX', note: null, needsReview: false },
    { recordId: 'cr2', tierId: 'tier_2', rawValue: '9.0', valueKind: 'unclear', value: null, currency: null, note: 'A plain number', needsReview: true },
  ],
  internal: [{ recordId: 'cr1', receivedRaw: '0.12', receivedKind: 'percent', receivedValue: '12', marginRaw: '0.02', marginKind: 'percent', marginValue: '2', internalNotes: null, sourceRow: { '(column A)': 'Sample University (demo)', PORTAL: 'SAMPLE PORTAL' } }],
  assignments: [{ id: 'pa1', partnerId: 'demo-partner', recordId: 'cr1', tierId: 'tier_2', isCustom: false, customKind: null, customValue: null, customCurrency: null, partnerConditions: null, internalRemarks: null, validFrom: null, validTo: null, status: 'pending_approval', replacesId: null, assignedBy: ME, assignedAt: new Date().toISOString(), updatedBy: null, updatedAt: '', decidedBy: null, decidedAt: null, decisionNote: null }],
  history: [], imports: [],
};

// Clearly fake agency data (no real agency or person) for layout checks only.
const d = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const AGENCY_SAMPLE: AgencyData = {
  agencies: [
    { id: 'ag1', reference: 'AG-26-DEMO01', company_name: 'Sample Agency A (demo)', contact_name: 'Sample Contact', phone: '+00 0000 000001', email: 'a@example.test', country: 'Sampleland',
      notes: 'Met at a sample fair.', contact_status: 'connected', contact_changed_by: ME, contact_changed_at: d(3), first_connected_at: d(3), stage: 'proposal_sent', stage_changed_at: d(1),
      assigned_officer: ME, last_contact_at: d(1), next_follow_up: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), selected_tier: 'Tier 1', registration_id: null,
      partner_id: null, created_by: ME, created_at: d(5), updated_at: d(1), stage_changed_by: ME } as never,
    { id: 'ag2', reference: 'AG-26-DEMO02', company_name: null, contact_name: null, phone: '+00 0000 000002', email: null, country: null, notes: null, contact_status: 'not_connected',
      contact_changed_by: ME, contact_changed_at: d(2), first_connected_at: null, stage: 'new_prospect', stage_changed_at: null, assigned_officer: ME, last_contact_at: null,
      next_follow_up: null, selected_tier: null, registration_id: null, partner_id: null, created_by: ME, created_at: d(2), updated_at: d(2) } as never,
    { id: 'ag3', reference: 'AG-26-DEMO03', company_name: 'Sample Agency C (demo)', contact_name: 'Other Contact', phone: null, email: 'c@example.test', country: 'Sampleland', notes: null,
      contact_status: 'connected', contact_changed_by: ME, contact_changed_at: d(20), first_connected_at: d(20), stage: 'onboarded', stage_changed_at: d(4), assigned_officer: ME,
      last_contact_at: d(6), next_follow_up: null, selected_tier: 'Tier 2', registration_id: 'reg-demo', partner_id: 'demo-partner', created_by: ME, created_at: d(30), updated_at: d(4) } as never,
  ].concat([
    { id: 'ag4', reference: 'AG-26-DEMO04', company_name: 'Sample Imported Agency (demo)', contact_name: null, phone: '9876500000', email: null, country: null, notes: null,
      contact_status: 'unknown', contact_changed_by: null, contact_changed_at: null, first_connected_at: null, stage: 'onboarded', stage_changed_at: null, assigned_officer: null,
      last_contact_at: null, next_follow_up: null, selected_tier: null, registration_id: null, partner_id: null, created_by: ME, created_at: d(0), updated_at: d(0),
      source: 'import', source_row: 7, source_status: 'Onboarded', historical_onboarded: true, needs_reconciliation: true,
      reconciliation_note: 'Onboarded in the sheet; no matching partner account — check before treating as active' } as never,
  ]),
  proposals: [{ id: 'pp1', reference: 'PP-26-DEMO01', prospect_id: 'ag1', status: 'awaiting_confirmation', company_name: 'Sample Agency A (demo)', recipient_name: 'Sample Contact',
    recipient_email: 'a@example.test', country: 'Sampleland', arrangement: { kind: 'tier', tier_id: 'tier_1', tier_label: 'Tier 1', universities: [
      { record_id: 'cr1', university: 'Sample University (demo)', country: 'Sampleland', study_level: null, variant: null, intake: null, commission_kind: 'percent', commission_value: '10', currency: null, conditions: null }] },
    terms_title: 'Sample terms (demo)', terms_body: 'Sample text only.', message: null, expires_at: d(-29), created_by: ME, created_at: d(1), approved_by: null, approved_at: null, sent_by: ME,
    sent_at: d(1), email_status: 'accepted', email_detail: null, first_viewed_at: null, confirmed_at: null, confirmed_name: null, declined_at: null, decline_reason: null, updated_at: d(1) }],
  mous: [],
  activities: [
    { id: 3, prospect_id: 'ag1', kind: 'proposal_sent', note: null, detail: {}, actor: ME, at: d(1) },
    { id: 2, prospect_id: 'ag1', kind: 'call', note: 'Discussed sample intake.', detail: {}, actor: ME, at: d(2) },
    { id: 1, prospect_id: 'ag1', kind: 'created', note: null, detail: {}, actor: ME, at: d(5) },
  ],
  registrations: [{ id: 'reg-demo', reference: 'PR-26-DEMO01', status: 'activated', link_status: 'closed', submitted_at: d(10), activated_at: d(4) }],
};

export default function HRDemo() {
  const [data, setData] = useState<HRData>(sample);
  const [log, setLog] = useState<string[]>([]);
  const session: Session = { role: 'staff', userRole: 'application_manager', userId: ME, name: 'Manu Manager', email: '', title: 'Senior International Recruitment Manager', permissions: ['hr', 'hr_accounts', 'tasks', 'applications', 'students', 'agency_outreach', 'commission_view', 'commission_tag', 'commission_manage', 'commission_internal', 'commission_edit'], partnerModules: [], employee: true, designations: ['senior_international_recruitment_manager'], hasTeam: true };
  const store = useMemo(() => ({ db: { staff: [], applications: [], students: [], tasks: [], partners: [{ id: 'demo-partner', name: 'Demo Agency (sample)' }] } as unknown as DB, session, actions: {}, loading: false, live: 'live', profilesRev: 0 }) as unknown as StoreValue, [session]);
  const hr = useMemo<HRValue>(() => ({
    data, ready: true, enabled: true,
    load: async () => undefined,
    now: () => new Date(),
    setting: <V,>(k: string, f: V) => ((data.settings.find((s) => s.key === k)?.value ?? f) as V),
    call: async (fnName: string, args: Record<string, unknown>) => {
      let fn = fnName;
      setLog((l) => [`${fn}(${JSON.stringify(args).slice(0, 120)})`, ...l].slice(0, 8));
      if (fn === 'save_daily_report') {
        setData((d) => ({ ...d, reports: [{ id: `r${Date.now()}`, employeeId: ME, templateId: args.p_template as string, templateVersion: 1, designationId: 'senior_international_recruitment_manager', departmentId: 'partnerships', managerId: null, reportDate: args.p_date as string, status: args.p_submit ? 'Submitted' : 'Draft', metrics: args.p_metrics as Record<string, number>, notes: args.p_notes as Record<string, string>, sources: args.p_sources as Record<string, string>, submittedAt: args.p_submit ? new Date().toISOString() : null, reviewedBy: null, reviewedAt: null, reviewComment: null, createdAt: T, updatedAt: new Date().toISOString() }, ...d.reports.filter((r) => !(r.employeeId === ME && r.reportDate === args.p_date))] }));
      }
      if (fn === 'clock_action') fn = String(args.p_kind);
      if (fn === 'break_start') setData((d) => ({ ...d, breaks: [...d.breaks, { id: 'b2', sessionId: 'a1', startAt: new Date().toISOString(), endAt: null }], attendance: d.attendance.map((a) => (a.id === 'a1' ? { ...a, state: 'On Break' } : a)) }));
      if (fn === 'break_end') setData((d) => ({ ...d, breaks: d.breaks.map((b) => (b.endAt ? b : { ...b, endAt: new Date().toISOString() })), attendance: d.attendance.map((a) => (a.id === 'a1' ? { ...a, state: 'Checked In' } : a)) }));
      return { ok: true as const, data: undefined as never };
    },
    // Sample day statuses for the Workforce Calendar / Exceptions (no server in the harness).
    demoWorkforce: (m: string): WorkforceDay[] => {
      const n = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
      return data.directory.flatMap((e, ei) => Array.from({ length: n }, (_, i) => {
        const day = `${m}-${String(i + 1).padStart(2, '0')}`;
        const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
        const future = day > T;
        const code = dow === 0 ? 'WO' : future ? 'UP' : day === T ? 'OPEN' : (i + ei) % 11 === 3 ? 'A' : (i + ei) % 13 === 5 ? 'HD' : (i + ei) % 17 === 2 ? 'PL' : 'P';
        return { employeeId: e.id, day, code, label: code === 'HD' ? 'Morning Leave (Sick Leave) · Afternoon present' : code, halfSession: code === 'HD' ? 'morning' : null, working: dow !== 0, attended: code === 'P' || code === 'HD' } as WorkforceDay;
      }));
    },
    demoTeam: () => [
      { id: ME, fullName: 'Manu Manager (sample)', employeeCode: 'DEMO-1', designationId: 'senior_international_recruitment_manager', departmentId: 'partnerships', reportingManagerId: null, managerName: null, workEmail: 'manager@example.test', photoPath: null, relation: 'you', availability: 'available', attendanceState: 'Checked In' },
      { id: 'demo-po', fullName: 'Priya Partnerships (sample)', employeeCode: 'DEMO-2', designationId: 'partnership_officer', departmentId: 'partnerships', reportingManagerId: ME, managerName: 'Manu Manager (sample)', workEmail: 'priya@example.test', photoPath: null, relation: 'my team', availability: 'morning_leave', attendanceState: null },
      { id: 'demo-app', fullName: 'Arun Applications (sample)', employeeCode: 'DEMO-3', designationId: 'application_team', departmentId: 'applications', reportingManagerId: ME, managerName: 'Manu Manager (sample)', workEmail: 'arun@example.test', photoPath: null, relation: 'my team', availability: 'available', attendanceState: 'On Break' },
    ],
    write: async (table: string, op: string) => {
      setLog((l) => [`${op} ${table}`, ...l].slice(0, 8));
      return true;
    },
  }) as unknown as HRValue, [data]);
  return (
    <StoreContext.Provider value={store}>
      <CommissionDemo.Provider value={COMMISSION_SAMPLE}>
      <AgencyDemo.Provider value={AGENCY_SAMPLE}>
      <HRContext.Provider value={hr}>
        <div className="min-h-screen bg-canvas">
          <div className="sticky top-0 z-30 flex flex-wrap gap-1.5 border-b border-line bg-surface/90 p-3 text-xs backdrop-blur">
            <b className="mr-2 self-center text-heading">HR harness (sample data)</b>
            {PAGES.map(([k, label]) => <NavLink key={k} to={`/ui/hr/${k}`} className={({ isActive }) => `rounded-lg border px-2 py-1 ${isActive ? 'border-rust text-rust' : 'border-line text-ink-soft'}`}>{label}</NavLink>)}
            <span className="ml-auto max-w-[30%] truncate self-center text-ink-mute" title={log.join('\n')}>{log[0] ?? 'no calls yet'}</span>
            <AttendanceControl />
          </div>
          <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
            <Routes>{PAGES.map(([k, , el]) => <Route key={k} path={k} element={el} />)}<Route path="agencies/:id" element={<AgencyDetail />} /></Routes>
          </div>
        </div>
      </HRContext.Provider>
      </AgencyDemo.Provider>
      </CommissionDemo.Provider>
    </StoreContext.Provider>
  );
}
