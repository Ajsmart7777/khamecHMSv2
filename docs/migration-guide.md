# Full migration guide — your own Supabase + Cloudflare R2 + Netlify

Written for someone who has never done this before. Do the parts **in order**.
Every command is typed in a terminal (Command Prompt on Windows, Terminal on Mac).

What you will end up with:

- The app code on your GitHub, deployed on **Netlify** (your own URL).
- The database + logins on **your own Supabase project**.
- All photos/snaps on **Cloudflare R2** (so the Supabase storage never fills up).

Keep a notepad open — you will collect about 10 values (keys/URLs) along the way.

---

## PART 0 — Install the tools (one time)

1. **Node.js 20** — https://nodejs.org (choose LTS). Install with default options.
2. **Git** — https://git-scm.com/downloads
3. **Supabase CLI** — after Node is installed, run:

```bash
npm install -g supabase
supabase --version
```

If `supabase --version` prints a number, you are good.

4. Accounts you need (all have free plans):
   - GitHub — https://github.com
   - Supabase — https://supabase.com (you already created the project)
   - Cloudflare — https://dash.cloudflare.com
   - Netlify — https://netlify.com

---

## PART 1 — Get the code onto your computer

1. In Lovable, top right: **GitHub → Connect to GitHub → Create repository**.
2. On GitHub open the new repo, click the green **Code** button, copy the HTTPS URL.
3. In your terminal:

```bash
git clone <the-url-you-copied>
cd <the-folder-it-created>
npm install
```

---

## PART 2 — Cloudflare R2 (photo storage)

1. Cloudflare dashboard → left menu **R2** → **Create bucket**.
   - Name: `khamec-files`
   - Location: Automatic → **Create bucket**
   - (R2 asks for a card even on the free plan; free tier is 10 GB storage.)

2. Open the bucket → **Settings** → **Public access**:
   - Option A (easiest): **R2.dev subdomain** → Allow access.
     You get a URL like `https://pub-xxxxxxxx.r2.dev`.
   - Option B (better, needs a domain on Cloudflare): **Custom domain** →
     `files.yourdomain.com`.

   **Write down that public URL.** Call it `R2_PUBLIC_URL`.

3. Still in bucket **Settings** → **CORS policy** → Add, paste this
   (replace the netlify line later with your real site URL):

```json
[
  {
    "AllowedOrigins": ["https://your-site.netlify.app", "http://localhost:8080"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

4. R2 main page → **Manage API tokens** → **Create API token**:
   - Permission: **Object Read & Write**
   - Scope: only the `khamec-files` bucket
   - Create → copy **Access Key ID** and **Secret Access Key** (the secret is
     shown only once).

5. On the R2 overview page copy your **Account ID**.

Notepad now has:

```
R2_ACCOUNT_ID        = ...
R2_ACCESS_KEY_ID     = ...
R2_SECRET_ACCESS_KEY = ...
R2_BUCKET            = khamec-files
R2_PUBLIC_URL        = https://pub-xxxx.r2.dev
```

---

## PART 3 — Your new Supabase project

### 3.1 Collect the project values

Supabase dashboard → your project → **Project Settings**:

- **General** → *Reference ID* → this is `PROJECT_REF` (e.g. `abcdefghijklm`).
- **API** → *Project URL* → `SUPABASE_URL` (`https://<ref>.supabase.co`).
- **API Keys** → *anon / publishable* key → `PUBLISHABLE_KEY`.
- **API Keys** → *service_role* key → keep secret, never put it in the app code.
- **Database** → the database password you chose when creating the project.

### 3.2 Create the database (schema)

The whole database structure is in one file: **`supabase/schema.sql`**.

1. Supabase dashboard → **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` from the code folder, copy **everything**, paste it in.
3. Press **Run**. It takes 10–60 seconds.

If the editor complains the script is too big, use the CLI instead:

```bash
supabase login                 # opens the browser
supabase link --project-ref <PROJECT_REF>
supabase db push               # applies every migration in order
```

Check it worked: **Table Editor** should list `patients`, `visits`, `invoices`,
`snap_orders`, `admissions`, `staff`, `user_roles`, `pricelist`, …

### 3.3 Create the storage buckets

Even with R2 the app expects these bucket names to exist (they are the fallback
and `database-exports` is still used by Supabase). Dashboard → **Storage** →
**New bucket**, create these four, all **Private** (public = off):

- `visit-cards`
- `emr-attachments`
- `patient-photos`
- `database-exports`

### 3.4 Auth settings

Dashboard → **Authentication**:

- **Sign In / Providers → Email**: keep Email enabled.
  Turn **Confirm email** OFF (staff accounts are created by the admin).
- **Providers → Anonymous sign-ins**: OFF.
- **URL Configuration → Site URL**: your Netlify URL (fill after Part 6,
  e.g. `https://khamec.netlify.app`).
  **Redirect URLs**: add `https://khamec.netlify.app/**` and
  `http://localhost:8080/**`.

### 3.5 Function secrets

Dashboard → **Edge Functions** → **Secrets** (or Project Settings → Edge
Functions → Secrets) → add each one:

| Secret | Value |
| --- | --- |
| `R2_ACCOUNT_ID` | from Part 2 |
| `R2_ACCESS_KEY_ID` | from Part 2 |
| `R2_SECRET_ACCESS_KEY` | from Part 2 |
| `R2_BUCKET` | `khamec-files` |
| `R2_PUBLIC_URL` | from Part 2 |
| `SEED_ADMIN_EMAIL` | the first admin email you want |
| `SEED_ADMIN_PASSWORD` | a strong password for that admin |
| `SEED_ALLOWED` | `true` (set it back to `false` after the first login) |
| `PAYSTACK_SECRET_KEY` | only if you use Paystack payments |
| `FLUTTERWAVE_SECRET_KEY` | only if you use Flutterwave |
| `FLUTTERWAVE_WEBHOOK_HASH` | only if you use Flutterwave |
| `LOVABLE_API_KEY` | only if you keep the AI snap-OCR feature (see note below) |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided
automatically by Supabase — do **not** add them yourself.

> **snap-ocr note:** it currently uses the Lovable AI gateway. On your own
> Supabase that key no longer works. Either drop the OCR feature, or switch that
> one function to OpenAI/Gemini with your own key. Everything else works without it.

### 3.6 Deploy the edge functions

From the code folder:

```bash
supabase login
supabase link --project-ref <PROJECT_REF>

supabase functions deploy change-password --no-verify-jwt
supabase functions deploy flutterwave-webhook --no-verify-jwt
supabase functions deploy log-error --no-verify-jwt
supabase functions deploy manage-staff-accounts --no-verify-jwt
supabase functions deploy payroll-payment --no-verify-jwt
supabase functions deploy payroll-payment-paystack --no-verify-jwt
supabase functions deploy paystack-webhook --no-verify-jwt
supabase functions deploy r2-delete --no-verify-jwt
supabase functions deploy r2-migrate-storage --no-verify-jwt
supabase functions deploy r2-sign-upload --no-verify-jwt
supabase functions deploy seed-demo-users --no-verify-jwt
supabase functions deploy snap-ocr --no-verify-jwt
```

`--no-verify-jwt` is correct here: every function checks the user's token in its
own code (that is what `requireUser` does).

If you use Paystack/Flutterwave, put these webhook URLs in their dashboards:

```
https://<PROJECT_REF>.supabase.co/functions/v1/paystack-webhook
https://<PROJECT_REF>.supabase.co/functions/v1/flutterwave-webhook
```

---

## PART 4 — Point the app at your Supabase

Edit the file `.env` in the project folder (create it if missing):

```
VITE_SUPABASE_PROJECT_ID="<PROJECT_REF>"
VITE_SUPABASE_URL="https://<PROJECT_REF>.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="<your anon/publishable key>"
VITE_R2_PUBLIC_URL="https://pub-xxxx.r2.dev"
```

Test locally:

```bash
npm run dev
```

Open http://localhost:8080 — you should see the login page.

Create the first admin: sign-in page will not work yet, so call the seeder once:

```bash
curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/seed-demo-users \
  -H "Content-Type: application/json" -d "{}"
```

Now log in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
Afterwards set the secret `SEED_ALLOWED` to `false`.

All other staff accounts are created from **Admin → Staff Accounts** inside the app.

---

## PART 5 — Moving the OLD data (only if you want the existing records)

If the hospital is starting fresh, skip this part.

### 5.1 Database rows

For each table, in the **old** project: Table Editor → open table → the three
dots → **Export data as CSV**. In the **new** project: Table Editor → open the
same table → **Insert → Import data from CSV**.

Import in this exact order (parents before children):

```
1  app_settings, insurance_providers, corporate_accounts, external_doctors, pricelist
2  wards, rooms, beds
3  staff, user_roles
4  patients
5  visits, standing_orders, patient_journey, patient_journey_history
6  admissions
7  invoices, invoice_items
8  balance_transactions, balance_requests, corporate_transactions
9  prescriptions, prescription_items, lab_requests, vitals
10 snap_orders, visit_attachments, emr_attachments, eligibility_verifications
11 insurance_claims, sponsor_statements, sponsor_statement_items
12 payroll_periods, payroll_entries, payroll_deductions, payroll_payments
13 staff_attendance, staff_leave, staff_family_members
14 notifications, task_claims, audit_logs, error_logs
```

> Rows that reference a user id (`auth.users`) only match if the same staff
> accounts exist with the same ids. If they do not, recreate the staff accounts
> in the app first and skip the id columns.

### 5.2 The photo files

The old files live in the old Supabase buckets. Because the R2 keys/paths are
identical, copying is one function call. Log into the **old** app as admin, open
the browser console (F12) and run:

```js
await (await import('/src/integrations/supabase/client.ts')).supabase
  .functions.invoke('r2-migrate-storage', { body: { dryRun: true } })
```

then repeat without `dryRun` and with `{ limit: 200 }` until `copied` is 0.
Full details in `docs/r2-migration.md`.

---

## PART 6 — Netlify deploy

1. https://app.netlify.com → **Add new site → Import an existing project** →
   **GitHub** → pick your repo.
2. Build settings are already read from `netlify.toml`:
   - Build command `npm run build`
   - Publish directory `dist`
3. Before the first deploy click **Add environment variables** (or later:
   Site configuration → Environment variables) and add:

```
VITE_SUPABASE_PROJECT_ID       = <PROJECT_REF>
VITE_SUPABASE_URL              = https://<PROJECT_REF>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY  = <anon key>
VITE_R2_PUBLIC_URL             = https://pub-xxxx.r2.dev
```

4. **Deploy site**. When it finishes you get `https://something.netlify.app`
   (rename it under Site configuration → Change site name).

5. Go back and finish two things with that URL:
   - Supabase → Authentication → URL Configuration → Site URL + Redirect URLs.
   - Cloudflare R2 → bucket → CORS → replace `https://your-site.netlify.app`.

6. Custom domain (optional): Netlify → Domain management → Add a domain, then
   follow their DNS instructions.

Every `git push` to the main branch redeploys automatically.

---

## PART 7 — Final check list

Log in as admin on the Netlify URL and confirm:

- [ ] Login works, sidebar shows the admin modules.
- [ ] Reception: register a test patient — saves without error.
- [ ] Take a snap → the photo opens again after saving (this proves R2 upload +
      read). In Cloudflare R2 → bucket → Objects you should see the new file.
- [ ] Nurse: Snap to Admit → patient appears in Awaiting Room → assign a room.
- [ ] Cashier: record a payment, print a receipt (hospital header shows).
- [ ] Admin → Staff Accounts: create one staff user, log in as them.
- [ ] Delete the test patient's data afterwards.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| White page after deploy | Env vars missing in Netlify → add them → **Clear cache and deploy site**. |
| "Failed to fetch" on login | Wrong `VITE_SUPABASE_URL` or key. |
| Upload fails with 403 | R2 CORS does not list your site URL, or the API token is not Object **Read & Write**. |
| Photo saves but shows broken | `VITE_R2_PUBLIC_URL` wrong, or bucket public access not enabled. |
| "R2 is not configured" | One of the 5 `R2_*` secrets missing in Supabase → add and redeploy the functions. |
| Login page refresh gives 404 | `netlify.toml` missing from the repo (it contains the SPA redirect). |
| Function returns 401 | It was deployed without `--no-verify-jwt`; deploy again with that flag. |

## Security reminder

- The R2 public URL means anyone holding an exact link can open that file.
  Paths use random UUIDs so they cannot be guessed. For stricter control add a
  Cloudflare WAF/hotlink rule limiting the `Referer` to your domain.
- Never put the `service_role` key or the database password in the app code,
  in `.env`, or in Netlify variables — they belong only in Supabase secrets.
