-- Add dispensing tracking columns to invoice_items
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_status text DEFAULT 'pending'; -- 'pending', 'dispensed', 'unavailable', 'refunded'
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_notes text;
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_updated_at timestamptz;
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS dispensing_updated_by uuid REFERENCES auth.users(id);

-- RPC to mark an item as unavailable
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
BEGIN
    SELECT invoice_id, description INTO _invoice_id, _item_desc FROM public.invoice_items WHERE id = _item_id;
    
    UPDATE public.invoice_items
    SET dispensing_status = 'unavailable',
        dispensing_notes = _reason,
        dispensing_updated_at = now(),
        dispensing_updated_by = auth.uid()
    WHERE id = _item_id;

    PERFORM public.write_audit_log(
        'item_marked_unavailable',
        json_build_object('item_id', _item_id, 'reason', _reason, 'description', _item_desc),
        _invoice_id,
        'invoices'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_item_unavailable(uuid, text) TO authenticated;

-- RPC to refund an item
CREATE OR REPLACE FUNCTION public.refund_invoice_item(
    _item_id uuid,
    _payment_method text DEFAULT 'balance'
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _item_total numeric;
    _patient_id uuid;
    _invoice_id uuid;
    _item_desc text;
    _new_balance numeric;
    _is_sponsored boolean;
BEGIN
    -- Check if eligible
    SELECT ii.total, i.patient_id, ii.invoice_id, ii.description, (i.sponsor_type IS NOT NULL) INTO _item_total, _patient_id, _invoice_id, _item_desc, _is_sponsored
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE ii.id = _item_id AND ii.dispensing_status = 'unavailable';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item not eligible for refund (must be unavailable)';
    END IF;

    -- Mark as refunded
    UPDATE public.invoice_items
    SET dispensing_status = 'refunded',
        dispensing_updated_at = now(),
        dispensing_updated_by = auth.uid()
    WHERE id = _item_id;

    -- For Cash/Wallet patients, credit their balance if method is 'balance'
    IF NOT _is_sponsored AND _payment_method = 'balance' THEN
        SELECT public.adjust_patient_balance(
            _item_total,
            'Refund for unavailable: ' || _item_desc,
            _patient_id,
            'cash',
            _invoice_id,
            null,
            'topup'
        ) INTO _new_balance;
    ELSE
        SELECT balance INTO _new_balance FROM public.patients WHERE id = _patient_id;
    END IF;

    PERFORM public.write_audit_log(
        'item_refunded',
        json_build_object('item_id', _item_id, 'amount', _item_total, 'method', _payment_method, 'is_sponsored', _is_sponsored),
        _invoice_id,
        'invoices'
    );

    RETURN json_build_object(
        'success', true,
        'amount', _item_total,
        'new_balance', _new_balance,
        'is_sponsored', _is_sponsored
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.refund_invoice_item(uuid, text) TO authenticated;
