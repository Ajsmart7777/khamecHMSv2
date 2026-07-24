-- Regression sweep: insured/sponsored patients must never touch the wallet /
-- balance system. Run this any time Reception, Cashier, or copay logic changes.
--
-- Any query below returning rows = REGRESSION. All must return zero rows.
-- (Check 4 is a summary — not a pass/fail; use it as a smoke number.)

-- 1. No sponsored patient may hold a non-zero wallet balance.
SELECT id, first_name, last_name, account_type, balance
FROM patients
WHERE lower(coalesce(account_type,'')) NOT IN ('','normal','cash')
  AND balance <> 0;

-- 2. No wallet transactions may exist for sponsored patients
--    (corrections/adjustments issued by admin cleanup are allowed).
SELECT bt.id, bt.patient_id, p.account_type, bt.transaction_type, bt.amount, bt.created_at
FROM balance_transactions bt
JOIN patients p ON p.id = bt.patient_id
WHERE lower(coalesce(p.account_type,'')) NOT IN ('','normal','cash')
  AND bt.transaction_type NOT IN ('correction','adjustment');

-- 3. No top-up / refund requests may exist for sponsored patients.
SELECT br.id, br.patient_id, p.account_type, br.request_type, br.amount, br.status
FROM balance_requests br
JOIN patients p ON p.id = br.patient_id
WHERE lower(coalesce(p.account_type,'')) NOT IN ('','normal','cash');

-- 4. Cashier split sanity — patient-paid portion of any sponsored invoice must
--    not exceed the expected copay ceiling (see src/lib/copay.ts).
--    Rows here indicate the patient was overcharged at Cashier / Reception.
WITH sponsored AS (
  SELECT i.id, i.invoice_number, i.total_amount, i.paid_amount, i.payment_method,
         lower(coalesce(p.account_type,'')) AS act,
         lower(coalesce(p.insurance_plan,'')) AS plan
  FROM invoices i JOIN patients p ON p.id = i.patient_id
  WHERE lower(coalesce(p.account_type,'')) NOT IN ('','normal','cash')
),
expected AS (
  SELECT *,
    CASE
      WHEN act='katchma' AND plan LIKE '%basic%' THEN 0
      WHEN act='katchma' THEN 10
      WHEN act IN ('nhia','nhis') THEN 10
      WHEN act='staff_family' THEN 50
      ELSE 0
    END AS copay_pct
  FROM sponsored
)
SELECT invoice_number, act, plan, total_amount, paid_amount, payment_method, copay_pct,
       round(total_amount*copay_pct/100.0,2) AS expected_max_patient_pay
FROM expected
WHERE payment_method NOT IN ('sponsor_claim','insurance')
  AND paid_amount > round(total_amount*copay_pct/100.0,2) + 0.01;