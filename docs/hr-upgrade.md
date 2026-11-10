# HR Portal upgrade — status

**Reference:** `~/Production-Suite` (Broken English ERP). It was only read, never changed.
- `hr.html` (about 11,000 lines), plus `leave-policy.js`, `company-assets.js`, `aura.js`, `announcements.js`, `leave-docs.js`, `work-tasks.js`.
- Its database changes are in `supabase/migrations`.
- None of its data, credentials or branding was copied.

`~/broken-english` is a different, earlier HR prototype that stores its data in JSON files. It was not used.

## Comparison

| Area | Broken English HR | SSI GLOBAL before | SSI GLOBAL now |
|---|---|---|---|
| Dashboard | KPI strip, quick actions, pending leave, birthdays and anniversaries, today's workforce | KPI grid, trend chart, reminders, workforce list | Reworked: greeting header, 6 overview cards that open filtered pages, quick actions, pending leave with approve/reject, birthdays and anniversaries, workforce grouped into 7 filterable groups, monthly figures |
| Employees | Cards, profile, filters | Directory, filters, profile modal, salary, account access | Filters can be set from the URL (department, designation, status, joined this month, add) |
| Departments | Separate page | One tab in Settings (name and active only) | Separate page: description, manager, member list, today's present and on-leave counts, CSV export |
| Designations | Separate page | Super Admin only, no page | Separate page; HR can create and edit; only a Super Admin can change what access a designation grants |
| Management (leadership) | Yes | Reporting lines only | Management page: collapsible reporting tree (direct and total team, today's attendance, open tasks), department leadership, employees without a manager, CSV export |
| Work Assignment / My Tasks | Yes (`work-tasks.js`, work_assignments) | Daily Work Reports and work activities, plus the CRM Tasks module | The existing `tasks` table is now the single task engine. Assignments have a description, priority, start date, deadline, status, progress and history. Managers assign to their team and HR assigns to anyone. Pages: HR Work Assignment, Team Assignments for managers, My Assigned Tasks. Team workload view. Employees are notified when work is assigned, reassigned or cancelled, and the assigner when it is completed or put on hold |
| Attendance | Clock in/out, breaks, reports | Clock in/out, breaks, server time, GPS, auto clock-out, working hours | Unchanged. Sidebar now groups corrections, early checkout and auto clock-out review |
| Attendance exceptions | One page with a badge | Corrections, early checkout and auto clock-out review as separate screens | One page with a sidebar badge. **Needs action** tab: corrections, early checkout, auto clock-out review. **Detected** tab: missed clock-in, half day absent, missed clock-out, auto clock-out, late arrivals and early checkouts by month, with filters and CSV export |
| Leave | Requests, balance, calendar, documents, cancellation | Requests, half day (morning/afternoon), loss of pay, ledger, balances, cancellation, policy | Added: Leave Requests, Leave Balance and Leave Calendar pages; **Record leave** (HR enters leave for an employee); sidebar badge for pending requests. Leave documents not yet |
| Payroll / Payslips | Payroll, day breakdown, incentive, payslip workflow | Salary only | **Not needed** — dropped at the owner's request. Salary records stay as they are |
| Holiday calendar | Yes, by department | Yes | Unchanged |
| Workforce calendar | Yes | No | Month grid per employee using the server's day status (present, half day, paid leave, sick leave, loss of pay, absent, holiday, weekly off), daily clocked-in count, upcoming holidays, CSV export |
| Company assets | Yes | No | Asset register, assign and return through server functions, full issue and return history, condition on issue and return, status, warranty. Employees see the assets they hold under My Profile |
| Employee documents | Yes | No | Private `hr-documents` storage with 60-second signed links. Ten categories, expiry dates, share with the employee (notified), archive and restore with a reason. Every upload, download, share and archive is recorded. Employees see shared documents under My Profile |
| Announcements | Yes, with reads, reactions and replies | Notifications only | **Not needed** — dropped at the owner's request |
| Reminders | Birthdays, anniversaries | Birthdays, anniversaries, probation, leave, holidays | Unchanged; birthdays and anniversaries now also on the dashboard |
| Aura Points | Yes (points, deductions, scope) | No | Not yet; needs SSI's own point rules |
| HR reports | Yes | CSV exports | 13 CSV downloads: added monthly attendance summary (half days as 0.5), late arrivals, attendance exceptions, leave utilisation, department distribution, work assignments, asset register |
| Company Policies / HR Settings | Yes, with audit | Policies, shifts, departments; changes audited | Unchanged |
| Header Themes / Tab Builder | Yes | No | Not planned. Tab Builder runs custom page content, which the security rules do not allow |
| Work From Home | KPI card | Not tracked | Not yet. Needs a work mode chosen at clock-in |

## Stage 2 changes

**Database: migration `0025_hr_org_structure.sql`**
- Departments now have `description` and `manager_id`. The manager must be a current employee.
- Designations now have `description`.
- HR staff with `hr_accounts` can create and edit designations. A database trigger blocks any change to role, permissions, workspace or report template unless the user is a Super Admin. A new designation always starts with Support Staff access and the `tasks` permission only.
- Only a Super Admin can delete a department or a designation; everyone else deactivates them instead.
- Department and designation changes now sync live.

**Frontend**
- New page code: `src/pages/hr/OrgStructure.tsx`.
- Reworked: `HRDashboard.tsx`.
- Updated: `Employees.tsx` (URL filters), sidebar groups, routes:
  - `hr/departments`
  - `hr/designations`
  - `hr/attendance-review`
- The sample-data preview pages now include Departments and Designations.

**Tests**
- `supabase/tests/120_hr_org_structure_tests.sql`.

## Stage 3 changes

**Database: migration `0026_hr_leave_record_workforce_calendar.sql`**
- `hr_record_leave(...)`:
  - Only HR or a Super Admin can use it, and never for their own leave.
  - It applies the same checks as an employee's own request: dates, half day, overlap, working days, joining date and balance. It also needs a reason and allows at most 60 days at a time.
  - The leave is approved immediately. Paid types are deducted from the balance; Loss of Pay never is.
  - `leave_requests.recorded_by` stores who entered it, and the employee is notified.
- `workforce_calendar(month)`:
  - Returns each visible employee's day status from `attendance_calendar`, the same source attendance and payroll use.
  - Visibility: HR sees everyone, managers see their team, employees see only themselves, and partner users see nothing.

**Frontend**
- New pages in `src/pages/hr/HRCalendars.tsx`: Attendance Exceptions, Leave Calendar, Workforce Calendar and the Record leave dialog.
- `HRLeave.tsx` can now open on a chosen tab and has a Record leave button.
- The sidebar has Attendance, Leave and Schedule groups, with badges for exceptions and pending leave.
- New routes:
  - `hr/exceptions`
  - `hr/leave-balance`
  - `hr/leave-calendar`
  - `hr/workforce-calendar`

**Tests**
- `supabase/tests/130_hr_leave_record_calendar_tests.sql`.

**Not added in Stage 3**
- **Missing break records:** SSI has no break rule saying when a break is required, so flagging days without a break would invent a policy.
- **Overnight shifts:** the existing shift and auto clock-out rules are kept as they are.

## Stage 4 changes

**Database: migration `0027_hr_work_assets_documents.sql`**
- **Work assignments**
  - New columns on `tasks`: `kind`, `description`, `status`, `progress`, `start_date`, `completed_at`, `assigned_by`, `last_note`.
  - New `task_events` history table and the functions `save_assignment`, `update_assignment_progress` and `cancel_assignment`.
  - The task policies are split. Plain tasks keep their old rules. Assignments are visible only to the assignee, whoever assigned it, the assignee's managers and HR, and can only be changed through the functions above.
- **Company assets**
  - `company_assets` and `asset_assignments` tables (only one open assignment per asset), plus `assign_asset` and `return_asset`.
  - The status `Assigned` can only be set or cleared by those two functions.
- **Employee documents**
  - Private `hr-documents` storage, the `employee_documents` and `employee_document_events` tables, and `authorize_hr_document`.
  - A stored file can never be replaced, and only a Super Admin can delete a document.
  - Managers and partner users cannot see HR documents.
- Audit triggers and realtime are enabled on all the new tables.

**Frontend**
- New page code: `src/pages/hr/HRWork.tsx`.
- New routes: `hr/work`, `hr/my-tasks`, `hr/assets`, `hr/documents`, `work/assigned` and `work/assignments`.
- Dashboard quick actions: Assign work, Add asset, Upload employee document.
- My Profile now shows shared HR documents and the company assets the employee holds.
- Tasks & Reminders still shows plain tasks only.

**Tests**
- `supabase/tests/140_hr_work_assets_documents_tests.sql`.

**Not added in Stage 4**
- Assignments are not automatically counted in Daily Work Reports, because report metrics come from defined work-activity sources. They can be added as a source later if wanted.
- Received Files, Announcements and Aura Points were not built.

## Stage 6 changes

- **Management page** (`hr/management`): reporting tree with search and department filter, department managers, a list of employees with no reporting manager, and CSV export. It is read-only: reporting managers are changed on the employee record, and department managers on the Departments page.
- **Permission check**: new `canOpenPath` in `src/auth/roles.ts`, shared by the sidebar and the page guard.
  - It fixes direct-URL access. Before, staff with only `hr_accounts` could open any HR page by its URL. They now reach Employees, Departments and Designations only.
  - Team pages need a team.
  - Partner accounts can never open HR or Employee Workspace pages.
  - Tests: `npm run test:roles` (`scripts/roles.test.ts`).
- **Dropped at the owner's request:** Payroll / Payslips (Stage 5) and Announcements.

## Still open for later stages

These need a decision before they can be built:
- **Payroll:** not needed; Stage 5 dropped.
- **Aura Points:** what earns or loses points, and who may award them.
- **Work From Home:** whether employees declare it at clock-in, and whether HR must approve it.
- **Paid leave carry-forward:** the current setting is used. Confirm the maximum number of days carried forward.
