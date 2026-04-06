-- Team-wide caller pipeline (one row). Accessed only from Vercel serverless with service role.
create table if not exists public.portal_pipeline (
  id smallint primary key default 1,
  constraint portal_pipeline_singleton check (id = 1),
  payload jsonb not null default '{"leads":[],"callLog":[],"appointments":[],"leadRemovalRequests":[],"leadDb":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.portal_pipeline is 'Shared AllSorted Pro caller portal data (leads, log, appts, DB).';

alter table public.portal_pipeline enable row level security;

-- No policies: anon/authenticated cannot read/write; service role bypasses RLS.

insert into public.portal_pipeline (id)
values (1)
on conflict (id) do nothing;
