---
name: Sponsor scope & claims routing
description: Who handles which sponsor type — claims manager vs accountant, staff/staff_family rules
type: feature
---
- Claims Manager sees ONLY external insurance schemes: `nhia`, `hmo`, `katchma`.
- Accountant handles `corporate` and `retainer` sponsors (their own account/statement module).
- `staff`: hospital covers 100% — free care, never appears in claims or invoices requiring payment.
- `staff_family`: patient pays 50% out-of-pocket like a normal cash patient — wallet-enabled (`hasWallet` true), can top-up, refund, partial payment. The other 50% is a hospital discount (write-off). NO payroll deduction — the trigger `trg_queue_family_deduction` and function `queue_family_deduction_after_invoice` were removed. Not a claim.
- Any UI/RPC filtering claims by sponsor must use `['nhia','hmo','katchma']` only.