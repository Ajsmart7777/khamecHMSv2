# Plan - Fix Migration Errors and Update UI Version Indicators

The user is experiencing errors when running migrations via the Supabase CLI. Based on the provided image, the error is: "Remote migration versions not found in local migrations directory." This typically happens when the local migration files don't match the migration history in the remote database. I will provide instructions to repair the migration history and ensure the UI correctly reflects the latest build.

## User Review Required

> [!IMPORTANT]
> To fix the "Remote migration versions not found" error, you need to run specific commands on your local machine. I will provide the commands below, but please confirm you are comfortable running `supabase migration repair` on your local environment.

## Proposed Changes

### Database & Migrations
- Provide instructions to the user to fix the Supabase CLI migration error.
- The error indicates that the local repository is missing migrations that exist on the remote server.
- The fix involves running `supabase migration repair` to synchronize the local state with the remote state.

### UI Enhancements (Visual Text Edits)
- Update the version number in `vite.config.ts` from `1.4.2` to `1.4.3`.
- Enhance the version indicators in `TopBar.tsx` and `AppSidebar.tsx` to be more robust and clear.
- Ensure the version string displays as requested (v1.4.3.[commit_hash]).

## Technical Details

### Migration Fix (Instructions for User)
Run these commands in your local project terminal:
1. `supabase migration repair --status reverted 20260813145044 20260813145156` (matches the versions in the user's error screenshot).
2. `supabase db pull` to fetch any missing remote migrations to your local machine.
3. `supabase migration up` to apply any pending local migrations.

### Code Modifications
- **vite.config.ts**: Increment `VITE_APP_VERSION` to `1.4.3`.
- **src/components/layout/TopBar.tsx**: Update display logic for `VITE_APP_VERSION`.
- **src/components/layout/AppSidebar.tsx**: Update display logic for `VITE_APP_VERSION`.
