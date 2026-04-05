-- Partner Webhook Logging Extension
-- This migration updates the existing webhook_logs to support partner sub-users

-- 1. Make webhook_id nullable since partner webhooks are logged differently
ALTER TABLE public.webhook_logs 
    ALTER COLUMN webhook_id DROP NOT NULL;

-- 2. Add sub_user_id to link logs to partner sub-users
ALTER TABLE public.webhook_logs 
    ADD COLUMN IF NOT EXISTS sub_user_id UUID REFERENCES public.partner_sub_users(id) ON DELETE CASCADE;

-- 3. Add index for performance in partner dashboards
CREATE INDEX IF NOT EXISTS idx_webhook_logs_sub_user_id ON public.webhook_logs(sub_user_id);
