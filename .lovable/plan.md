# Plan - Pharmacy Missing Medication & Partial Refund Workflow

Implement a workflow allowing Pharmacy to mark individual paid medications as unavailable, enabling Cashier to process specific refunds for those items.

## User Review Required

> [!IMPORTANT]
> For sponsored patients (Insurance, Corporate, Retainer):
> 1. Pharmacy marks the item as unavailable.
> 2. The item is automatically "voided" from the invoice (marked 'refunded' or 'voided' in dispensing status).
> 3. This ensures the Claim Manager does not include the missing item in the final claim submission.
> 4. Pharmacy can provide a printout/note for the patient to purchase elsewhere.


## Proposed Changes

### Database & Backend
- Use `supabase--migration` to add `dispensing_status`, `dispensing_notes`, `dispensing_updated_at`, and `dispensing_updated_by` to `invoice_items`.
- Create RPC `mark_item_unavailable(item_id, reason)` to update status to 'unavailable'.
- Create RPC `refund_invoice_item(item_id, method)` to mark status as 'refunded'. For cash/wallet patients, it adjusts balance. For sponsored patients, it simply updates the item status so it's excluded from claims.


### Pharmacy Module
- Update `SnapFulfillDialog` in `src/components/pharmacy/PharmacySnapQueue.tsx` to:
    - Display per-item status (Pending, Dispensed, Unavailable, Refunded).
    - Provide an "Unavailable" button for each item.
    - Ask for a reason when marking unavailable.
    - Prevent marking an already dispensed or refunded item as unavailable.

### Cashier Module
- Update `CashierPanel.tsx` (or a dedicated Refund section) to handle patient refunds for Cash/Wallet users.
- Ensure the Claims submission logic (referenced by Claim Manager) filters out items with `dispensing_status = 'refunded'` or 'unavailable'.

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
