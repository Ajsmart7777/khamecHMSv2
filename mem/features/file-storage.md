---
name: File storage strategy (Cloudflare R2)
description: All snaps/photos go through src/lib/storage.ts; R2 public domain when VITE_R2_PUBLIC_URL is set, otherwise Supabase Storage
type: feature
---
Never call `supabase.storage` directly in components or hooks — always use
`uploadFile` / `getFileUrl` / `deleteFile` from `src/lib/storage.ts`.

Provider switch: `VITE_R2_PUBLIC_URL` set -> Cloudflare R2 (presigned PUT via
`r2-sign-upload` edge function, reads from the public R2 domain, deletes via
`r2-delete`). Unset -> Supabase Storage signed URLs.

Logical buckets stay `visit-cards`, `emr-attachments`, `patient-photos`; in R2
they are key prefixes inside one bucket. Object paths are identical in both
providers so DB columns (`snap_orders.photo_path`, `visit_attachments.storage_path`,
`emr_attachments.file_path`, `patients.photo_path`) never change.

Accepted risk: the R2 domain is public; paths use random UUIDs. Deploy target is
Netlify (`netlify.toml` with SPA redirect). Runbook: `docs/r2-migration.md`.
