## Flutterwave staff bank verification repair checkpoint

- User reported that Accountant > Staff Registration > Bank Details returns a generic `Account verification failed` message even for a correct OPay account.
- Root cause identified in the clone frontend: it used a hardcoded bank-name-to-code map, which can become stale or use incorrect fintech bank codes.
- Repair in progress: `StaffRegistrationForm.tsx` now loads the live Nigerian bank list from the `payroll-payment` function (`action: list_banks`), stores the selected Flutterwave bank code separately from the displayed bank name, and sends the live code to `action: resolve_account`.
- Build completed successfully locally after the repair: Vite build passed; only the existing large-chunk warning remains.
- Production browser test checkpoint: `/auth` loaded a blank white page in the sandbox browser with no console output; the deployed repair has not yet been verified in the UI at this checkpoint.
- No live staff or payroll data has been created or changed during this repair.
