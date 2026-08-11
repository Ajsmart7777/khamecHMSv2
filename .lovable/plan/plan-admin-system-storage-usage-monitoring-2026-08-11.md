# Plan - Admin System Storage & Usage Monitoring

Implement a secure "System Storage" monitoring section in the Admin Dashboard to track Supabase database and Cloudflare R2 usage.

## User Review Required

> [!IMPORTANT]
> The R2 object listing requires the R2 API credentials to have `ListBucket` permissions. I will add an edge function `r2-usage` that uses existing R2 credentials. If listing fails, it will be due to insufficient permissions on the R2 token.

- Do you have a specific storage quota for Supabase or R2 that I should display? (Default: will show "Quota Unavailable" if not detectable).

## Proposed Changes

### Database & Backend
- Create a new Edge Function `r2-usage` to list objects and calculate total size/count from the R2 bucket.
- Create a PostgreSQL function `public.get_database_size()` (SECURITY DEFINER) to safely retrieve the database size for admins.
- Grant appropriate permissions to the new functions.

### Frontend
- Update `src/pages/Admin.tsx`:
    - Add a new "System Storage" tab.
    - Implement `StorageMonitoring` component to fetch and display data.
- Add `src/components/admin/StorageMonitoring.tsx`:
    - Progress bars for usage.
    - Breakdown table for R2 categories (Patient Photos, EMR Attachments, etc.).
    - Refresh functionality.
    - Error handling for failed fetches.
- Add `HardDrive` icon from `lucide-react` to the admin navigation.

## Technical Details

### Security
- All storage retrieval logic is restricted to users with the `admin` role via the `has_role` function.
- No infrastructure secrets (R2 keys, service roles) will be exposed to the frontend; data is proxied through Edge Functions.

### Data Retrieval
- **Supabase**: `pg_database_size()` via RPC.
- **R2**: `S3 ListObjectsV2` API call via Edge Function.

### UI Thresholds
- Healthy: < 70%
- Warning: 70% - 85%
- Critical: > 85%
- (Thresholds only applied if quota is known).
