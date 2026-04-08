-- Normalized lead queue (one row per lead). Source of truth for queue status; portal_pipeline.payload.leads is deprecated (kept empty after migration).
create table if not exists public.portal_queue_leads (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists portal_queue_leads_updated_at_idx on public.portal_queue_leads (updated_at desc);

comment on table public.portal_queue_leads is 'Caller lead queue — one row per lead; data mirrors client lead object.';

alter table public.portal_queue_leads enable row level security;
