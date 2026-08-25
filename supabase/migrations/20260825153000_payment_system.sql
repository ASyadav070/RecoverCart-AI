-- Payment System Schema (v3)

CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_id UUID NOT NULL REFERENCES checkouts(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('INITIAL', 'RECOVERY')),
  rzp_order_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CREATING', 'CREATED', 'PAID', 'CANCELLED')),
  amount_paise INTEGER NOT NULL,
  currency TEXT NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(checkout_id, purpose)
);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_order_id UUID NOT NULL REFERENCES payment_orders(id),
  rzp_payment_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CAPTURED', 'FAILED')),
  verified_amount INTEGER NOT NULL,
  failure_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS razorpay_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rzp_event_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED')),
  event_type TEXT NOT NULL,
  sanitized_payload JSONB,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_order_id UUID NOT NULL REFERENCES payment_orders(id),
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: Deny-by-default
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deny all" ON payment_orders USING (false);
ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deny all" ON payment_attempts USING (false);
ALTER TABLE razorpay_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deny all" ON razorpay_webhook_events USING (false);
ALTER TABLE payment_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deny all" ON payment_audit_events USING (false);

-- RPCs
CREATE OR REPLACE FUNCTION public.get_or_create_payment_order(
    p_checkout_id UUID, p_purpose TEXT, p_amount_paise INTEGER, p_currency TEXT, p_idempotency_key TEXT
) RETURNS TABLE(order_id UUID, rzp_order_id TEXT, status TEXT, claimed_by_caller BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_order payment_orders;
BEGIN
    INSERT INTO public.payment_orders (checkout_id, purpose, amount_paise, currency, idempotency_key, rzp_order_id, status)
    VALUES (p_checkout_id, p_purpose, p_amount_paise, p_currency, p_idempotency_key, 'temp_' || gen_random_uuid()::text, 'CREATING')
    ON CONFLICT (checkout_id, purpose) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
    RETURNING * INTO v_order;

    RETURN QUERY SELECT v_order.id, v_order.rzp_order_id, v_order.status, (v_order.status = 'CREATING');
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_payment(
    p_rzp_order_id TEXT, p_rzp_payment_id TEXT, p_amount INTEGER, p_event_id TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_order_id UUID;
    v_checkout_id UUID;
BEGIN
    SELECT id, checkout_id INTO v_order_id, v_checkout_id FROM public.payment_orders WHERE rzp_order_id = p_rzp_order_id AND status != 'PAID';
    
    INSERT INTO public.payment_attempts (payment_order_id, rzp_payment_id, status, verified_amount)
    VALUES (v_order_id, p_rzp_payment_id, 'CAPTURED', p_amount);
    
    UPDATE public.payment_orders SET status = 'PAID' WHERE id = v_order_id;
    UPDATE public.checkouts SET status = 'PAID' WHERE id = v_checkout_id;
    UPDATE public.razorpay_webhook_events SET status = 'PROCESSED', processed_at = NOW() WHERE rzp_event_id = p_event_id;
    
    INSERT INTO public.payment_audit_events (payment_order_id, event_type, payload)
    VALUES (v_order_id, 'PAYMENT_CAPTURED', jsonb_build_object('payment_id', p_rzp_payment_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_payment_order_success(
    p_order_id UUID, p_rzp_order_id TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    UPDATE public.payment_orders SET status = 'CREATED' WHERE id = p_order_id AND status = 'CREATING';
    INSERT INTO public.payment_audit_events (payment_order_id, event_type, payload)
    VALUES (p_order_id, 'ORDER_CREATED', jsonb_build_object('rzp_order_id', p_rzp_order_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_payment_order_failure(
    p_order_id UUID, p_reason TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    UPDATE public.payment_orders SET status = 'CANCELLED' WHERE id = p_order_id AND status = 'CREATING';
    INSERT INTO public.payment_audit_events (payment_order_id, event_type, payload)
    VALUES (p_order_id, 'ORDER_CREATION_FAILED', jsonb_build_object('reason', p_reason));
END;
$$;

CREATE OR REPLACE FUNCTION public.record_failed_attempt(
    p_order_id UUID, p_rzp_payment_id TEXT, p_failure_code TEXT, p_event_id TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    INSERT INTO public.payment_attempts (payment_order_id, rzp_payment_id, status, verified_amount)
    VALUES (p_order_id, p_rzp_payment_id, 'FAILED', 0); -- Amount not verified
    UPDATE public.razorpay_webhook_events SET status = 'PROCESSED', processed_at = NOW() WHERE rzp_event_id = p_event_id;
END;
$$;
