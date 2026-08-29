CREATE OR REPLACE FUNCTION public.scan_and_abandon_checkouts(
    p_threshold_seconds INTEGER
)
RETURNS TABLE (
    checkout_id UUID,
    case_id UUID,
    amount BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rec RECORD;
    v_new_case_id UUID;
    v_is_eligible BOOLEAN;
BEGIN
    -- First pass: select potential candidates without locking.
    FOR v_rec IN
        SELECT
            c.id,
            c.total_amount_paise
        FROM public.checkouts AS c
        WHERE c.status = 'STARTED'
          AND c.created_at <
              NOW() - (p_threshold_seconds * INTERVAL '1 second')
    LOOP

        -- 1. Lock related payment orders first.
        PERFORM 1
        FROM public.payment_orders AS po
        WHERE po.checkout_id = v_rec.id
        FOR UPDATE;

        -- 2. Lock checkout second.
        PERFORM 1
        FROM public.checkouts AS c
        WHERE c.id = v_rec.id
        FOR UPDATE;

        -- 3. Re-check eligibility after locks are acquired.
        SELECT
            EXISTS (
                SELECT 1
                FROM public.checkouts AS c2
                WHERE c2.id = v_rec.id
                  AND c2.status = 'STARTED'
            )
            AND NOT EXISTS (
                SELECT 1
                FROM public.payment_orders AS po
                WHERE po.checkout_id = v_rec.id
                  AND po.status = 'PAID'
            )
            AND NOT EXISTS (
                SELECT 1
                FROM public.payment_orders AS po
                JOIN public.payment_attempts AS pa
                  ON pa.payment_order_id = po.id
                WHERE po.checkout_id = v_rec.id
                  AND pa.status = 'CAPTURED'
            )
        INTO v_is_eligible;

        IF v_is_eligible THEN

            -- Create exactly one recovery case.
            INSERT INTO public.recovery_cases (
                checkout_id,
                status,
                revenue_at_risk_paise
            )
            VALUES (
                v_rec.id,
                'DETECTED',
                v_rec.total_amount_paise
            )
            ON CONFLICT ON CONSTRAINT recovery_cases_checkout_id_key
            DO NOTHING
            RETURNING id INTO v_new_case_id;

            -- Only change checkout/audit when this scan created the case.
            IF v_new_case_id IS NOT NULL THEN

                UPDATE public.checkouts
                SET
                    status = 'ABANDONED',
                    updated_at = NOW()
                WHERE id = v_rec.id;

                INSERT INTO public.recovery_audit_events (
                    checkout_id,
                    recovery_case_id,
                    event_type,
                    payload
                )
                VALUES (
                    v_rec.id,
                    v_new_case_id,
                    'CHECKOUT_ABANDONED',
                    jsonb_build_object(
                        'threshold_seconds',
                        p_threshold_seconds
                    )
                );

                INSERT INTO public.recovery_audit_events (
                    checkout_id,
                    recovery_case_id,
                    event_type,
                    payload
                )
                VALUES (
                    v_rec.id,
                    v_new_case_id,
                    'RECOVERY_CASE_CREATED',
                    jsonb_build_object(
                        'revenue_at_risk_paise',
                        v_rec.total_amount_paise
                    )
                );

                checkout_id := v_rec.id;
                case_id := v_new_case_id;
                amount := v_rec.total_amount_paise;

                RETURN NEXT;
            END IF;
        END IF;

    END LOOP;
END;
$$;

-- Preserve scanner security.
REVOKE ALL
ON FUNCTION public.scan_and_abandon_checkouts(INTEGER)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.scan_and_abandon_checkouts(INTEGER)
TO service_role;