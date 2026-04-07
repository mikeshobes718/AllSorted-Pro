-- Server-side signup approval (email identity). No row = legacy users allowed.
create table if not exists public.portal_access (
  email text primary key,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.portal_access is 'Caller portal signup approval by email. Missing row = grandfathered access.';

alter table public.portal_access enable row level security;

create index if not exists portal_access_status_idx on public.portal_access (status);
