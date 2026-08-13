# Database Synchronization Guide

`supabase db pull` fails when the remote migration history table lists versions
that don't exist as files in `supabase/migrations/`.

## Current fix (versions reported by the CLI)

Run these in your project folder (note: the command is `supabase`, not `supabase` misspelled):

```bash
supabase migration repair --status reverted 20260813150000
supabase migration repair --status reverted 20260813150100
supabase db pull
```

Use `--status reverted` (not `applied`) because you do **not** have those files
locally — that clears the ghost entries from the remote history table.

If you *do* want to keep them recorded as already applied (because the SQL truly
ran on the remote database and you don't need the files), use the CLI's own
suggestion instead:

```bash
supabase migration repair --status applied 20260813150000
supabase migration repair --status applied 20260813150100
supabase db pull
```

## Then push your local changes

```bash
supabase db push
```

## If new ghost versions appear later

Repeat the same steps with whatever versions the error prints:

```bash
supabase migration list                       # compare local vs remote
supabase migration repair --status reverted <version>
supabase db pull
```

---

**Why this happens:** migrations applied through the Lovable Cloud backend are
recorded in the remote `supabase_migrations.schema_migrations` table, but the
generated SQL files are not in your local git checkout. Repairing tells the
remote history to forget (or accept) those entries so local and remote agree.
