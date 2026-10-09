-- edge_guard: shared rate limit and daily cap for public AI endpoints on Vercel.
--
-- One copy of this file lives in each repo that uses it (AllSorted Pro,
-- GlassNav, Date HUD, ReviewsAndMarketing). Keep them identical.
--
-- The Vercel functions call it through Berth's RPC route with the app's secret
-- key:  POST {GUARD_URL}/rpc/edge_guard
--       {"p_endpoint": "glassnav/summarize", "p_ip_hash": "<64 hex>",
--        "p_per_minute": 20, "p_daily_cap": 2000}
-- and get back {"allowed": true|false, "reason": "...", "retry_after": n}.
--
-- Statements are separated by doubled semicolons because Berth's SQL route runs
-- one statement per request. guard/README.md has the loop that applies them.
-- Every statement is safe to run again.
--
-- The table is created with plain SQL, so Berth gives it the default policy:
-- read and write with the secret key only. Nothing here stores a raw IP; the
-- functions send a salted SHA-256 of it.

create table if not exists edge_guard_counters (
  endpoint     text        not null,
  scope        text        not null check (scope in ('ip', 'day')),
  subject      text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (endpoint, scope, subject, window_start)
);;

create index if not exists edge_guard_counters_window_idx
  on edge_guard_counters (window_start);;

create or replace function edge_guard(p_endpoint text, p_ip_hash text, p_per_minute int, p_daily_cap int)
returns jsonb
language plpgsql
as $$
declare
  v_now    timestamptz := now();
  v_minute timestamptz := date_trunc('minute', v_now);
  v_day    timestamptz := date_trunc('day', v_now, 'UTC');
  v_ip     integer;
  v_daily  integer;
begin
  if p_endpoint is null or p_endpoint !~ '^[a-z0-9][a-z0-9/_-]{0,63}$'
     or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$'
     or p_per_minute is null or p_per_minute < 1
     or p_daily_cap is null or p_daily_cap < 1 then
    return jsonb_build_object('allowed', false, 'reason', 'bad_request', 'retry_after', 60);
  end if;

  -- Per-IP, per-minute counter. Checked first so a flood from one address is
  -- turned away without spending the endpoint's daily budget.
  insert into edge_guard_counters as c (endpoint, scope, subject, window_start, hits)
  values (p_endpoint, 'ip', p_ip_hash, v_minute, 1)
  on conflict (endpoint, scope, subject, window_start)
  do update set hits = c.hits + 1
  returning c.hits into v_ip;

  if v_ip > p_per_minute then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'rate_limited',
      'retry_after', greatest(1, 60 - floor(extract(second from v_now))::int)
    );
  end if;

  -- Per-endpoint, per-UTC-day counter. One row per endpoint per day, so
  -- concurrent requests serialize on that row and the count stays exact.
  insert into edge_guard_counters as c (endpoint, scope, subject, window_start, hits)
  values (p_endpoint, 'day', '', v_day, 1)
  on conflict (endpoint, scope, subject, window_start)
  do update set hits = c.hits + 1
  returning c.hits into v_daily;

  if v_daily > p_daily_cap then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily_cap',
      'retry_after', greatest(60, ceil(extract(epoch from (v_day + interval '1 day' - v_now)))::int)
    );
  end if;

  -- Cheap pruning: about one call in fifty clears minute rows older than two
  -- minutes and day rows older than a week, using the window_start index.
  if random() < 0.02 then
    delete from edge_guard_counters
    where (scope = 'ip' and window_start < v_minute - interval '2 minutes')
       or (scope = 'day' and window_start < v_day - interval '7 days');
  end if;

  return jsonb_build_object('allowed', true, 'reason', 'ok', 'retry_after', 0);
end;
$$;;
