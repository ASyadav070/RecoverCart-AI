-- Recovery Proposals Table
CREATE TABLE IF NOT EXISTS public.recovery_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_case_id UUID NOT NULL UNIQUE REFERENCES public.recovery_cases(id) ON DELETE CASCADE,
  strategy TEXT NOT NULL,
  merchant_rationale TEXT NOT NULL,
  proposed_channel TEXT NOT NULL,
  proposed_message TEXT NOT NULL,
  discount_recommended BOOLEAN NOT NULL DEFAULT FALSE,
  discount_type TEXT CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value NUMERIC(10, 2),
  gemini_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Enforce Discount Consistency
  CONSTRAINT check_discount_consistency CHECK (
    (discount_recommended = FALSE AND discount_type IS NULL AND discount_value IS NULL) OR
    (discount_recommended = TRUE AND discount_type IS NOT NULL AND discount_value > 0)
  )
);

-- Trigger to update updated_at automatically
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.recovery_proposals
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Security: RLS
ALTER TABLE public.recovery_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deny all" ON public.recovery_proposals USING (false);
