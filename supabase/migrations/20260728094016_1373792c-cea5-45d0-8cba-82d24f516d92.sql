
DROP POLICY "Admin delete insurance_claims" ON public.insurance_claims;
CREATE POLICY "Admin delete insurance_claims" ON public.insurance_claims
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY "Uploader or admin update EMR attachments" ON public.emr_attachments;
CREATE POLICY "Uploader or admin update EMR attachments" ON public.emr_attachments
  FOR UPDATE TO authenticated
  USING ((uploaded_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK ((uploaded_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY "Fulfillers update only paid snap orders" ON public.snap_orders;
CREATE POLICY "Fulfillers update only paid snap orders" ON public.snap_orders
  FOR UPDATE TO authenticated
  USING ((status = 'paid'::text) AND (((target_station = 'pharmacy'::text) AND has_role(auth.uid(), 'pharmacist'::app_role)) OR ((target_station = 'lab'::text) AND has_role(auth.uid(), 'lab_tech'::app_role))))
  WITH CHECK ((status = ANY (ARRAY['paid'::text, 'fulfilled'::text, 'rejected'::text])) AND (((target_station = 'pharmacy'::text) AND has_role(auth.uid(), 'pharmacist'::app_role)) OR ((target_station = 'lab'::text) AND has_role(auth.uid(), 'lab_tech'::app_role))));
