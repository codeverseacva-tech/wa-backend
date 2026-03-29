-- Test user plan data
INSERT INTO public.plans (id, name, message_quota, session_limit, price_monthly, price_yearly)
VALUES
  ('trial',    'Trial',    100,   1, 0,     0),
  ('starter',  'Starter',  5000,  3, 1500,  15000),
  ('business', 'Business', 50000, 10, 5000, 50000),
  ('custom',   'Custom',   -1,   -1, 0,     0)
ON CONFLICT (id) DO NOTHING;

-- Test user (password: Test1234!)
INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_user_meta_data
) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'test@zaplink.dev',
  crypt('Test1234!', gen_salt('bf')),
  now(), now(), now(),
  '{"full_name": "Test User"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- Test user profile
INSERT INTO public.profiles (id, role, plan_id)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'user',
  'trial'
) ON CONFLICT (id) DO NOTHING;

-- Test user B (for tenant isolation tests)
INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_user_meta_data
) VALUES (
  'b0000000-0000-0000-0000-000000000002',
  'testb@zaplink.dev',
  crypt('Test1234!', gen_salt('bf')),
  now(), now(), now(),
  '{"full_name": "Test User B"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, role, plan_id)
VALUES (
  'b0000000-0000-0000-0000-000000000002',
  'user',
  'trial'
) ON CONFLICT (id) DO NOTHING;
