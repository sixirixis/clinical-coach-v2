-- ============================================================
-- Clinical Coach v2 — Supabase Schema
-- Communications skill training simulation app
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Profiles
-- ------------------------------------------------------------
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  full_name text not null default '',
  role text not null check (role in ('learner', 'admin')) default 'learner',
  created_at timestamptz not null default now()
);

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'learner')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ------------------------------------------------------------
-- Scenario configs
-- ------------------------------------------------------------
create table if not exists scenario_configs (
  slug text primary key,
  title text not null,
  status text not null check (status in ('live', 'pilot', 'draft')) default 'draft',
  assistant_id text not null default '',
  opening_line text not null default '',
  script_notes text not null default '',
  image_theme text not null default 'navy',
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Call logs
-- ------------------------------------------------------------
create table if not exists calls (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete set null,
  scenario_slug text not null references scenario_configs(slug) on delete restrict,
  vapi_call_id text unique,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer,
  transcript jsonb not null default '[]'::jsonb,
  insight jsonb not null default '{}'::jsonb
);

create index if not exists calls_user_id_idx on calls(user_id);
create index if not exists calls_scenario_idx on calls(scenario_slug);
create index if not exists calls_started_at_idx on calls(started_at desc);

-- ------------------------------------------------------------
-- Row level security
-- ------------------------------------------------------------
alter table profiles enable row level security;
alter table scenario_configs enable row level security;
alter table calls enable row level security;

-- Safe reruns
Drop policy if exists "users_select_own_profile" on profiles;
Drop policy if exists "users_insert_own_profile" on profiles;
Drop policy if exists "users_update_own_profile" on profiles;
Drop policy if exists "admins_select_all_profiles" on profiles;

Drop policy if exists "authenticated_select_scenarios" on scenario_configs;
Drop policy if exists "admins_manage_scenarios" on scenario_configs;

Drop policy if exists "users_select_own_calls" on calls;
Drop policy if exists "users_insert_own_calls" on calls;
Drop policy if exists "users_update_own_calls" on calls;
Drop policy if exists "admins_manage_all_calls" on calls;

create policy "users_select_own_profile"
  on profiles for select
  using (auth.uid() = id);

create policy "users_insert_own_profile"
  on profiles for insert
  with check (auth.uid() = id);

create policy "users_update_own_profile"
  on profiles for update
  using (auth.uid() = id);

create policy "admins_select_all_profiles"
  on profiles for select
  using (
    exists (
      select 1 from profiles
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "authenticated_select_scenarios"
  on scenario_configs for select
  using (auth.role() = 'authenticated');

create policy "admins_manage_scenarios"
  on scenario_configs for all
  using (
    exists (
      select 1 from profiles
      where id = auth.uid() and role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from profiles
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "users_select_own_calls"
  on calls for select
  using (auth.uid() = user_id);

create policy "users_insert_own_calls"
  on calls for insert
  with check (auth.uid() = user_id);

create policy "users_update_own_calls"
  on calls for update
  using (auth.uid() = user_id);

create policy "admins_manage_all_calls"
  on calls for all
  using (
    exists (
      select 1 from profiles
      where id = auth.uid() and role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- ------------------------------------------------------------
-- Seed the three communication scenarios
-- ------------------------------------------------------------
insert into scenario_configs (slug, title, status, assistant_id, opening_line, script_notes, image_theme)
values
  (
    'angry-relative',
    'Angry patient or relative',
    'live',
    '',
    'I have asked three times already. Why is nobody giving me a straight answer about what is happening?',
    'Primary skill: validate emotion, lower heat, avoid defensiveness, close with clear next steps.',
    'coral'
  ),
  (
    'minor-medical-mishap',
    'Minor medical mishap disclosure',
    'pilot',
    '',
    'Before we go further, I want to explain something that happened during your care today and what we are doing about it.',
    'Primary skill: disclose plainly, own the issue, apologise without evasion, explain remedial action.',
    'teal'
  ),
  (
    'scheduling-change',
    'Unforeseen scheduling change',
    'pilot',
    '',
    'I am sorry, but I need to let you know about an unexpected change to today\'s schedule and help you with the next step.',
    'Primary skill: apologise early, avoid excuse-stacking, offer concrete recovery options.',
    'amber'
  )
on conflict (slug) do nothing;
