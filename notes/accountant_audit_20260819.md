## CockroachDB clone Accountant initial load

Date: 2026-08-19
URL: https://khameccockroach.netlify.app/account?accountaudit=20260819
Build: v1.4.4.b2c3de6
Authenticated admin session loaded after an initial Loading screen. The Accounts & Payroll workspace rendered cleanly. Visible tabs: Dashboard, Staff, HR, Payroll, Payments, Corporate, Retainer, Corporate Month-End, Retainer Month-End, Issued Reports, Pricelist, Pharmacy & Store, Daily Sales Report, Staff Family Deductions, External Doctors, Register Staff, History, and Reports. Dashboard showed zero staff, ₦0K monthly payroll, ₦0K last gross pay, and zero pending payments. External Doctors is currently a visible tab and is scheduled for removal only after dependency mapping and cross-version audit.

No data mutation was performed.
## Initial live tab checks

- Staff tab: rendered cleanly with search field, refresh control, and an empty "No staff found" table. No runtime error observed.
- HR tab: rendered cleanly with Leave Management and Attendance sub-tabs plus a New Leave action. Leave table initially displayed Loading; requires a follow-up wait before classifying as an error.

No mutations performed.
## HR and Payroll checks

- HR Leave Management resolved from Loading to "No leave records". New Leave action is visible. No runtime error observed.
- Payroll rendered August 2026 as a Draft period. Controls visible: period selector, New Period, Add All Staff, Recalculate, Add Column, and Lock Payroll. Totals are ₦0 gross, ₦0 deductions, and ₦0 net pay. No payroll entries exist because no staff records are present. The table exposes salary components and deductions including PAYE, pension, loan, contributions, and FAMILY MED, plus advice, net pay, status, and actions. No mutation performed.
## Payments and Corporate checks

- Payments tab: rendered cleanly and correctly blocked payment processing while the selected payroll period remained Draft, displaying "Lock the payroll period first before processing payments." No payment action was initiated.
- Corporate tab: rendered with search, Refresh, and Add Company controls. Summary cards showed zero companies, zero active companies, zero linked patients, and ₦0 total balance. The data area was still loading at the first capture and needs a follow-up wait before classifying it. No mutation performed.
## Corporate and Retainer checks

- Corporate list resolved successfully: 1 company, 1 active company, 1 linked patient, and ₦20,000 total balance. The visible company is Funtua Textile with HR manager contact, one linked patient, ₦20,000 balance, 0% discount, and View, Top Up, Edit, and Remove safely actions. No action was clicked.
- Retainer tab rendered as a separate workspace with Search retainers, Refresh, and Add Retainer controls. It currently shows zero retainers, zero active, zero linked patients, and ₦0 balance. The Retainer view is not displaying the Corporate company, which is a positive separation check. Data area was still loading at first capture and needs follow-up wait.

No mutation performed.
## Retainer and Corporate Month-End checks

- Retainer list resolved successfully: 1 active retainer, zero linked patients, and ₦0 balance. The visible account is Alh. Jargaba with separate retainer contact details and View, Top Up, Edit, and Remove safely actions. This confirms the Retainer list is isolated from Corporate data.
- Corporate Month-End rendered with August 2026 selectors and the documented sequence: review registered services, add walk-in paper slips, prepare report, close and issue report, then record company payment. The covering-letter guidance explicitly addresses unpaid, partial, and credit months. Current totals are ₦0 billed, ₦0 outstanding, and ₦0 payments received because no billable corporate month is present. No month was closed and no report was issued.
## Retainer Month-End and Issued Reports checks

- Retainer Month-End rendered with August 2026 selectors and a clear monthly sequence: review services, prepare report, close and issue, then record funding or apply available credit. It also explains that later services move to the next month and that covering letters reconcile unpaid months or credit across periods. Current totals are ₦0 billed, ₦0 available credit, and ₦0 unpaid claims.
- Issued Reports rendered two separate sections: Corporate Monthly Statements and Retainer Monthly Statements. Both have month/year selectors, Refresh, Generate all, and Download all as PDF controls. The explanatory text says reports include registered services (and corporate walk-in paper services), draft reports can be regenerated, and finalized/printed/paid reports must be voided before regeneration. Both lists are currently empty. No report was generated or downloaded.
## Pricelist and Pharmacy & Store checks

- Pricelist loaded with Search name or size, category filter, Add Item, Upload CSV, Download CSV, and Validation Report controls. The current table resolved to a valid empty state with no items; no blank-screen or runtime error was observed.
- Pharmacy & Store management loaded as a read-only oversight view. Store inventory value is ₦0, store units are 0, pharmacy units are 0, and dispensed today is 0. Pharmacy availability and recent controlled movement tables both resolved empty, which is consistent with the clone’s currently empty inventory rather than a loading failure.
## Daily Sales and Staff Family Deductions checks

- Daily Sales Report rendered with a date selector for 19 August 2026, Refresh, and Print Report. Total Sales is ₦0 and the report explicitly states that no sales were recorded for the selected date. The printable report includes the hospital identity and a complete table schema for time, reference, patient, card number, patient type, payment method, entry, and amount.
- Staff Family Deductions rendered Current Cycle and History tabs, Print, search, and Close Cycle controls. The current cycle table is empty/loading while the explanatory text correctly describes accumulation by staff sponsor, manual payroll deduction entry, cycle closing, locking, and history retention. No cycle was closed and no deduction was posted.
## External Doctors and Register Staff checks

- External Doctors tab loaded cleanly and showed 0 doctors with Refresh and Add doctor controls. This confirms the obsolete feature is still exposed in production and has no live records visible in the UI; it is scheduled for coordinated removal.
- Register Staff rendered the full form without a blank state: Staff ID, designation, full name, email, phone, system-user switch, role, department, salary, hire date, family salary-deduction consent, searchable bank selector, account number, Verify Account, Clear, and Add Staff. The registered-staff table correctly showed 0 records. No form was submitted and no bank account verification was attempted.
## History and Reports checks

- Payment History rendered with Refresh and a Select period combobox. With no period selected, it displayed the safe instruction "Select a period to view payment history" rather than throwing an error or presenting misleading data.
- Reports rendered with August 2026 and Master Payroll selectors, Refresh, and a disabled-looking Export CSV action because the selected period has no entries. The empty state explicitly states "No entries for this period." No export was triggered.

## Audit conclusion

All 18 Accountant tabs were visited without data mutation. Every tab produced a valid loaded, empty, or intentionally gated state; no blank-screen or uncaught runtime error was observed during this pass. The only confirmed feature-level issue from the audit is that the obsolete External Doctors tab remains exposed and must be removed, plus the separately identified retainer/corporate account-type filter defect in useCorporateAccounts.

## External Doctors dependency probe

Read-only probes were run against both live databases before removal. CockroachDB returned external_doctors=0, standing_orders=0, and standing_orders_with_external_doctor_id=0; its schema still contains standing_orders.external_doctor_id with the foreign key standing_orders_external_doctor_id_fkey and the legacy external_doctor_name column. The primary Supabase project returned the same zero counts and the same standing_orders dependency. No live External Doctor or standing-order data will be lost by removing the obsolete table and its legacy columns.

## Production deployment verification after External Doctors removal
- CockroachDB clone: after Netlify propagation, `https://khameccockroach.netlify.app/account?accountaudit=20260819` served build `v1.4.4.5c4cf34`; the Accountant tab list contains 17 tabs and no `External Doctors` tab. The page loaded normally with dashboard data.
- Primary Supabase site: `https://khamec.netlify.app/account?accountaudit=20260819` currently served build `v1.4.4.85aa661` and still displayed the old `External Doctors` tab at capture time; this indicates the primary Netlify build had not yet propagated from commit `a95f16c` and requires a refresh/recheck before final completion.
- Clone read-only final probe remained clean: patients=3, visits=3, invoices=3, lab_requests=3, auth_users=2, verification_markers=[].
- Clone dependency probe after migration: external_doctors absent; standing_orders present with 0 rows, no legacy external-doctor columns, and only expected patient/prescription/visit/auth foreign keys.
- Primary Supabase read-only verification: only standing_orders and expected patient_id/transcribed_prescription_id/visit_id foreign keys remained; no external_doctors table, legacy columns, or external-doctor foreign key remained.

- Final primary deployment verification: after Netlify propagation, `https://khamec.netlify.app/account?accountaudit=20260819` served build `v1.4.4.a95f16c`; the Accountant tab list contains 17 tabs and no `External Doctors` tab. The dashboard loaded normally with existing payroll data.
