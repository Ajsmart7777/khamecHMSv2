-- Fix for public.write_audit_log(unknown, json, uuid, unknown) does not exist error
-- This aligns the function definition with the calls being made in the workflow.

CREATE OR REPLACE FUNCTION public.write_audit_log(
    _action text,
    _details jsonb,
    _resource_id uuid,
    _resource_type text,
    _status text DEFAULT 'success'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _uid uuid := auth.uid();
    _role text := public.current_actor_role(auth.uid());
BEGIN
    INSERT INTO public.audit_logs (
        user_id,
        action,
        resource_type,
        resource_id,
        details,
        status,
        actor_role
    )
    VALUES (
        _uid,
        _action,
        _resource_type,
        _resource_id::text,
        COALESCE(_details, '{}'::jsonb) || jsonb_build_object('actor_role', _role),
        _status,
        _role
    );
END;
$$;

-- Grant permissions for both signatures just to be safe during transition
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, jsonb, uuid, text, text) TO service_role;

-- Hardening mark_item_unavailable to handle sponsored patients directly
-- If a patient is insurance/corporate/retainer (0% copay), we flag it for removal from claim.
CREATE OR REPLACE FUNCTION public.mark_item_unavailable(
    _item_id uuid,
    _reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _invoice_id uuid;
    _item_desc text;
    _current_status text;
    _is_sponsored boolean;
    _patient_id uuid;
BEGIN
    SELECT ii.invoice_id, ii.description, ii.dispensing_status, (i.sponsor_type IS NOT NULL AND i.sponsor_type != 'cash' AND i.sponsor_type != 'normal'), i.patient_id
    INTO _invoice_id, _item_desc, _current_status, _is_sponsored, _patient_id
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE ii.id = _item_id;
    
    IF _current_status = 'unavailable' THEN
        RAISE EXCEPTION 'Item is already marked as unavailable';
    END IF;

    IF _current_status = 'refunded' THEN
        RAISE EXCEPTION 'Item has already been refunded';
    END IF;
    
    UPDATE public.invoice_items
    SET dispensing_status = 'unavailable',
        dispensing_notes = _reason,
        dispensing_updated_at = now(),
        dispensing_updated_by = auth.uid()
    WHERE id = _item_id;

    -- Logging with the fixed function signature
    PERFORM public.write_audit_log(
        'item_marked_unavailable',
        jsonb_build_object('item_id', _item_id, 'reason', _reason, 'description', _item_desc, 'is_sponsored', _is_sponsored),
        _invoice_id,
        'invoices'
    );
END;
$$;