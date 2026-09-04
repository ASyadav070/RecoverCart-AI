-- Recovery State Transition RPCs

-- 1. claim_recovery_generation
CREATE OR REPLACE FUNCTION public.claim_recovery_generation(p_case_id UUID)
RETURNS TEXT -- Returns the original status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_original_status TEXT;
BEGIN
  -- Lock and claim
  SELECT status INTO v_original_status
  FROM public.recovery_cases
  WHERE id = p_case_id
  FOR UPDATE;

  IF v_original_status IS NULL THEN
    RAISE EXCEPTION 'Case not found';
  END IF;

  IF v_original_status NOT IN ('DETECTED', 'REJECTED') THEN
    RAISE EXCEPTION 'Invalid state for generation: %', v_original_status;
  END IF;

  UPDATE public.recovery_cases
  SET status = 'ANALYSING', updated_at = NOW()
  WHERE id = p_case_id;

  RETURN v_original_status;
END;
$$;

-- 2. finalize_recovery_generation
CREATE OR REPLACE FUNCTION public.finalize_recovery_generation(
  p_case_id UUID,
  p_proposal_data JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_is_regeneration BOOLEAN;
  v_status TEXT;
BEGIN
  -- Lock and validate state
  SELECT status INTO v_status FROM public.recovery_cases WHERE id = p_case_id FOR UPDATE;
  
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Case not found';
  END IF;

  IF v_status != 'ANALYSING' THEN
    RAISE EXCEPTION 'Case not in ANALYSING state';
  END IF;

  -- Derive regeneration status
  v_is_regeneration := EXISTS (
    SELECT 1
    FROM public.recovery_proposals
    WHERE recovery_case_id = p_case_id
  );

  -- Upsert proposal
  INSERT INTO public.recovery_proposals (
    recovery_case_id, 
    action, 
    strategy, 
    merchant_rationale, 
    proposed_channel, 
    proposed_message, 
    discount_recommended,
    discount_type,
    discount_value,
    gemini_metadata
  )
  VALUES (
    p_case_id,
    p_proposal_data->>'action',
    p_proposal_data->>'strategy',
    p_proposal_data->>'merchant_rationale',
    p_proposal_data->>'proposed_channel',
    p_proposal_data->>'proposed_message',
    (p_proposal_data->'discount'->>'recommended')::BOOLEAN,
    p_proposal_data->'discount'->>'type',
    (CASE WHEN p_proposal_data->'discount'->>'value' IS NULL THEN NULL ELSE (p_proposal_data->'discount'->>'value')::NUMERIC END),
    p_proposal_data->'gemini_metadata'
  )
  ON CONFLICT (recovery_case_id) DO UPDATE SET
    action = EXCLUDED.action,
    strategy = EXCLUDED.strategy,
    merchant_rationale = EXCLUDED.merchant_rationale,
    proposed_channel = EXCLUDED.proposed_channel,
    proposed_message = EXCLUDED.proposed_message,
    discount_recommended = EXCLUDED.discount_recommended,
    discount_type = EXCLUDED.discount_type,
    discount_value = EXCLUDED.discount_value,
    gemini_metadata = EXCLUDED.gemini_metadata;

  -- Finalize case
  UPDATE public.recovery_cases
  SET status = 'AWAITING_APPROVAL', updated_at = NOW()
  WHERE id = p_case_id;

  -- Audit
  INSERT INTO public.recovery_audit_events (
  checkout_id,
  recovery_case_id,
  event_type,
  payload
)
SELECT
  checkout_id,
  id,
  CASE
    WHEN v_is_regeneration
      THEN 'RECOVERY_STRATEGY_REGENERATED'
    ELSE 'RECOVERY_STRATEGY_GENERATED'
  END,
  jsonb_build_object(
    'model', p_proposal_data->'gemini_metadata'->>'model',
    'fallback_attempt',
      p_proposal_data->'gemini_metadata'->'fallback_attempt'
  )
FROM public.recovery_cases
WHERE id = p_case_id;
$$;

-- 3. fail_recovery_generation
CREATE OR REPLACE FUNCTION public.fail_recovery_generation(p_case_id UUID, p_original_status TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_original_status NOT IN ('DETECTED', 'REJECTED') THEN
    RAISE EXCEPTION 'Invalid restoration status: %', p_original_status;
  END IF;

  UPDATE public.recovery_cases
  SET status = p_original_status, updated_at = NOW()
  WHERE id = p_case_id AND status = 'ANALYSING';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case not in ANALYSING state';
  END IF;
END;
$$;

-- 4. approve_recovery_proposal
CREATE OR REPLACE FUNCTION public.approve_recovery_proposal(p_case_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM public.recovery_cases WHERE id = p_case_id FOR UPDATE;

  IF v_status IS NULL THEN RAISE EXCEPTION 'Case not found'; END IF;
  IF v_status = 'APPROVED' THEN RETURN; END IF;
  IF v_status != 'AWAITING_APPROVAL' THEN RAISE EXCEPTION 'Invalid state for approval: %', v_status; END IF;
  
  -- Verify proposal exists
  IF NOT EXISTS (SELECT 1 FROM public.recovery_proposals WHERE recovery_case_id = p_case_id) THEN
    RAISE EXCEPTION 'No proposal found';
  END IF;

  UPDATE public.recovery_cases SET status = 'APPROVED', updated_at = NOW() WHERE id = p_case_id;

  INSERT INTO public.recovery_audit_events (checkout_id, recovery_case_id, event_type, payload)
  SELECT checkout_id, id, 'PROPOSAL_APPROVED', jsonb_build_object('approved_at', NOW())
  FROM public.recovery_cases WHERE id = p_case_id;
END;
$$;

-- 5. reject_recovery_proposal
CREATE OR REPLACE FUNCTION public.reject_recovery_proposal(p_case_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM public.recovery_cases WHERE id = p_case_id FOR UPDATE;

  IF v_status IS NULL THEN RAISE EXCEPTION 'Case not found'; END IF;
  IF v_status = 'REJECTED' THEN RETURN; END IF;
  IF v_status != 'AWAITING_APPROVAL' THEN RAISE EXCEPTION 'Invalid state for rejection: %', v_status; END IF;
  
  -- Verify proposal exists
  IF NOT EXISTS (SELECT 1 FROM public.recovery_proposals WHERE recovery_case_id = p_case_id) THEN
    RAISE EXCEPTION 'No proposal found';
  END IF;

  UPDATE public.recovery_cases SET status = 'REJECTED', updated_at = NOW() WHERE id = p_case_id;

  INSERT INTO public.recovery_audit_events (checkout_id, recovery_case_id, event_type, payload)
  SELECT checkout_id, id, 'PROPOSAL_REJECTED', jsonb_build_object('rejected_at', NOW())
  FROM public.recovery_cases WHERE id = p_case_id;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.claim_recovery_generation(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_recovery_generation(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_recovery_generation(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_recovery_proposal(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_recovery_proposal(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_recovery_generation(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_recovery_generation(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_recovery_generation(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_recovery_proposal(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_recovery_proposal(UUID) TO service_role;
