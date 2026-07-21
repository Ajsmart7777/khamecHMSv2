
-- Generic audit insert helper (SECURITY DEFINER so triggers can write regardless of caller RLS)
CREATE OR REPLACE FUNCTION public.write_audit_log(
  _action text,
  _resource_type text,
  _resource_id text,
  _details jsonb,
  _status text DEFAULT 'success'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, details, status)
  VALUES (auth.uid(), _action, _resource_type, _resource_id, _details, _status);
END;
$$;

-- 1) user_roles: role_assigned / role_removed
CREATE OR REPLACE FUNCTION public.audit_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.write_audit_log(
      'role_assigned', 'user_role', NEW.id::text,
      jsonb_build_object('target_user_id', NEW.user_id, 'role', NEW.role)
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.write_audit_log(
      'role_removed', 'user_role', OLD.id::text,
      jsonb_build_object('target_user_id', OLD.user_id, 'role', OLD.role)
    );
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    PERFORM public.write_audit_log(
      'role_assigned', 'user_role', NEW.id::text,
      jsonb_build_object('target_user_id', NEW.user_id, 'old_role', OLD.role, 'new_role', NEW.role)
    );
    RETURN NEW;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_user_roles ON public.user_roles;
CREATE TRIGGER trg_audit_user_roles
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.audit_user_roles();

-- 2) invoices: payment_received when paid_amount increases
CREATE OR REPLACE FUNCTION public.audit_invoice_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.paid_amount > COALESCE(OLD.paid_amount, 0) THEN
    PERFORM public.write_audit_log(
      'payment_received', 'invoice', NEW.id::text,
      jsonb_build_object(
        'invoice_number', NEW.invoice_number,
        'patient_id', NEW.patient_id,
        'amount', NEW.paid_amount - COALESCE(OLD.paid_amount, 0),
        'new_paid_total', NEW.paid_amount,
        'total_amount', NEW.total_amount,
        'payment_method', NEW.payment_method,
        'status', NEW.status
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_invoice_payment ON public.invoices;
CREATE TRIGGER trg_audit_invoice_payment
AFTER UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.audit_invoice_payment();

-- 3) prescriptions: prescription_dispensed when status becomes 'dispensed'
CREATE OR REPLACE FUNCTION public.audit_prescription_dispense()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'dispensed'
     AND COALESCE(OLD.status, '') <> 'dispensed' THEN
    PERFORM public.write_audit_log(
      'prescription_dispensed', 'prescription', NEW.id::text,
      jsonb_build_object('patient_id', NEW.patient_id, 'diagnosis', NEW.diagnosis)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_prescription_dispense ON public.prescriptions;
CREATE TRIGGER trg_audit_prescription_dispense
AFTER UPDATE ON public.prescriptions
FOR EACH ROW EXECUTE FUNCTION public.audit_prescription_dispense();

-- 4) payroll_entries: salary_processed when status becomes 'paid'
CREATE OR REPLACE FUNCTION public.audit_payroll_processed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'paid'
     AND COALESCE(OLD.status, '') <> 'paid' THEN
    PERFORM public.write_audit_log(
      'salary_processed', 'payroll_entry', NEW.id::text,
      jsonb_build_object(
        'staff_id', NEW.staff_id,
        'payroll_period_id', NEW.payroll_period_id,
        'net_pay', NEW.net_pay,
        'payment_reference', NEW.payment_reference
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_payroll_processed ON public.payroll_entries;
CREATE TRIGGER trg_audit_payroll_processed
AFTER UPDATE ON public.payroll_entries
FOR EACH ROW EXECUTE FUNCTION public.audit_payroll_processed();

-- Extend AuditAction check (if constrained) — no-op if not constrained.
-- Add new resource_type / action values via inserts only; no schema change needed.
