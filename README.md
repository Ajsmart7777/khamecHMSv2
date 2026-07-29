# hms

Project Name: Khadija Medical Center Hospital Management System (HMS) – Funtua, Nigeria
Objective: Build a complete HMS system with all sections, roles, workflows, permissions, interactions, inventory, payroll, corporate/individual accounts, auditing, and admin oversight exactly as described below. Generate a visual flow diagram showing all patient flows, staff interactions, payments, and system status changes.
1️⃣ Key Sections / Modules
Reception
Nurse
Doctor
Lab
Billing
Pharmacy
Store
Account (corporate & individual patient management + staff management + payroll)
Auditing
Admin
2️⃣ User Roles & Permissions Overview
Role
Can Do
Cannot Do
Reception
Register patient, issue card, record payments, send patient to next section
Prescribe, modify medical records
Nurse
Record vitals, notes, send patient to Doctor/Lab, limited prescribing
Collect payment, delete records
Doctor
Consult, prescribe, send patient to Billing/Lab/Admitting
Collect payment
Lab
Receive patient, perform test, record results, send back to Doctor
Prescribe, handle payment
Billing
Generate invoice, send to Reception
Collect payment
Pharmacy
Dispense medicine, manage stock requests, record dispensing
Collect payment, prescribe
Store
Manage inventory, fulfill Pharmacy requests, record stock
Dispense to patient, collect payment
Account
Manage corporate/individual accounts, staff management, payroll, financial reports
Collect patient cash, prescribe
Auditing
View all activities & transactions, generate reports
Modify records
Admin
Full system oversight, approve operations, manage users & roles
Modify doctor’s prescriptions
3️⃣ Patient Card Logic
Main Hospital Card (physical, kept at Reception)
Mini Card (patient carries, links to main card in system)
Returning patients bring mini card → Reception retrieves main card
4️⃣ Workflow / Patient Flow
Step 1: Reception
Register patient, issue cards
Record payment (cash/POS/insurance/corporate/individual balance)
Send patient to Nurse or Pharmacy
Step 2: Nurse
Receive patient, call patient, record vitals & notes
Send patient to Doctor or Lab or minor prescribing
Step 3: Doctor
Receive patient & card
Review vitals & notes
Prescribe medication → send to Billing & Pharmacy
Request Lab tests → send to Lab
Send patient to Admitting → Nurse delivers patient
Step 4: Lab
Receive patient, perform tests, record results, send back to Doctor
Step 5: Billing
Generate invoice for treatment & prescriptions
Send invoice to Reception
Step 6: Reception (Payment)
Verify invoice, collect payment, confirm
Send patient to Pharmacy if applicable
Step 7: Pharmacy
Receive patient & prescription
Dispense medicine, record dispensing, request stock if needed
Update inventory
Step 8: Store
Fulfill Pharmacy stock requests, record stock in/out
Update inventory
Step 9: Account
Manage corporate & individual patient accounts (treatment limits, balances)
Manage staff records & roles
One-click payroll → generate reports & hardcopies
Send financial reports to Auditing
Step 10: Auditing
Full oversight of all sections
Verify transactions, compliance, generate reports
Reports sent to Admin
Step 11: Admin
Central control of system
Receive daily reports from Reception & Auditing
Approve operations, manage users & roles
5️⃣ Key Interactions & Status Tracking
Every section updates patient status in system in real-time
Physical card movements are tracked & synced with system
Inventory: Pharmacy & Store stock levels are updated in real-time
Payments: tracked at Reception, verified by Account & Auditing
Payroll: one-click salary triggers update & reporting to Auditing & Admin
6️⃣ Diagram Requirements
Nodes for each section/module: Reception, Nurse, Doctor, Lab, Billing, Pharmacy, Store, Account, Auditing, Admin
Arrows showing patient movement / workflow
Status updates (Received → In Progress → Completed) on arrows
Include payment flow: Reception → Account → Auditing → Admin
Include inventory flow: Pharmacy ↔ Store
Include corporate & individual account checks in Account
Include payroll process in Account → Auditing/Admin
7️⃣ Developer / Diagram Notes
Generate flowchart / system diagram with:
Color-coded roles (e.g., blue = clinical, green = financial, orange = admin)
Real-time status labels
Decision points (e.g., Doctor → Billing / Lab / Admitting)
Payment & prescription verification points
Include physical card + digital system integration
Show all interactions with roles & permissions
✅ Result Expected:
A complete visual diagram + flowchart of Khadija Medical Center HMS showing all modules, workflows, patient movement, payments, inventory, staff & payroll, corporate/individual accounts, auditing, and admin oversight, ready for developers or AI to implement exactly.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://khamechms.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ba4aed0f-d68c-46da-a05e-357962d9fbdf).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
