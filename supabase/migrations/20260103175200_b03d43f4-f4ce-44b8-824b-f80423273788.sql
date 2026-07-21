-- Create staff table
CREATE TABLE public.staff (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'reception',
    department TEXT NOT NULL DEFAULT 'General',
    salary NUMERIC NOT NULL DEFAULT 0,
    hire_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

-- Create RLS policies - only admin and account roles can access staff data
CREATE POLICY "Admin and account can read staff"
ON public.staff
FOR SELECT
USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'billing'::app_role]));

CREATE POLICY "Only admin can insert staff"
ON public.staff
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admin can update staff"
ON public.staff
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admin can delete staff"
ON public.staff
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create trigger for updated_at
CREATE TRIGGER update_staff_updated_at
BEFORE UPDATE ON public.staff
FOR EACH ROW
EXECUTE FUNCTION public.update_patients_updated_at();

-- Create index for common queries
CREATE INDEX idx_staff_role ON public.staff(role);
CREATE INDEX idx_staff_status ON public.staff(status);