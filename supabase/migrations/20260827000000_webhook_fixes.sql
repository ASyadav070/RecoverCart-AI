-- Webhook Fixes and Atomic Capture v5
-- Provides robust atomic webhook claiming and payment capture with strict security.

-- Atomic Webhook Claim
CREATE OR REPLACE FUNCTION public.claim_webhook_event(p_event_id TEXT, p_event_type TEXT, p_payload JSONB)
RETURNS TABLE (claimed BOOLEAN, already_processed BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_status TEXT;
    v_inserted BIGINT;
BEGIN
    INSERT INTO public.razorpay_webhook_events (rzp_event_id, event_type, status, sanitized_payload)
    VALUES (p_event_id, p_event_type, 'PROCESSING', p_payload)
    ON CONFLICT (rzp_event_id) DO NOTHING;
    
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    
    IF v_inserted = 1 THEN
        RETURN QUERY SELECT true, false;
        RETURN;
    END IF;
    
    -- Check existing status
    SELECT status INTO v_status FROM public.razorpay_webhook_events WHERE rzp_event_id = p_event_id FOR UPDATE;
    
    IF v_status = 'PROCESSED' THEN
        RETURN QUERY SELECT false, true;
    ELSIF v_status = 'FAILED' THEN
        UPDATE public.razorpay_webhook_events SET status = 'PROCESSING' WHERE rzp_event_id = p_event_id;
        RETURN QUERY SELECT true, false;
    ELSE
        -- PROCESSING, return not claimed (409/503 handled by caller)
        RETURN QUERY SELECT false, false;
    END IF;
END;
$$;

-- Capture Payment Atomic
CREATE OR REPLACE FUNCTION public.capture_payment_atomic(
    p_rzp_order_id TEXT, p_rzp_payment_id TEXT, p_amount INTEGER, p_currency TEXT, p_event_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_order RECORD;
    v_webhook_status TEXT;
    v_webhook_event_type TEXT;
    v_attempt_inserted BIGINT;
    v_existing_attempt RECORD;
BEGIN
    -- Check webhook event status and type
    SELECT status, event_type INTO v_webhook_status, v_webhook_event_type
    FROM public.razorpay_webhook_events
    WHERE rzp_event_id = p_event_id
    FOR UPDATE;

    IF v_webhook_status != 'PROCESSING' OR v_webhook_event_type != 'payment.captured' THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_WEBHOOK_STATE');
    END IF;

    -- Lock payment order
    SELECT po.id, po.checkout_id, po.status, po.amount_paise, po.currency 
    INTO v_order 
    FROM public.payment_orders AS po 
    WHERE po.rzp_order_id = p_rzp_order_id 
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;
    
    -- Validate amount/currency before PAID check
    IF v_order.amount_paise != p_amount OR v_order.currency != p_currency THEN
        RETURN jsonb_build_object('success', false, 'error', 'VALIDATION_FAILED');
    END IF;

    -- Already PAID check
    IF v_order.status = 'PAID' THEN
        UPDATE public.razorpay_webhook_events SET status = 'PROCESSED', processed_at = NOW() WHERE rzp_event_id = p_event_id;
        RETURN jsonb_build_object('success', true, 'already_paid', true);
    END IF;
    
    -- Idempotent attempt insertion
    INSERT INTO public.payment_attempts (payment_order_id, rzp_payment_id, status, verified_amount)
    VALUES (v_order.id, p_rzp_payment_id, 'CAPTURED', p_amount)
    ON CONFLICT (rzp_payment_id) DO NOTHING;
    
    GET DIAGNOSTICS v_attempt_inserted = ROW_COUNT;
    
    IF v_attempt_inserted = 0 THEN
        -- Payment ID already exists, check if it belongs to this order
        SELECT payment_order_id, status INTO v_existing_attempt
        FROM public.payment_attempts
        WHERE rzp_payment_id = p_rzp_payment_id;

        IF v_existing_attempt.payment_order_id != v_order.id THEN
            RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_ATTEMPT_CONFLICT');
        END IF;

        IF v_existing_attempt.status != 'CAPTURED' THEN
            RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_ATTEMPT_CONFLICT');
        END IF;
        
        -- Payment was already captured for this order, idempotent success
        UPDATE public.razorpay_webhook_events SET status = 'PROCESSED', processed_at = NOW() WHERE rzp_event_id = p_event_id;
        RETURN jsonb_build_object('success', true, 'already_paid', true);
    END IF;

    -- Transitions - only if attempt was newly inserted
    UPDATE public.payment_orders SET status = 'PAID' WHERE id = v_order.id;
    UPDATE public.checkouts SET status = 'PAID' WHERE id = v_order.checkout_id;
    UPDATE public.razorpay_webhook_events SET status = 'PROCESSED', processed_at = NOW() WHERE rzp_event_id = p_event_id;
    
    -- Audit event - only on new insert
    INSERT INTO public.payment_audit_events (payment_order_id, event_type, payload)
    VALUES (v_order.id, 'PAYMENT_CAPTURED', jsonb_build_object('payment_id', p_rzp_payment_id));
    
    RETURN jsonb_build_object('success', true);
END;
$$;

-- Record Payment Failure
CREATE OR REPLACE FUNCTION public.record_payment_failure(
    p_rzp_order_id TEXT, p_rzp_payment_id TEXT, p_event_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_order_id UUID;
    v_webhook_status TEXT;
    v_webhook_event_type TEXT;
    v_attempt_inserted BIGINT;
    v_existing_attempt RECORD;
BEGIN
    -- Check webhook event status and type
    SELECT status, event_type INTO v_webhook_status, v_webhook_event_type
    FROM public.razorpay_webhook_events
    WHERE rzp_event_id = p_event_id
    FOR UPDATE;

    IF v_webhook_status != 'PROCESSING' OR v_webhook_event_type != 'payment.failed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_WEBHOOK_STATE');
    END IF;

    SELECT id INTO v_order_id FROM public.payment_orders WHERE rzp_order_id = p_rzp_order_id;
    IF v_order_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;

    INSERT INTO public.payment_attempts (payment_order_id, rzp_payment_id, status, verified_amount)
    VALUES (v_order_id, p_rzp_payment_id, 'FAILED', 0)
    ON CONFLICT (rzp_payment_id) DO NOTHING;
    
    GET DIAGNOSTICS v_attempt_inserted = ROW_COUNT;
    
    IF v_attempt_inserted = 0 THEN
        -- Payment ID already exists, check if it belongs to this order
        SELECT payment_order_id, status INTO v_existing_attempt
        FROM public.payment_attempts
        WHERE rzp_payment_id = p_rzp_payment_id;

        IF v_existing_attempt.payment_order_id != v_order_id THEN
            RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_ATTEMPT_CONFLICT');
        END IF;

        IF v_existing_attempt.status != 'FAILED' THEN
            RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_ATTEMPT_CONFLICT');
        END IF;
        
        -- Payment was already recorded as failed for this order, idempotent success
        UPDATE public.razorpay_webhook_events SET status = 'PROCESSED', processed_at = NOW() WHERE rzp_event_id = p_event_id;
        RETURN jsonb_build_object('success', true);
    END IF;

    UPDATE public.razorpay_webhook_events SET status = 'PROCESSED', processed_at = NOW() WHERE rzp_event_id = p_event_id;
    
    -- Audit event - only on new insert
    INSERT INTO public.payment_audit_events (payment_order_id, event_type, payload)
    VALUES (v_order_id, 'PAYMENT_FAILED', jsonb_build_object('payment_id', p_rzp_payment_id));
    
    RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_webhook_event(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_webhook_event(TEXT, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.capture_payment_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_payment_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.record_payment_failure(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_failure(TEXT, TEXT, TEXT) TO service_role;
