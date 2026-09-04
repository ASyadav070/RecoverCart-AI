-- 1. CREATE recovery_outreach
CREATE TABLE IF NOT EXISTS public.recovery_outreach (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_case_id UUID NOT NULL REFERENCES public.recovery_cases(id) ON DELETE CASCADE UNIQUE,
  recovery_proposal_id UUID NOT NULL REFERENCES public.recovery_proposals(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL', 'WHATSAPP')),
  message_body TEXT NOT NULL,
  recovery_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS and deny by default
ALTER TABLE public.recovery_outreach ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny all access to recovery_outreach"
  ON public.recovery_outreach
  FOR ALL
  TO public, anon, authenticated
  USING (false);

-- 2. ATOMIC RPC
CREATE OR REPLACE FUNCTION public.send_recovery_outreach(
  p_case_id UUID,
  p_channel TEXT,
  p_message_body TEXT,
  p_recovery_token_hash TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS public.recovery_outreach
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_case public.recovery_cases%ROWTYPE;
  v_proposal public.recovery_proposals%ROWTYPE;
  v_outreach public.recovery_outreach%ROWTYPE;
BEGIN
  -- 1. Lock the case
  SELECT * INTO v_case
  FROM public.recovery_cases
  WHERE id = p_case_id
  FOR UPDATE;

  -- 2. Check if case exists
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case not found';
  END IF;

  -- 3. Idempotency check
 IF v_case.status = 'SENT' THEN
  SELECT * INTO v_outreach
  FROM public.recovery_outreach
  WHERE recovery_case_id = p_case_id;

  IF FOUND THEN
    RETURN v_outreach;
  END IF;

  RAISE EXCEPTION 'Outreach state inconsistent';
END IF;

  -- 4. Status MUST be APPROVED
  IF v_case.status != 'APPROVED' THEN
    RAISE EXCEPTION 'Invalid state for outreach';
  END IF;

  -- 5. Fetch proposal
  SELECT * INTO v_proposal
  FROM public.recovery_proposals
  WHERE recovery_case_id = p_case_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No proposal found';
  END IF;

  -- 6. Verify channel matches
  IF p_channel != v_proposal.proposed_channel THEN
    RAISE EXCEPTION 'Channel mismatch: p_channel must match the approved proposal channel';
  END IF;

  -- 7. Verify message body contains the approved message
  IF strpos(p_message_body, v_proposal.proposed_message) = 0 THEN
    RAISE EXCEPTION 'Message body must contain the approved proposed message';
  END IF;


-- Validate recovery link expiry
IF p_expires_at <= now() THEN
  RAISE EXCEPTION 'Recovery link expiry must be in the future';
END IF;
  -- 8. Insert outreach
  INSERT INTO public.recovery_outreach (
    recovery_case_id,
    recovery_proposal_id,
    channel,
    message_body,
    recovery_token_hash,
    expires_at
  )
  VALUES (
    p_case_id,
    v_proposal.id,
    p_channel,
    p_message_body,
    p_recovery_token_hash,
    p_expires_at
  )
  RETURNING * INTO v_outreach;

  -- 9. Update case status
  UPDATE public.recovery_cases
  SET status = 'SENT'
  WHERE id = p_case_id;

  -- 10. Insert audit
  INSERT INTO public.recovery_audit_events (
    recovery_case_id,
    checkout_id,
    event_type,
    payload
  )
  VALUES (
    p_case_id,
    v_case.checkout_id,
    'RECOVERY_OUTREACH_SENT',
    jsonb_build_object(
      'channel', p_channel,
      'outreach_id', v_outreach.id
    )
  );

  RETURN v_outreach;
END;
$$;

-- 3. SECURITY
REVOKE ALL ON FUNCTION public.send_recovery_outreach(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_recovery_outreach(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.send_recovery_outreach(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.send_recovery_outreach(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
