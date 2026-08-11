# Plan - Pharmacy Missing Medication & Partial Refund Workflow

Implement a workflow allowing Pharmacy to mark individual paid medications as unavailable, enabling Cashier to process specific refunds for those items.

## User Review Required

> [!IMPORTANT]
> The current plan assumes that a refund either credits the patient's wallet (internal balance) or is handled as cash. If a specific payment method (like Stripe or a Bank Transfer) requires external integration for refunds, that is not covered here.

## Proposed Changes

### Database & Backend
- Use `supabase--migration` to add `dispensing_status`, `dispensing_notes`, `dispensing_updated_at`, and `dispensing_updated_by` to `invoice_items`.
- Create RPC `mark_item_unavailable(item_id, reason)` to update status to 'unavailable'.
- Create RPC `refund_invoice_item(item_id, method)` to mark status as 'refunded' and adjust patient balance if the method is 'balance'.

### Pharmacy Module
- Update `SnapFulfillDialog` in `src/components/pharmacy/PharmacySnapQueue.tsx` to:
    - Display per-item status (Pending, Dispensed, Unavailable, Refunded).
    - Provide an "Unavailable" button for each item.
    - Ask for a reason when marking unavailable.
    - Prevent marking an already dispensed or refunded item as unavailable.

### Cashier Module
- Update `CashierPanel.tsx` or create a new component to:
    - List paid items marked as 'unavailable'.
    - Allow Cashier to select items for refund.
    - Support "Refund to Wallet" (internal credit) or "Mark as Refunded (Cash)".
    - Prevent double refunds.

### Technical Details
- **Tables**: `invoice_items`, `invoices`, `patients`, `audit_logs`.
- **RPCs**: `mark_item_unavailable`, `refund_invoice_item`.
- **Components**: `PharmacySnapQueue.tsx`, `CashierPanel.tsx`.

## Verification Plan
1. **Automated Tests**:
    - Extend `src/tests/refunds.test.ts` to cover partial item refunds.
2. **Manual Verification**:
    - Create an invoice with 3 items.
    - Pay the invoice in Cashier.
    - Open the invoice in Pharmacy.
    - Mark 1 item as unavailable.
    - Verify it appears in Cashier's refund queue.
    - Process the refund to wallet.
    - Verify patient balance increases.
    - Verify item status changes to 'refunded' and is no longer refundable.
