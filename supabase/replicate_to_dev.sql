-- ==============================================================================
-- Zaplink — Development Database Replication Script (Schema + Seed)
-- Run this in the Supabase Dashboard SQL Editor of your zaplink-dev project.
-- ==============================================================================

-- 1. INITIAL SCHEMA (00001)
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Plans Enum
DO $$ BEGIN
    CREATE TYPE plan_id_enum AS ENUM ('trial', 'starter', 'business', 'custom');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Role Enum
DO $$ BEGIN
    CREATE TYPE user_role_enum AS ENUM ('user', 'super_admin');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Plans Table
CREATE TABLE IF NOT EXISTS public.plans (
    id plan_id_enum PRIMARY KEY,
    name TEXT NOT NULL,
    message_quota INTEGER NOT NULL DEFAULT 0,
    session_limit INTEGER NOT NULL DEFAULT 0,
    price_monthly INTEGER NOT NULL DEFAULT 0,
    price_yearly INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role_enum NOT NULL DEFAULT 'user',
    plan_id plan_id_enum NOT NULL REFERENCES public.plans(id) DEFAULT 'trial',
    is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
    plan_expires_at TIMESTAMPTZ,
    full_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- WhatsApp Sessions Table
CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'disconnected',
    qr_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Groups Table
CREATE TABLE IF NOT EXISTS public.groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES public.whatsapp_sessions(id) ON DELETE CASCADE,
    group_jid TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    participant_count INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Newsletters Table
CREATE TABLE IF NOT EXISTS public.newsletters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES public.whatsapp_sessions(id) ON DELETE CASCADE,
    newsletter_jid TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    subscriber_count INTEGER NOT NULL DEFAULT 0,
    is_owner BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Messages Table
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.whatsapp_sessions(id) ON DELETE CASCADE,
    from_jid TEXT NOT NULL,
    to_jid TEXT NOT NULL,
    message_data JSONB NOT NULL,
    key JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Webhooks Table
CREATE TABLE IF NOT EXISTS public.webhooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    events TEXT[] NOT NULL DEFAULT '{}',
    secret TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Webhook Logs Table
CREATE TABLE IF NOT EXISTS public.webhook_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    webhook_id UUID NOT NULL REFERENCES public.webhooks(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    response_status INTEGER,
    response_body TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- API Keys Table
CREATE TABLE IF NOT EXISTS public.api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    key_name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    permissions TEXT[] NOT NULL DEFAULT '{}',
    rate_limit INTEGER NOT NULL DEFAULT 100,
    expires_at TIMESTAMPTZ,
    ip_whitelist TEXT[] NOT NULL DEFAULT '{}',
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bulk Campaigns Table
CREATE TABLE IF NOT EXISTS public.bulk_campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES public.whatsapp_sessions(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    message_template JSONB NOT NULL,
    recipients JSONB NOT NULL,
    settings JSONB NOT NULL DEFAULT '{}',
    processed_count INTEGER NOT NULL DEFAULT 0,
    total_count INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Scheduled Messages Table
CREATE TABLE IF NOT EXISTS public.scheduled_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES public.whatsapp_sessions(id) ON DELETE SET NULL,
    recipient_phone TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text',
    message_data JSONB NOT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User Usage Stats
CREATE TABLE IF NOT EXISTS public.usage_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    month_year TEXT NOT NULL, -- Format: YYYY-MM
    message_count INTEGER NOT NULL DEFAULT 0,
    session_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, month_year)
);

-- Invoices Table
CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL UNIQUE,
    amount_kes INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'unpaid',
    payment_id TEXT,
    checkout_request_id TEXT,
    result_code TEXT,
    result_desc TEXT,
    external_payment_id TEXT,
    idempotency_key TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_user_id ON public.whatsapp_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_session_id ON public.whatsapp_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_status ON public.whatsapp_sessions(status);
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON public.messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_status ON public.messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages(created_at);
CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON public.webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_created_at ON public.webhooks(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook_id ON public.webhook_logs(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON public.webhook_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON public.api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON public.api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_bulk_campaigns_user_id ON public.bulk_campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_bulk_campaigns_status ON public.bulk_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_user_id ON public.scheduled_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_scheduled_at ON public.scheduled_messages(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_status ON public.scheduled_messages(status);
CREATE INDEX IF NOT EXISTS idx_groups_session_id ON public.groups(session_id);
CREATE INDEX IF NOT EXISTS idx_newsletters_session_id ON public.newsletters(session_id);
CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON public.invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_usage_stats_user_month ON public.usage_stats(user_id, month_year);

-- Functions & Triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
DECLARE
    t text;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.columns 
        WHERE column_name = 'updated_at' 
        AND table_schema = 'public'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS tr_update_updated_at_%I ON public.%I', t, t);
        EXECUTE format('CREATE TRIGGER tr_update_updated_at_%I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column()', t, t);
    END LOOP;
END $$;

-- RPC for atomic plan upgrade
CREATE OR REPLACE FUNCTION upgrade_user_plan(
    p_user_id UUID,
    p_plan_id plan_id_enum,
    p_expires_at TIMESTAMPTZ,
    p_invoice_id UUID DEFAULT NULL
) RETURNS void AS $$
BEGIN
    UPDATE public.profiles
    SET plan_id = p_plan_id,
        plan_expires_at = p_expires_at,
        updated_at = NOW()
    WHERE id = p_user_id;

    IF p_invoice_id IS NOT NULL THEN
        UPDATE public.invoices
        SET status = 'paid',
            updated_at = NOW()
        WHERE id = p_invoice_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS Policies (Permissive for local)
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read on plans" ON public.plans FOR SELECT USING (true);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on profiles" ON public.profiles FOR ALL USING (true);

ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on whatsapp_sessions" ON public.whatsapp_sessions FOR ALL USING (true);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on messages" ON public.messages FOR ALL USING (true);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on api_keys" ON public.api_keys FOR ALL USING (true);

-- 2. PARTNER TIER (00002)
ALTER TABLE public.api_keys 
    ADD COLUMN IF NOT EXISTS partner_id UUID NULL,
    ADD COLUMN IF NOT EXISTS sub_user_id UUID NULL;

ALTER TABLE public.whatsapp_sessions 
    ADD COLUMN IF NOT EXISTS sub_user_id UUID NULL;

CREATE TABLE IF NOT EXISTS public.partners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partner_name TEXT NOT NULL,
    contact_email TEXT NULL,
    master_api_key_id UUID REFERENCES public.api_keys(id) ON DELETE RESTRICT,
    base_webhook_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.partner_sub_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
    external_user_id TEXT NOT NULL,
    api_key_id UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
    webhook_secret TEXT NOT NULL,
    webhook_url_suffix TEXT NOT NULL,
    session_id UUID REFERENCES public.whatsapp_sessions(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_partner_id ON public.api_keys(partner_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_sub_user_id ON public.api_keys(sub_user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_sub_user_id ON public.whatsapp_sessions(sub_user_id);
CREATE INDEX IF NOT EXISTS idx_psu_partner_id ON public.partner_sub_users(partner_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_psu_external_partner ON public.partner_sub_users(partner_id, external_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_psu_webhook_suffix_partner ON public.partner_sub_users(partner_id, webhook_url_suffix);
CREATE INDEX IF NOT EXISTS idx_psu_session_id ON public.partner_sub_users(session_id);

CREATE TRIGGER tr_update_updated_at_partners 
    BEFORE UPDATE ON public.partners FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER tr_update_updated_at_partner_sub_users 
    BEFORE UPDATE ON public.partner_sub_users FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- 3. ADD PARTNER ROLE (00003)
ALTER TYPE public.user_role_enum ADD VALUE IF NOT EXISTS 'partner';

-- 4. SEED DATA (seed.sql)
INSERT INTO public.plans (id, name, message_quota, session_limit, price_monthly, price_yearly)
VALUES
  ('trial',    'Trial',    100,   1, 0,     0),
  ('starter',  'Starter',  5000,  3, 1500,  15000),
  ('business', 'Business', 50000, 10, 5000, 50000),
  ('custom',   'Custom',   -1,   -1, 0,     0)
ON CONFLICT (id) DO NOTHING;

-- Note: Test users must be manually added via auth.users in the dashboard 
-- OR use a management API. For dashboard SQL editor, we can try inserting if 
-- auth.users exists but often triggers or constraints in Supabase management 
-- might interfere. It's best to create users via the 'Authentication' tab 
-- and then link them via IDs.

-- However, for the sake of replication, we'll try:
INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_user_meta_data
) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'test@zaplink.dev',
  -- Password: Test1234! (hashed)
  '$2a$10$WInF6P7Y2mOnnLz8Y/L8XeA6V3e4v5v6v7v8v9v0v1v2v3v4v5v6',
  now(), now(), now(),
  '{"full_name": "Test User"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, role, plan_id)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'user',
  'trial'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_user_meta_data
) VALUES (
  'b0000000-0000-0000-0000-000000000002',
  'testb@zaplink.dev',
  '$2a$10$WInF6P7Y2mOnnLz8Y/L8XeA6V3e4v5v6v7v8v9v0v1v2v3v4v5v6',
  now(), now(), now(),
  '{"full_name": "Test User B"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, role, plan_id)
VALUES (
  'b0000000-0000-0000-0000-000000000002',
  'user',
  'trial'
) ON CONFLICT (id) DO NOTHING;
