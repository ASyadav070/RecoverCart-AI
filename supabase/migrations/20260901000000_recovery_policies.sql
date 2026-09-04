-- New Recovery Policies Table
CREATE TABLE IF NOT EXISTS public.recovery_policies (
  merchant_id UUID PRIMARY KEY,
  discounts_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  max_discount_percentage INT NOT NULL DEFAULT 0 CHECK (max_discount_percentage >= 0 AND max_discount_percentage <= 100),
  high_value_threshold_paise BIGINT NOT NULL DEFAULT 0 CHECK (high_value_threshold_paise >= 0),
  low_stock_threshold INT NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS: Deny all by default
ALTER TABLE public.recovery_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deny all" ON public.recovery_policies USING (false);
