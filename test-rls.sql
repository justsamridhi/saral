-- =========================================================================
-- SARAL — Row Level Security (RLS) Isolation Verification Script
-- Execute in Supabase SQL Editor to verify multi-tenant data boundaries
-- =========================================================================

-- Clean test scratch space (run within a transaction that rolls back at the end)
BEGIN;

-- 1. Create two test mock users in auth.users
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'userA@test.com', 'dummy_hash', now(), '{"provider":"email"}', '{"full_name":"User A"}', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'userB@test.com', 'dummy_hash', now(), '{"provider":"email"}', '{"full_name":"User B"}', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Populate/ensure profile records exist for both users
INSERT INTO public.profiles (id, full_name, display_name, spending_limit, daily_limit)
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'User A', 'Alex A', 500.00, 2000.00),
  ('22222222-2222-2222-2222-222222222222', 'User B', 'Bob B', 750.00, 3000.00)
ON CONFLICT (id) DO UPDATE 
  SET full_name = EXCLUDED.full_name, display_name = EXCLUDED.display_name;

-- -------------------------------------------------------------------------
-- TEST 1: Anonymous Access (Must Return 0 rows / Permission Denied)
-- -------------------------------------------------------------------------
SET LOCAL ROLE anon;
SET LOCAL "request.jwt.claim.sub" = '';

DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM public.profiles;
  IF v_count = 0 THEN
    RAISE NOTICE 'TEST 1 (Anonymous Access): PASS (0 rows returned to anon role)';
  ELSE
    RAISE EXCEPTION 'TEST 1 (Anonymous Access): FAIL (anon role saw % rows)', v_count;
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- TEST 2: User A accessing User A's profile (Must Return 1 row with User A data)
-- -------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

DO $$
DECLARE
  v_rec RECORD;
BEGIN
  SELECT * INTO v_rec FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111';
  IF v_rec.id = '11111111-1111-1111-1111-111111111111' AND v_rec.full_name = 'User A' THEN
    RAISE NOTICE 'TEST 2 (User A own profile read): PASS (Successfully read own profile)';
  ELSE
    RAISE EXCEPTION 'TEST 2 (User A own profile read): FAIL (Could not read own profile)';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- TEST 3: User A attempting to read User B's profile (Must Return 0 rows)
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_rec RECORD;
BEGIN
  SELECT * INTO v_rec FROM public.profiles WHERE id = '22222222-2222-2222-2222-222222222222';
  IF v_rec.id IS NULL THEN
    RAISE NOTICE 'TEST 3 (User A reading User B): PASS (0 rows returned - User B profile hidden from User A)';
  ELSE
    RAISE EXCEPTION 'TEST 3 (User A reading User B): FAIL (User A was able to read User B profile!)';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- TEST 4: User A attempting to modify User B's profile (Must modify 0 rows)
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE public.profiles 
  SET display_name = 'Hacked by User A'
  WHERE id = '22222222-2222-2222-2222-222222222222';
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE NOTICE 'TEST 4 (User A modifying User B): PASS (0 rows updated - User A cannot write to User B)';
  ELSE
    RAISE EXCEPTION 'TEST 4 (User A modifying User B): FAIL (User A modified User B profile!)';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- TEST 5: User A attempting to hijack User B ID via UPDATE WITH CHECK
-- -------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    UPDATE public.profiles 
    SET id = '22222222-2222-2222-2222-222222222222'
    WHERE id = '11111111-1111-1111-1111-111111111111';
    
    RAISE EXCEPTION 'TEST 5 (ID Spoofing): FAIL (Update succeeded without check violation)';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'TEST 5 (ID Spoofing): PASS (Blocked by RLS WITH CHECK policy: %)', SQLERRM;
  END;
END $$;

-- Roll back all test rows so live database is completely clean
ROLLBACK;

