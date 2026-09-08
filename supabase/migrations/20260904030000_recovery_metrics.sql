-- Migration: 20260904030000_recovery_metrics.sql

CREATE OR REPLACE FUNCTION public.get_recovery_metrics()
RETURNS TABLE (
    revenue_at_risk_paise BIGINT,
    recovered_revenue_paise BIGINT,
    outstanding_revenue_at_risk_paise BIGINT,
    total_recovery_cases BIGINT,
    recovered_cases BIGINT,
    recovery_rate_percent NUMERIC,
    recent_recoveries JSONB
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
WITH base_stats AS (
    SELECT
        COALESCE(SUM(rc.revenue_at_risk_paise), 0) as total_risk,
        COALESCE(SUM(rc.revenue_at_risk_paise) FILTER (WHERE rc.status <> 'RECOVERED'), 0) as outstanding_risk,
        COUNT(*) as total_cases,
        COUNT(*) FILTER (WHERE rc.status = 'RECOVERED') as recovered_count
    FROM public.recovery_cases rc
),
recovered_stats AS (
    -- Group by checkout_id to ensure we count each recovery at most once
    -- and ensure the join is strict.
    SELECT
        COALESCE(SUM(dp.amount_paise), 0) as recovered_revenue
    FROM public.recovery_cases rc
    JOIN public.checkouts c ON c.id = rc.checkout_id
    CROSS JOIN LATERAL (
        SELECT DISTINCT ON (po.checkout_id) po.amount_paise
        FROM public.payment_orders po
        WHERE po.checkout_id = c.id
        AND po.purpose = 'RECOVERY'
        AND po.status = 'PAID'
        ORDER BY po.checkout_id, po.created_at DESC
    ) dp
    WHERE rc.status = 'RECOVERED'
    AND c.status = 'PAID'
),
recent_list AS (
    SELECT jsonb_agg(r)
    FROM (
        SELECT 
            rc.id as recovery_case_id,
            rc.checkout_id,
            dp.amount_paise,
            rc.updated_at as recovered_at
        FROM public.recovery_cases rc
        JOIN public.checkouts c ON c.id = rc.checkout_id
        CROSS JOIN LATERAL (
            SELECT DISTINCT ON (po.checkout_id) po.amount_paise
            FROM public.payment_orders po
            WHERE po.checkout_id = c.id
            AND po.purpose = 'RECOVERY'
            AND po.status = 'PAID'
            ORDER BY po.checkout_id, po.created_at DESC
        ) dp
        WHERE rc.status = 'RECOVERED'
        AND c.status = 'PAID'
        ORDER BY rc.updated_at DESC
        LIMIT 5
    ) r
)
SELECT
    bs.total_risk,
    rs.recovered_revenue,
    bs.outstanding_risk,
    bs.total_cases,
    bs.recovered_count,
    CASE 
        WHEN bs.total_cases = 0 THEN 0 
        ELSE (bs.recovered_count::numeric / bs.total_cases::numeric) * 100 
    END as recovery_rate_percent,
    COALESCE((SELECT * FROM recent_list), '[]'::jsonb)
FROM base_stats bs, recovered_stats rs;
$$;

REVOKE ALL ON FUNCTION public.get_recovery_metrics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_recovery_metrics() TO service_role;
