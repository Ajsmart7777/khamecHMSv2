---
name: Discharge settlement money rules
description: How cash collected at cashier discharge is allocated (debt, invoices, change) — prevents double-counting
type: feature
---

Discharge settlement happens at the cashier only (ward confirms → `ready_for_discharge`).

Allocation order for money collected (`discharge_admission`):
1. Wallet credit is applied to outstanding invoices first.
2. Cash/POS/transfer collected first clears the patient's negative balance (`debt_cleared`).
3. Only the remainder pays down pending invoices.
4. Only what is STILL left after 1–3 is a genuine overpayment → may be left as credit (`topup`) or refunded.

Never count the same collected amount twice (bug 2026-08: ₦1,000 clearing debt was also re-added as "change", leaving a phantom ₦1,000 wallet balance).
