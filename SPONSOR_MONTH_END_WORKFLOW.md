# Khamec HMS: Sponsor Month-End Workflow

This guide is for the Accountant. **Corporate** and **Retainer** are both sponsor accounts: a company is registered once, patients are linked to it, and the hospital prepares one report for each company for each month. The two account types differ only in how payment is settled.

> **Use the account setup tabs only to register and maintain companies. Use the Month-End tabs to prepare reports, close months, and record settlement.**

| Accountant page | Purpose |
|---|---|
| **Corporate** | Register and manage post-paid Corporate companies. |
| **Retainer** | Register and manage Retainer companies and view their available deposit credit. |
| **Corporate Month-End** | Prepare, issue, settle, and reconcile Corporate monthly reports. |
| **Retainer Month-End** | Prepare, issue, settle, and reconcile Retainer monthly reports. |
| **Issued Reports** | View already-issued reports. This is history, not the normal payment workflow. |

## The same monthly cycle for both sponsor types

At the end of January, select **January** in the appropriate Month-End tab and open the company card. The normal order is always the following.

| Step | What the Accountant does | What Khamec HMS does |
|---|---|---|
| 1. Review | Check registered patients, invoices, visits, and the displayed total. | Shows all recorded company services for the chosen month. |
| 2. Add paper slips | **Corporate only:** type pharmacy/laboratory walk-in paper slips before the report is prepared. | Adds the non-registered patient service to the company’s January total. |
| 3. Prepare report | Select **Prepare monthly report**. Use **Refresh draft report** only before the report is issued. | Creates one January draft report for that company, with a controlled total. |
| 4. Send report | Download **Monthly report** and send it to the company. Then select **Close & issue report**. | Locks the month’s report. New services recorded afterwards belong to the next month. |
| 5. Settle | Record what the company paid, if anything. | Keeps the full, partial, unpaid, or excess-payment position accurately. |

A report must be issued every month even when the company pays nothing. The report is the proof of services delivered; payment is recorded separately when it actually arrives.

## Corporate settlement: post-paid company claims

Corporate companies are normally billed after services have been provided. When the January report is issued, the Accountant selects **Record payment** and enters the actual amount, payment date, method, bank reference, and notes.

| Company action | System result |
|---|---|
| Pays the exact January amount | January report becomes **settled**. |
| Pays less than the January amount | The recorded payment is preserved and the remaining amount stays unpaid. |
| Pays nothing | January remains an issued unpaid report. Nothing is hidden or lost. |
| Pays more than the January amount | January is settled and the extra amount is retained as a **credit** in the reconciliation. |

## Retainer settlement: deposit-held company claims

A Retainer company has money held by the hospital as an available deposit credit. When the January report is closed, the system first applies any credit already available.

If the report is not fully covered, select **Record funding / apply credit**. Enter the money received from the company, its date, payment method, bank reference, and notes. The system adds the funding, applies only the amount needed to the issued report, and leaves any extra money as future Retainer credit.

| Retainer position after January closing | Accountant action |
|---|---|
| Existing Retainer credit fully covers January | The report is settled automatically. |
| Existing credit covers part of January | Select **Record funding / apply credit** when the company pays; the unpaid balance remains visible until then. |
| No new money, but existing credit should be applied | Enter **0.00** as money received and record/apply the available credit. |
| Company pays more than January requires | The report is settled and the unused remainder becomes available Retainer credit. |

## Covering letter: only for reconciliation across months

The monthly report is for the selected month. The **Covering letter** is used when a company needs a combined reconciliation, for example in February when January is still unpaid.

The covering letter shows the current month’s claim, every earlier unpaid report, payment or Retainer funding history, money already applied, available credit where relevant, and the final balance due. It is available for **both Corporate and Retainer accounts**.

> Example: If a Corporate company has a January report of ₦100,000, pays ₦40,000, then receives a February report of ₦80,000, the February covering letter shows January ₦60,000 arrears plus February ₦80,000, less every recorded payment. The company can see exactly why the balance is due.

## Important controls

Once the Accountant selects **Close & issue report**, the report is no longer a draft. Do not edit services or walk-in paper slips for that issued month. Correct issues through the approved reconciliation process rather than silently changing an issued report. Every payment, deposit, deduction, reference, and date is retained in the system’s financial history.

The monthly report should be downloaded and sent before or at the same time as it is issued. In the next calendar month, select the next month in the Month-End tab and repeat the same five steps.
