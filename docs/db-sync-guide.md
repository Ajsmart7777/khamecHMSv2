# Database Synchronization Guide

`supabase db pull` fails when the remote migration history table lists versions that don't exist as files in `supabase/migrations/`.

## The "Infinite Loop" fix (Current issue)

If you have already run `reverted` and the error persists with the same versions, it means the CLI is detecting a state conflict. Try the **Full Reset** approach:

### 1. Hard Repair (Apply instead of Revert)
Sometimes marking them as `applied` works better to "silence" the ghost entries if the database structure is already correct:

```bash
supabase migration repair --status applied 20260813150000
supabase migration repair --status applied 20260813150100
supabase db pull
```

### 2. Force Sync (Pull with ignoring local)
If `db pull` still fails, you can try to "dump" the remote schema into a single file to bypass the history check, then push:

```bash
supabase db pull --schema public > schema_fix.sql
# Note: This is a manual backup, proceed with caution.
```

### 3. Ultimate Reset (Only if you are stuck)
If nothing else works, you can clear the remote migration history table manually (via the SQL Editor in Lovable Backend) to start fresh from your local files:

```sql
truncate supabase_migrations.schema_migrations;
```
*Then immediately run:*
```bash
supabase migration repair --status applied <every_local_version_id>
supabase db push
```

## Why "reverted" might fail
The `reverted` status tells the remote database "I deleted this migration". If you then run `db pull`, the CLI might see that the remote *still* thinks it should have it or that your local directory is missing mandatory files.

**Recommendation:** Try `--status applied` for the versions `20260813150000` and `20260813150100` as shown in step 1 above.

---

**Why this happens:** migrations applied through the Lovable Cloud backend are recorded in the remote `supabase_migrations.schema_migrations` table, but the generated SQL files are not in your local git checkout. Repairing tells the remote history to sync so local and remote agree.