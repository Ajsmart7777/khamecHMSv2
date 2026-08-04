# Cloudflare R2 storage migration — runbook

All snaps, patient photos, EMR attachments and eligibility snaps can be served
from Cloudflare R2 instead of Supabase Storage, so the Supabase project never
fills up with images.

The app picks the provider at build time:

- `VITE_R2_PUBLIC_URL` set   -> R2
- not set                    -> Supabase Storage (current behaviour)

Object paths are identical in both providers, so no database column changes.

## 1. Cloudflare setup

1. Cloudflare dashboard -> R2 -> **Create bucket** (e.g. `khamec-files`).
2. Bucket -> Settings -> **Public access** -> connect a custom domain
   (e.g. `files.yourdomain.com`). Note the public URL.
3. Bucket -> Settings -> **CORS policy**:

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

4. R2 -> **Manage API tokens** -> Create token, permission **Object Read & Write**,
   scoped to that bucket. Copy Access Key ID + Secret Access Key.
5. Note your Cloudflare **Account ID** (R2 overview page).

## 2. Backend secrets

Add these as project secrets (used by the edge functions):

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_PUBLIC_URL` (e.g. `https://files.yourdomain.com`) — also used by `snap-ocr`

## 3. Frontend env

Add to `.env` (and to Netlify env vars):

```
VITE_R2_PUBLIC_URL=https://files.yourdomain.com
```

Leave it unset to keep using Supabase Storage.

## 4. Copy existing files

Call the admin-only edge function `r2-migrate-storage` (signed in as admin):

```
POST /functions/v1/r2-migrate-storage
{ "dryRun": true }                       // count what would be copied
{ "limit": 200 }                         // copy a batch
{ "bucket": "visit-cards", "limit": 300 }
```

Repeat until `copied` is 0 and `skipped` equals the totals in the report.
Already-present objects are skipped, so the call is safe to re-run.

Only after verifying the counts, delete the Supabase buckets' contents.

## 5. Netlify

`netlify.toml` is committed (build `npm run build`, publish `dist`, SPA redirect).
Environment variables to set in Netlify:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`
- `VITE_R2_PUBLIC_URL`

## Security note

The R2 domain is public: anyone with an exact URL can open the file. Paths use
random UUIDs so they cannot be guessed. For stricter control, add a Cloudflare
WAF / hotlink-protection rule limiting `Referer` to the app domain, or switch
`getFileUrl` in `src/lib/storage.ts` to presigned read URLs.
