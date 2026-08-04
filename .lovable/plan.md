# Migration: Snaps zuwa Cloudflare R2 + sabon Supabase account + Netlify

Manufa: kada database/storage na Supabase ya cika da hotuna. Duk snaps, patient photos, EMR attachments da eligibility snaps su koma Cloudflare R2. Sannan a shirya project don migration zuwa sabon Supabase account da deploy a Netlify.

## Yanayin yanzu

Duk hotuna suna Supabase Storage a buckets guda uku:

- `visit-cards` — snap orders (photo_path), visit attachments, admission snaps, lab results, eligibility snaps
- `emr-attachments` — EMR files
- `patient-photos` — hoton fuskar patient

Database tables suna ajiye path kawai (misali `snap_orders.photo_path`), ba binary ba — wannan yana da kyau, don haka migration zai zama canza inda ake karanta/rubuta fayil kawai, ba schema ba.

## Tsarin da zan gina

### 1. Storage adapter guda daya (frontend)

Sabon fayil `src/lib/storage.ts` da functions: `uploadFile(bucket, path, file)`, `getFileUrl(bucket, path)`, `deleteFile(bucket, path)`.
Duk wuraren da suke kiran `supabase.storage` kai tsaye (hooks 4 + components 5) su koma amfani da wannan adapter. Bayan haka, canza provider = canza fayil guda.

### 2. R2 backend

- Edge function `r2-sign-upload`: yana tabbatar da JWT + role, yana dawo da presigned PUT URL (S3 API na R2, AWS SigV4 a Deno).
- Browser yana upload kai tsaye zuwa R2 (ba ta cikin Supabase ba) — babu bandwidth cost a Supabase.
- Karatu: saboda ka zaɓi public R2 domain, `getFileUrl` zai dawo da `${R2_PUBLIC_URL}/${bucket}/${path}` kai tsaye — babu kira, saurin loading.
- Delete: edge function `r2-delete` (admin/role-checked).

Secrets da za a bukata: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`.

### 3. Kariya kan public bucket

Public domain yana nufin duk wanda ya san link ɗin zai ga hoton majinyaci. Don rage haɗari:

- Duk sabon path zai zama `<bucket>/<patient_id>/<uuid>.jpg` — random UUID, ba za a iya hasashe ba.
- `Cache-Control` + custom domain a Cloudflare, da Hotlink protection / WAF rule ta yadda sai daga domain ɗin app ɗin.
- Za a rubuta wannan a security memory a matsayin accepted risk.

Idan ka so daga baya, sauyawa zuwa presigned read URLs zai zama canjin function guda a `src/lib/storage.ts`.

### 4. Matsar da tsofaffin fayiloli

Script guda (`scripts/migrate-storage-to-r2.ts`) da zai:

1. Lissafa duk objects a buckets uku ta Supabase service role.
2. Download → upload zuwa R2 da path iri ɗaya (don kada a canza database komai).
3. Tabbatar da count + size sun yi daidai, ya rubuta report.
4. Bayan tabbatarwa, mataki na biyu (na daban) zai share Supabase buckets.

Saboda paths ba za su canza ba, ba a bukatar UPDATE a database — abin da kawai zai canza shine base URL a code.

### 5. Cloudflare setup (matakan da za ka yi da kanka)

Zan ba ka jagora mataki-mataki: ƙirƙirar R2 bucket, kunna public access + custom domain (misali `files.khamec.com`), ƙirƙirar R2 API token (Object Read & Write), sannan ka saka su a matsayin secrets.

### 6. Migration zuwa sabon Supabase account

- Zan haɗa duk migrations ɗin da ake da su zuwa `supabase/schema.sql` guda (tables, enums, functions, triggers, RLS, grants) — sai a gudanar da shi sau ɗaya a sabon project.
- Checklist na data export/import (patients, visits, invoices, da sauransu) ta CSV bisa tsarin dogaro (dependency order).
- Jerin duk edge functions + secrets ɗin kowanne, don sake deploy.
- Auth users: seed admin ta `seed-demo-users`, sauran staff ta `manage-staff-accounts`.
- Bayan R2 migration, storage ba zai zama ɓangaren wannan aikin ba kwata-kwata — wannan shine babbar sauƙin.

### 7. Netlify deploy

- `netlify.toml` da SPA redirect (`/* -> /index.html 200`) da build command.
- Jerin env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`, `VITE_R2_PUBLIC_URL`.
- CORS a R2 bucket don domain ɗin Netlify.

## Tsarin aiki (order)

1. Storage adapter + refactor duk call sites (babu canjin hali tukuna — har yanzu Supabase).
2. Cloudflare R2 setup + secrets.
3. R2 upload/delete edge functions + kunna R2 a adapter.
4. Migrate tsofaffin fayiloli, tabbatarwa, share Supabase buckets.
5. Schema bundle + migration runbook zuwa sabon Supabase.
6. Netlify config + deploy checklist.

## Technical notes

- R2 yana amfani da S3-compatible API; a Deno za a yi SigV4 signing da hannu (ko `aws4fetch` ta `npm:`) — babu bukatar sabon dependency a frontend.
- `snap-ocr` edge function yanzu yana ɗaukar signed URL daga Supabase; zai koma karanta public R2 URL kai tsaye.
- Babu canjin schema ko RLS a wannan aikin — paths ɗin da ke cikin `snap_orders.photo_path`, `visit_attachments.storage_path`, `emr_attachments.file_path`, `patients.photo_path` sun kasance haka.
