-- ============================================================
-- Clinical Coach v2 — Supabase Schema
-- Run this in the Supabase SQL editor after creating your project
-- ============================================================

-- 1. PROFILES TABLE
-- Stores both learner and admin accounts, linked to Supabase Auth
CREATE TABLE IF NOT EXISTS profiles (
  id           UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email        TEXT UNIQUE NOT NULL,
  full_name    TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL CHECK (role IN ('learner', 'admin')) DEFAULT 'learner',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-create a profile row on sign-up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'learner')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 2. CALLS TABLE
-- Logs every Vapi call instance
CREATE TABLE IF NOT EXISTS calls (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID        REFERENCES auth.users ON DELETE SET NULL,
  scenario_slug     TEXT        NOT NULL,
  vapi_call_id      TEXT        UNIQUE,
  status            TEXT        NOT NULL DEFAULT 'active',
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  duration_seconds  INTEGER,
  transcript        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  insight           JSONB       NOT NULL DEFAULT '{}'::jsonb
);

-- Index for fast per-user lookups
CREATE INDEX IF NOT EXISTS calls_user_id_idx ON calls(user_id);
CREATE INDEX IF NOT EXISTS calls_scenario_idx ON calls(scenario_slug);

-- 3. ROW LEVEL SECURITY
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls    ENABLE ROW LEVEL SECURITY;

-- Profiles: users read/update only their own row
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Calls: learners see only their own calls
CREATE POLICY "Users can view own calls"
  ON calls FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own calls"
  ON calls FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own calls"
  ON calls FOR UPDATE USING (auth.uid() = user_id);

-- Admins can see everything
CREATE POLICY "Admins can view all calls"
  ON calls FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
