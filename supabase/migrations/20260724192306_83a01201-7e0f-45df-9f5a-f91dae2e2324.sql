CREATE POLICY "Uploader or admin update EMR attachments"
ON public.emr_attachments
FOR UPDATE
USING ((uploaded_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
WITH CHECK ((uploaded_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin delete insurance_claims"
ON public.insurance_claims
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));