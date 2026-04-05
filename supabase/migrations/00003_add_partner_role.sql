-- Add 'partner' role to user_role_enum
ALTER TYPE public.user_role_enum ADD VALUE IF NOT EXISTS 'partner';
