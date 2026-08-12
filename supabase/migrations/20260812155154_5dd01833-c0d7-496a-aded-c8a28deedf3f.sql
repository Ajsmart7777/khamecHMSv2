CREATE OR REPLACE FUNCTION public.calculate_payroll_deductions(
    _staff_id uuid,
    _period_start date,
    _period_end date
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _total numeric;
BEGIN
    SELECT COALESCE(SUM(paid_amount), 0)
    INTO _total
    FROM public.invoices
    WHERE staff_sponsor_id = _staff_id
      AND is_salary_deduction = true
      AND status = 'paid'
      AND paid_at::date >= _period_start
      AND paid_at::date <= _period_end;
      
    RETURN _total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_payroll_deductions(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_payroll_deductions(uuid, date, date) TO service_role;