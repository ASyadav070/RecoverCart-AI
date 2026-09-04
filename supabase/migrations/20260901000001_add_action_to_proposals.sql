-- Add action column to recovery_proposals
-- Note: Ensure existing rows are manually handled or deleted before applying this, 
-- as the 'action' column is now NOT NULL.

ALTER TABLE public.recovery_proposals 
ADD COLUMN action TEXT NOT NULL 
CHECK (action IN ('CART_REMINDER', 'PAYMENT_RETRY', 'PAYMENT_ASSISTANCE', 'INCENTIVE_RECOVERY', 'ESCALATE', 'STOP_RECOVERY'));
