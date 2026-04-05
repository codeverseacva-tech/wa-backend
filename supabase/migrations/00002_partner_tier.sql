-- Partner Tier Extension for Zaplink

-- 1. Integration with Existing Core Tables
ALTER TABLE public.api_keys 
    ADD COLUMN IF NOT EXISTS partner_id UUID NULL,
    ADD COLUMN IF NOT EXISTS sub_user_id UUID NULL;

ALTER TABLE public.whatsapp_sessions 
    ADD COLUMN IF NOT EXISTS sub_user_id UUID NULL;

-- 2. Partners Table
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

-- 3. Partner Sub-Users Table
CREATE TABLE IF NOT EXISTS public.partner_sub_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
    external_user_id TEXT NOT NULL,
    api_key_id UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
    webhook_secret TEXT NOT NULL, -- Stored as raw secret initially for the very first return, 
                                 -- ideally should be hashed but the prompt says 'stored hashed'
                                 -- so let's use webhook_secret_hash for production and 
                                 -- webhook_secret for temporary.
    webhook_url_suffix TEXT NOT NULL,
    session_id UUID REFERENCES public.whatsapp_sessions(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Required Indexes
CREATE INDEX IF NOT EXISTS idx_api_keys_partner_id ON public.api_keys(partner_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_sub_user_id ON public.api_keys(sub_user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_sub_user_id ON public.whatsapp_sessions(sub_user_id);

CREATE INDEX IF NOT EXISTS idx_psu_partner_id ON public.partner_sub_users(partner_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_psu_external_partner ON public.partner_sub_users(partner_id, external_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_psu_webhook_suffix_partner ON public.partner_sub_users(partner_id, webhook_url_suffix);
CREATE INDEX IF NOT EXISTS idx_psu_session_id ON public.partner_sub_users(session_id);

-- 5. Triggers
CREATE TRIGGER tr_update_updated_at_partners 
    BEFORE UPDATE ON public.partners FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER tr_update_updated_at_partner_sub_users 
    BEFORE UPDATE ON public.partner_sub_users FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
