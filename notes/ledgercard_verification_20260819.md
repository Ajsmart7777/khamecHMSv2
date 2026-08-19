# Ledger-card verification notes

## Implementation findings
The CockroachDB `src/components/visit/PatientLedgerCard.tsx` loads visits, vitals, visit attachments, snap_orders, invoices with invoice_items, admissions, lab_requests, and prescriptions with prescription_items. It classifies pharmacy/lab/treatment/vitals snaps, provides typed prescription and typed lab-request fallbacks, emits invoice and paid/partial receipt rows, and emits admission/discharge rows. Realtime refresh subscribes to snap_orders, lab_requests, prescriptions, prescription_items, visits, admissions, invoices, vitals, visit_attachments, and invoice_items, with a 250ms debounce.

## Potential omissions to verify
The component does not directly load or subscribe to `balance_transactions`; invoice payment rows are derived from `invoices.paid_amount`. A zero-payment/debt settlement therefore may not create a receipt row. Custom bills are represented as ordinary invoices and must be verified through invoice and invoice_items rows. Admissions query includes nested `wards(name), beds(bed_number), rooms(room_number)` and needs live verification because `admissions` has a direct `bed_id` but no direct `room_id` column.

## Relevant live tables
`patients`, `visits`, `vitals`, `visit_attachments`, `snap_orders`, `lab_requests`, `prescriptions`, `prescription_items`, `invoices`, `invoice_items`, `admissions`, and `balance_transactions` exist. There is no `payment_transactions` table in the inspected live schema. Key fields include invoice `paid_amount/status/payment_method/paid_at/visit_id`, invoice_items `description/quantity/unit_price/total/dispensing_status`, snap order `order_type/target_station/status/invoice_id/result_text`, lab request `tests/status/results/visit_id`, and balance transaction `transaction_type/amount/balance_before/balance_after/related_invoice_id`.
## Controlled workflow result
The self-cleaning ledger workflow probe passed after following the live payment gate: pharmacy and lab typed orders, custom invoice plus invoice_items, partial payment, full payment, pharmacy fulfillment, lab completion/result, admission, discharge, and balance_transaction rows were each present at their respective checkpoints; all verification rows were removed and cleanup_remaining_patients=0.

## Confirmed gap
PatientLedgerCard currently loads invoice-derived cumulative payment rows but does not load or subscribe to balance_transactions, so wallet deductions, debt incurred, overpayment credit, admitted deductions, and other balance events are not shown as separate ledger events. CockroachDB realtime is a no-op helper, so refresh-on-write is not available in the clone; the component must at least reload on explicit route/context changes, and balance transaction source coverage should be added for complete ledger visibility.
