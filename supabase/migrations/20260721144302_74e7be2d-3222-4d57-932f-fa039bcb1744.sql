
-- Normalize legacy 'all' broadcast rows to NULL target_role
UPDATE public.notifications SET target_role = NULL WHERE target_role = 'all';

-- Replace read policy to also allow full broadcasts (both user_id and target_role NULL)
DROP POLICY IF EXISTS "Users can read own or targeted notifications" ON public.notifications;
CREATE POLICY "Users can read own or targeted notifications"
ON public.notifications FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR (user_id IS NULL AND target_role IS NULL)
  OR (user_id IS NULL AND target_role IS NOT NULL AND has_role(auth.uid(), target_role::app_role))
);

DROP POLICY IF EXISTS "Users can update own or targeted notifications" ON public.notifications;
CREATE POLICY "Users can update own or targeted notifications"
ON public.notifications FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  OR (user_id IS NULL AND target_role IS NULL)
  OR (user_id IS NULL AND target_role IS NOT NULL AND has_role(auth.uid(), target_role::app_role))
);
