-- 1. Recovery Cases Table
CREATE TABLE IF NOT EXISTS public.recovery_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_id UUID NOT NULL UNIQUE REFERENCES public.checkouts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'DETECTED' CHECK (status IN ('DETECTED', 'ANALYSING', 'AWAITING_APPROVAL', 'APPROVED', 'SCHEDULED', 'SENT', 'MONITORING', 'RECOVERED', 'REJECTED', 'ESCALATED', 'STOPPED', 'UNRECOVERED', 'EXPIRED')),
  revenue_at_risk_paise BIGINT NOT NULL CHECK (revenue_at_risk_paise >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2. Audit Table
CREATE TABLE IF NOT EXISTS public.recovery_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_id UUID NOT NULL REFERENCES public.checkouts(id) ON DELETE CASCADE,
  recovery_case_id UUID REFERENCES public.recovery_cases(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 3. Enable RLS
ALTER TABLE public.recovery_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deny all" ON public.recovery_cases USING (false);

ALTER TABLE public.recovery_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deny all" ON public.recovery_audit_events USING (false);

-- 4. Atomic Scanner (Race-Safe)
CREATE OR REPLACE FUNCTION public.scan_and_abandon_checkouts(p_threshold_seconds INTEGER)
RETURNS TABLE (checkout_id UUID, case_id UUID, amount BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_rec RECORD;
  v_new_case_id UUID;
  v_is_eligible BOOLEAN;
BEGIN
  -- Select candidates (unlocked)
  FOR v_rec IN 
    SELECT c.id, c.total_amount_paise FROM public.checkouts AS c
    WHERE c.status = 'STARTED' AND c.created_at < NOW() - (p_threshold_seconds * INTERVAL '1 second')
  LOOP
    -- Lock payment order first to establish consistent locking order
    PERFORM 1 FROM public.payment_orders po WHERE po.checkout_id = v_rec.id FOR UPDATE;
    -- Lock checkout
    PERFORM 1 FROM public.checkouts c WHERE c.id = v_rec.id FOR UPDATE;

    -- Re-check eligibility: Ensure still STARTED AND no payment
    SELECT EXISTS (SELECT 1 FROM public.checkouts c2 WHERE c2.id = v_rec.id AND c2.status = 'STARTED')
       AND (NOT EXISTS (SELECT 1 FROM public.payment_orders po WHERE po.checkout_id = v_rec.id AND po.status = 'PAID')
            AND NOT EXISTS (SELECT 1 FROM public.payment_orders po JOIN public.payment_attempts pa ON pa.payment_order_id = po.id WHERE po.checkout_id = v_rec.id AND pa.status = 'CAPTURED'))
    INTO v_is_eligible;

    IF v_is_eligible THEN
      INSERT INTO public.recovery_cases (checkout_id, status, revenue_at_risk_paise)
      VALUES (v_rec.id, 'DETECTED', v_rec.total_amount_paise)
      ON CONFLICT (checkout_id) DO NOTHING
      RETURNING id INTO v_new_case_id;

      IF v_new_case_id IS NOT NULL THEN
        UPDATE public.checkouts SET status = 'ABANDONED', updated_at = NOW() WHERE id = v_rec.id;
        INSERT INTO public.recovery_audit_events (checkout_id, recovery_case_id, event_type, payload)
        VALUES (v_rec.id, v_new_case_id, 'CHECKOUT_ABANDONED', jsonb_build_object('threshold_seconds', p_threshold_seconds));
        INSERT INTO public.recovery_audit_events (checkout_id, recovery_case_id, event_type, payload)
        VALUES (v_rec.id, v_new_case_id, 'RECOVERY_CASE_CREATED', jsonb_build_object('revenue_at_risk_paise', v_rec.total_amount_paise));
        checkout_id := v_rec.id; case_id := v_new_case_id; amount := v_rec.total_amount_paise;
        RETURN NEXT;
      END IF;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.scan_and_abandon_checkouts(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scan_and_abandon_checkouts(INTEGER) TO service_role;