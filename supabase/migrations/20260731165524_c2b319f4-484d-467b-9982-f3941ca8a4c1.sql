-- 1. Patients: restrict UPDATE to operational roles (exclude 'store')
DROP POLICY IF EXISTS "Staff can update patients" ON public.patients;
CREATE POLICY "Operational staff can update patients"
ON public.patients FOR UPDATE TO authenticated
USING (has_any_role(auth.uid(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','anc','lab_tech','pharmacist','billing','cashier','accountant','claims_manager','admin']::app_role[]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','anc','lab_tech','pharmacist','billing','cashier','accountant','claims_manager','admin']::app_role[]));

-- 2. Invoices / invoice_items: scope SELECT to roles that need billing visibility
DROP POLICY IF EXISTS "Authenticated staff can read invoices" ON public.invoices;
CREATE POLICY "Billing-relevant staff can read invoices"
ON public.invoices FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','anc','billing','cashier','accountant','claims_manager','admin']::app_role[]));

DROP POLICY IF EXISTS "Authenticated staff can read invoice_items" ON public.invoice_items;
CREATE POLICY "Billing-relevant staff can read invoice_items"
ON public.invoice_items FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['receptionist','nurse','doctor','doctor1','doctor2','anc','billing','cashier','accountant','claims_manager','admin']::app_role[]));

-- 3. Eligibility verifications: limit PII to roles that handle eligibility
DROP POLICY IF EXISTS "staff_view_eligibility" ON public.eligibility_verifications;
CREATE POLICY "eligibility_roles_view_eligibility"
ON public.eligibility_verifications FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['receptionist','claims_manager','billing','admin']::app_role[]));

-- 4. Staff: remove billing role's access to salary/bank data
DROP POLICY IF EXISTS "Admin and account can read staff" ON public.staff;
CREATE POLICY "Admin and accountant can read staff"
ON public.staff FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['admin','accountant']::app_role[]));

-- 5. Non-sensitive staff directory for everyone else (used by the reception staff picker)
CREATE OR REPLACE VIEW public.staff_directory
WITH (security_invoker = off) AS
SELECT id, employee_id, first_name, last_name, role, department, status, family_deduction_consent
FROM public.staff;

REVOKE ALL ON public.staff_directory FROM PUBLIC, anon;
GRANT SELECT ON public.staff_directory TO authenticated;
GRANT ALL ON public.staff_directory TO service_role;