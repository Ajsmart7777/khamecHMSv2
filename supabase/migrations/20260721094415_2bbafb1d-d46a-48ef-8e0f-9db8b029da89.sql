ALTER TABLE public.corporate_accounts ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'corporate';
UPDATE public.corporate_accounts SET account_type = 'corporate' WHERE account_type IS NULL;
ALTER TABLE public.corporate_accounts DROP CONSTRAINT IF EXISTS corporate_accounts_account_type_check;
ALTER TABLE public.corporate_accounts ADD CONSTRAINT corporate_accounts_account_type_check CHECK (account_type IN ('corporate','retainer'));
CREATE INDEX IF NOT EXISTS idx_corporate_accounts_account_type ON public.corporate_accounts(account_type);