-- Full migration: normalize all data into dedicated Supabase tables
-- Replaces: portal_pipeline JSON blob, Vercel KV stores, localStorage

-- 1. Call logs (from portal_pipeline.payload.callLog)
create table if not exists public.call_logs (
  id text primary key,
  employee_id text,
  company text default '',
  phone text default '',
  outcome text default 'new',
  notes text default '',
  callback_date text,
  timestamp timestamptz,
  updated_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists call_logs_employee_id_idx on public.call_logs (employee_id);
create index if not exists call_logs_timestamp_idx on public.call_logs (timestamp desc);
alter table public.call_logs enable row level security;

-- 2. Appointments (from portal_pipeline.payload.appointments)
create table if not exists public.appointments (
  id text primary key,
  employee_id text,
  company text default '',
  contact_name text default '',
  phone text default '',
  email text default '',
  status text default 'booked',
  notes text default '',
  appointment_date text,
  created_at timestamptz default now(),
  updated_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists appointments_employee_id_idx on public.appointments (employee_id);
create index if not exists appointments_status_idx on public.appointments (status);
alter table public.appointments enable row level security;

-- 3. Lead removal requests (from portal_pipeline.payload.leadRemovalRequests)
create table if not exists public.lead_removal_requests (
  id text primary key,
  lead_id text,
  employee_id text,
  reason text default '',
  status text default 'pending',
  created_at timestamptz default now(),
  updated_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
alter table public.lead_removal_requests enable row level security;

-- 4. Lead database (from portal_pipeline.payload.leadDb)
create table if not exists public.lead_db (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists lead_db_updated_at_idx on public.lead_db (updated_at desc);
alter table public.lead_db enable row level security;

-- 5. Portal users (from KV portal:u:* + portal:uidx + portal:roster:*)
create table if not exists public.portal_users (
  id text primary key,
  email text unique not null,
  password_hash text not null,
  name text default '',
  role text default 'caller',
  employee_id text,
  employment_status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz not null default now()
);
create index if not exists portal_users_email_idx on public.portal_users (email);
alter table public.portal_users enable row level security;

-- 6. Portal presence (from KV portal:presence:v1:*)
create table if not exists public.portal_presence (
  user_id text primary key,
  last_seen_at timestamptz,
  session_started_at timestamptz,
  last_login_at timestamptz,
  last_ip text default '',
  updated_at timestamptz not null default now()
);
alter table public.portal_presence enable row level security;

-- 7. Timeclock entries (from KV timeclock:log:*)
create table if not exists public.timeclock_entries (
  id bigint generated always as identity primary key,
  user_id text not null,
  entry_type text not null,
  ts timestamptz not null,
  ip text default '',
  note text default '',
  name text default '',
  email text default '',
  shift_start timestamptz,
  breaks jsonb,
  worked_ms bigint,
  adjusted_by text,
  adjusted_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists timeclock_entries_user_id_idx on public.timeclock_entries (user_id);
create index if not exists timeclock_entries_ts_idx on public.timeclock_entries (ts desc);
alter table public.timeclock_entries enable row level security;

-- 8. Timeclock active shifts (from KV timeclock:active:*)
create table if not exists public.timeclock_active_shifts (
  user_id text primary key,
  clocked_in_at timestamptz not null,
  status text default 'working',
  breaks jsonb default '[]'::jsonb,
  email text default '',
  name text default '',
  updated_at timestamptz not null default now()
);
alter table public.timeclock_active_shifts enable row level security;

-- 9. Team chat messages (from KV chat:user:*)
create table if not exists public.team_chat_messages (
  user_id text primary key,
  email text default '',
  name text default '',
  messages jsonb default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.team_chat_messages enable row level security;

-- 10. Team chat clear state (from KV portal:team_chat_clear)
create table if not exists public.team_chat_clear_state (
  user_id text primary key,
  state text not null default 'none',
  requester_email text default '',
  requester_name text default '',
  requested_at timestamptz,
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.team_chat_clear_state enable row level security;

-- 11. Portal content (from KV portal:training_links + portal:assistant_kb)
create table if not exists public.portal_content (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.portal_content enable row level security;

-- 12. Portal roster (presence-reported user metadata, from KV portal:roster:byemail:v1:*)
-- Merged into portal_users. This view provides backward compat if needed.
-- No separate table needed - portal_users covers this.
