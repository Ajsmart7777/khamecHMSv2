# Database Synchronization Guide

Your local migration history is currently out of sync with your remote Supabase project. To fix this and successfully run `supabase db push`, follow these steps:

### 1. Identify the Mismatched Versions
The error "Remote migration versions not found in local migrations directory" means your remote database thinks certain migration files exist that are missing from your `supabase/migrations` folder.

### 2. Repair the Migration History
Run the following commands in your terminal to tell Supabase to ignore the missing "ghost" migrations and mark your local state as the source of truth:

```bash
supabase migration repair --status applied 20260809155732
supabase migration repair --status applied 20260809155809
supabase migration repair --status applied 20260809155819
supabase migration repair --status applied 20260809161239
supabase migration repair --status applied 20260809162027
```

*Note: Replace the timestamps above with any other versions specifically mentioned in your terminal error.*

### 3. Push Your Changes
Once the history is repaired, push your local changes to your production project:

```bash
supabase db push
```

### 4. Pull to Confirm
Finally, ensure your local environment matches the remote state:

```bash
supabase db pull
```
