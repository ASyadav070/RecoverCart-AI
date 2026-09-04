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
  SELECT ro.*
  INTO v_outreach
  FROM public.recovery_outreach AS ro
  WHERE ro.recovery_token_hash = p_recovery_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery link not found';
  END IF;

  IF v_outreach.expires_at <= now() THEN
    RAISE EXCEPTION 'Recovery link expired';
  END IF;

  SELECT rc.*
  INTO v_case
  FROM public.recovery_cases AS rc
  WHERE rc.id = v_outreach.recovery_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery case not found';
  END IF;

  SELECT c.*
  INTO v_checkout
  FROM public.checkouts AS c
  WHERE c.id = v_case.checkout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout not found';
  END IF;

  IF v_checkout.status = 'PAID' THEN
    RAISE EXCEPTION 'Checkout already paid';
  END IF;

  IF v_case.status NOT IN ('SENT', 'MONITORING') THEN
    RAISE EXCEPTION 'Invalid recovery state';
  END IF;

  IF v_case.status = 'SENT' THEN

    UPDATE public.recovery_cases AS rc
    SET status = 'MONITORING'
    WHERE rc.id = v_case.id;

    UPDATE public.recovery_outreach AS ro
    SET opened_at = COALESCE(ro.opened_at, now())
    WHERE ro.id = v_outreach.id
    RETURNING ro.opened_at
    INTO v_outreach.opened_at;

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

    v_case.status := 'MONITORING';

  ELSIF v_case.status = 'MONITORING' THEN

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

REVOKE ALL ON FUNCTION public.open_recovery_link(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_recovery_link(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.open_recovery_link(TEXT) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.open_recovery_link(TEXT) TO service_role;