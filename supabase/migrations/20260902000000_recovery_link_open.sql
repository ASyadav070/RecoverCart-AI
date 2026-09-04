-- 1. ADD opened_at TO recovery_outreach
ALTER TABLE public.recovery_outreach 
ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ NULL;

-- 2. CREATE RPC
CREATE OR REPLACE FUNCTION public.open_recovery_link(
  p_recovery_token_hash TEXT
)
RETURNS TABLE (
  outreach_id UUID,
  recovery_case_id UUID,
  checkout_id UUID,
  case_status TEXT,
  checkout_status TEXT,
  opened_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_outreach public.recovery_outreach%ROWTYPE;
  v_case public.recovery_cases%ROWTYPE;
  v_checkout public.checkouts%ROWTYPE;
BEGIN
  -- 1. Lookup and lock outreach
  SELECT * INTO v_outreach
  FROM public.recovery_outreach
  WHERE recovery_token_hash = p_recovery_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery link not found';
  END IF;

  -- 2. Expiry validation
  IF v_outreach.expires_at <= now() THEN
    RAISE EXCEPTION 'Recovery link expired';
  END IF;

  -- 3. Lock recovery case
  SELECT * INTO v_case
  FROM public.recovery_cases
  WHERE id = v_outreach.recovery_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery case not found';
  END IF;

  -- 4. Lock checkout
  SELECT * INTO v_checkout
  FROM public.checkouts
  WHERE id = v_case.checkout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout not found';
  END IF;

  -- 5. Payment Safety
  IF v_checkout.status = 'PAID' THEN
    RAISE EXCEPTION 'Checkout already paid';
  END IF;

  -- 6. State Validation
  IF v_case.status NOT IN ('SENT', 'MONITORING') THEN
    RAISE EXCEPTION 'Invalid recovery state';
  END IF;

  -- 7. First Open (SENT -> MONITORING)
  IF v_case.status = 'SENT' THEN
    -- Update case status
    UPDATE public.recovery_cases
    SET status = 'MONITORING'
    WHERE id = v_case.id;

    -- Update outreach
    UPDATE public.recovery_outreach
    SET opened_at = COALESCE(opened_at, now())
    WHERE id = v_outreach.id
    RETURNING opened_at INTO v_outreach.opened_at;

    -- Insert Audit
    INSERT INTO public.recovery_audit_events (
      recovery_case_id,
      checkout_id,
      event_type,
      payload
    )
    VALUES (
      v_case.id,
      v_case.checkout_id,
      'RECOVERY_LINK_OPENED',
      jsonb_build_object('outreach_id', v_outreach.id)
    );

    -- Refresh v_case status
    v_case.status := 'MONITORING';
  ELSIF v_case.status = 'MONITORING' THEN
    -- Verify consistency
    IF v_outreach.opened_at IS NULL THEN
       RAISE EXCEPTION 'Recovery link state inconsistent';
    END IF;
  END IF;

  RETURN QUERY
  SELECT 
    v_outreach.id,
    v_case.id,
    v_case.checkout_id,
    v_case.status,
    v_checkout.status,
    v_outreach.opened_at,
    v_outreach.expires_at;
END;
$$;

-- 3. SECURITY
REVOKE ALL ON FUNCTION public.open_recovery_link(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_recovery_link(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.open_recovery_link(TEXT) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.open_recovery_link(TEXT) TO service_role;
