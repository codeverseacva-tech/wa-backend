-- Update partner_sub_users to include display_name for Step 4 compatibility
ALTER TABLE public.partner_sub_users 
ADD COLUMN IF NOT EXISTS display_name TEXT NULL;
