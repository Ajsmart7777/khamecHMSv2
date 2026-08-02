## Matsalar da ake ciki (an tabbatar daga database)

- `bill_admission_bed_days` yana kiran `adjust_patient_balance(..., 'invoice_payment')`, kuma wannan function yana **jefa error idan balance zai koma negative**. Shi ya sa screenshot ɗin ya nuna `Insufficient balance (current: 13000, requested delta: -14000)` — gaba ɗaya discharge ya faɗi, ba a caje kome ba, ba a sallami patient ba.
- `discharge_admission` yana ƙin karɓar partial payment: `IF _settlement_amount < _debt THEN RAISE`. Ba a iya karɓar wani ɓangare a bar sauran bashi.
- Ƙidayar kwana a `admission_bed_charge` tana amfani da `CEIL(hours/24)` — sa'o'i 25 = kwana 2, ba calendar nights ba.
- Dialog ɗin yana yin lissafi a client (`patientBalance - bedCopay`) — yana iya bambanta da abin da server zai caje (rounding, sponsor share, tsofaffin invoices da ba a biya ba).

## Abin da za a gina

### 1. Ƙidayar kwana — calendar nights
`admission_bed_charge` zai koma:
`nights = GREATEST(1, date(COALESCE(discharged_at, now())) - date(COALESCE(admitted_at, created_at)))`
Litinin → Talata = dare 1. Duk inda ake nuna "Day N" (`AdmittedPatientsPanel`) zai bi wannan lissafin daga RPC ɗaya, ba lissafin client ba.

### 2. Bed charge ba zai ƙara faɗuwa saboda ƙarancin balance ba
A cikin `bill_admission_bed_days`:
- A ƙidaya `patient_share` (copay) kamar yadda yake yanzu.
- Sannan a raba: `from_wallet = LEAST(GREATEST(balance,0), patient_share)`, `debt = patient_share - from_wallet`.
- `from_wallet` zai shiga a matsayin `invoice_payment`; `debt` zai shiga a matsayin `debt_incurred` (wannan shi kaɗai ake yarda ya sa balance negative).
- Invoice ɗin bed zai zama `partial` idan akwai saura, `paid` idan an cika. Ana kiyaye `BED_DAYS:<admission_id>` guard ɗin don kar a caje sau biyu.

### 3. Sabon preview RPC (source of truth ɗaya)
`admission_discharge_preview(_admission_id)` zai dawo da:
nights, daily_rate, bed_total, copay_pct, sponsor_covered, patient_share, current_balance, prior_outstanding (bashin da ya rigaya — misali maganin/test ɗin da aka bashi yana kwance), **total_due**, da balance bayan discharge.
Dialog ɗin zai nuna waɗannan lambobin kai tsaye daga server — babu lissafin client, don haka babu miscalculation.

### 4. `discharge_admission` — partial da carry
- A ci gaba da kiran `bill_admission_bed_days` da farko (yanzu ba zai faɗi ba).
- A ƙidaya `debt = GREATEST(0, -balance)`.
- `cash/pos/transfer`: a karɓi **kowane adadi > 0**; idan bai kai bashi ba, sauran ya rage a balance a matsayin bashi (audit log `discharge_partial_settlement` da adadin saura). Idan ya wuce bashi, saurar ta rage a matsayin credit.
- `carry`: a sallama da bashi gaba ɗaya — audit log kamar yadda yake, amma yanzu **kowane mai discharge** (nurse/doctor/billing/accountant/admin) na iya, kuma za a buƙaci gajeriyar dalili.
- `waive`: accountant/admin kaɗai (kamar yadda yake).
- Kuɗin da aka karɓa zai rufe invoices ɗin da ba a biya ba (oldest first: bed invoice da in-ward invoices) — `paid_amount`/`status` su daidaita, don Billing, Account da Auditing su yi tally.
- Idan babu bashi, a ci gaba kai tsaye kamar yadda yake.

### 5. UI — `DischargeDialog`
- A ɗauko komai daga `admission_discharge_preview`.
- Nuna teburin bill: ranar shiga, ranar fita, adadin dare, rate/dare, jimillar bed, sponsor covered, patient share, **tsohon bashi (magani/lab da aka bashi yana kwance)**, **Jimillar da za a biya**.
- Amount collected: an cika da cikakken bashi ta default, amma **an yarda a rage** — a nuna live: "Za a karɓa ₦X · saura ₦Y zai rage a matsayin bashi".
- Cire toshewar button (`disabled` saboda short amount); sai dai a nemi dalili idan akwai saura.
- Bayan discharge, a nuna toast da jimillar da aka karɓa da sauran bashin.

## Fannin fasaha
- Migration ɗaya: `admission_bed_charge`, `bill_admission_bed_days`, `discharge_admission`, sabon `admission_discharge_preview` (SECURITY DEFINER, `REVOKE ... FROM PUBLIC, anon`, `GRANT EXECUTE TO authenticated, service_role`).
- Duk lissafi `ROUND(..., 2)`; ana amfani da `SELECT ... FOR UPDATE` a kan `patients` da `admissions` (yana nan) don guje wa race condition.
- Regression check: patient mai balance ƙasa da bed charge yana iya discharge; partial payment yana barin balance daidai negative; invoice totals = balance transactions.

## Files
- Migration (DB functions sama)
- `src/components/nurse/DischargeDialog.tsx`
- `src/components/visit/AdmittedPatientsPanel.tsx` (Day badge ya bi nights daga RPC)
