-- 1. Create confirm_recovery_payment RPC
CREATE OR REPLACE FUNCTION public.confirm_recovery_payment(p_rzp_order_id TEXT)
RETURNS TABLE (attributed BOOLEAN, recovery_case_id UUID, recovery_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_payment_order RECORD;
    v_checkout RECORD;
    v_case RECORD;
    v_outreach RECORD;
BEGIN
    -- 1. Lock payment order
    SELECT po.* INTO v_payment_order
    FROM public.payment_orders AS po
    WHERE po.rzp_order_id = p_rzp_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment order not found';
    END IF;

    -- 4. Purpose Handling
    IF v_payment_order.purpose <> 'RECOVERY' THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;

    -- 5. Verified Payment Requirement
    IF v_payment_order.status <> 'PAID' THEN
        RAISE EXCEPTION 'Recovery payment not paid';
    END IF;

    -- 6. Lock Checkout
    SELECT c.* INTO v_checkout
    FROM public.checkouts AS c
    WHERE c.id = v_payment_order.checkout_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Checkout not found';
    END IF;

    IF v_checkout.status <> 'PAID' THEN
        RAISE EXCEPTION 'Checkout not paid';
    END IF;

    -- 7. Lock Recovery Case
    SELECT rc.* INTO v_case
    FROM public.recovery_cases AS rc
    WHERE rc.checkout_id = v_payment_order.checkout_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Recovery case not found';
    END IF;

    -- 8. Idempotent Recovered Case
    IF v_case.status = 'RECOVERED' THEN
        RETURN QUERY SELECT TRUE, v_case.id, 'RECOVERED'::TEXT;
        RETURN;
    END IF;

    -- 9. Allowed Attribution State
    IF v_case.status <> 'MONITORING' THEN
        RAISE EXCEPTION 'Invalid recovery state';
    END IF;

    -- 10. Lock Outreach
    SELECT ro.* INTO v_outreach
    FROM public.recovery_outreach AS ro
    WHERE ro.recovery_case_id = v_case.id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Recovery outreach not found';
    END IF;

    IF v_outreach.opened_at IS NULL THEN
        RAISE EXCEPTION 'Recovery outreach not opened';
    END IF;

    -- 11. Attribution
    UPDATE public.recovery_cases AS rc
    SET status = 'RECOVERED', updated_at = NOW()
    WHERE rc.id = v_case.id;

    -- 12. Audit
    INSERT INTO public.recovery_audit_events (
        checkout_id,
        recovery_case_id,
        event_type,
        payload
    )
    VALUES (
        v_checkout.id,
        v_case.id,
        'RECOVERY_PAYMENT_CONFIRMED',
        jsonb_build_object(
            'payment_order_id', v_payment_order.id,
            'outreach_id', v_outreach.id
        )
    );

    -- 13. Return
    RETURN QUERY SELECT TRUE, v_case.id, 'RECOVERED'::TEXT;
END;
$$;

-- Privileges
REVOKE ALL ON FUNCTION public.confirm_recovery_payment(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_recovery_payment(TEXT) TO service_role;
