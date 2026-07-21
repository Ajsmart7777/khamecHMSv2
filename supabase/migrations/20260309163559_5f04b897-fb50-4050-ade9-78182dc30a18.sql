
ALTER TABLE public.payroll_payments RENAME COLUMN paystack_transfer_code TO provider_transfer_code;
ALTER TABLE public.payroll_payments RENAME COLUMN paystack_reference TO provider_reference;
ALTER TABLE public.payroll_payments RENAME COLUMN paystack_recipient_code TO provider_recipient_code;
