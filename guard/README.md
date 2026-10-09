# Edge guard for the public AI endpoints

Four public endpoints on Vercel spend money on every call. They all use the same guard:

| App | Vercel project | Endpoint | Guard module | Guard name |
|---|---|---|---|---|
| AllSorted Pro | clearbooks-landing | `api/team-chat.js` | `lib/edge-guard.js` | `allsorted/team-chat` |
| GlassNav | glassnav | `api/summarize.js` | `api/_guard.js` | `glassnav/summarize` |
| Date HUD | date-hud | `api/ai.js` | `api/_guard.js` | `datehud/ai` |
| ReviewsAndMarketing | reviewsandmarketing | `src/app/api/transcribe/route.ts` | `src/lib/guard.ts` | `randm/transcribe` |

Each request goes through these checks in order:

1. **Origin allowlist.** `Access-Control-Allow-Origin` is sent only for an allowed origin, never `*`. OPTIONS preflight gets 204 (allowed) or 403. A POST with a missing or unknown `Origin` gets 403. Browsers send `Origin` on every POST, same-origin included, and nothing calls these endpoints server to server. The allowlist is `ALLOWED_ORIGINS` (comma separated, which replaces the app's built-in list) plus the deployment's own `VERCEL_URL`, `VERCEL_BRANCH_URL` and `VERCEL_PROJECT_PRODUCTION_URL`, so preview deployments keep working.
2. **Size cap.** If the declared `Content-Length` is over the limit, the request gets 413 before the body is parsed. The bytes actually received are checked as well.
3. **Shared rate limit.** A salted SHA-256 of the client IP (the first `x-forwarded-for` entry, else `x-real-ip`) goes to `edge_guard()` in a Berth Postgres table, through `POST {GUARD_URL}/rpc/edge_guard`. The function atomically bumps a per-IP per-minute counter and a per-endpoint per-UTC-day counter. Over a limit, the endpoint returns 429 with `Retry-After`. Raw IPs never leave Vercel.
4. **Fails closed.** If `GUARD_URL`, `GUARD_KEY` or `GUARD_SALT` is missing, or the RPC errors, returns something odd or takes longer than 3 seconds, the endpoint returns **503** and does not call OpenRouter or OpenAI.

> **Warning: each endpoint returns 503 until `GUARD_URL`, `GUARD_KEY` and `GUARD_SALT` are set in its Vercel project and the project is redeployed.** Set the env vars before deploying this branch.

## 1. Create the Berth app and table (once, shared by all four)

One Berth app holds the counters for all four endpoints. Rows are keyed by endpoint name. The table stays tiny because the function prunes old rows itself.

```sh
berth apps create edgeguard                 # prints the secret key (bsk_...) once; it is also saved locally
berth use edgeguard
```

Berth's SQL route runs one statement per request, so `edge_guard.sql` separates its statements with doubled semicolons. Apply them one by one from the repo root. Every statement is safe to run again:

```sh
python3 - guard/edge_guard.sql <<'PY'
import subprocess, sys
for stmt in open(sys.argv[1]).read().split(';;'):
    body = '\n'.join(l for l in stmt.splitlines() if not l.strip().startswith('--')).strip()
    if body:
        subprocess.run(['berth', 'sql', '--app', 'edgeguard', '-f', '-'], input=stmt, text=True, check=True)
PY
```

Check it (use a throwaway endpoint name so no real counter moves):

```sh
berth sql --app edgeguard "select edge_guard('selftest', repeat('a', 64), 10, 100)"
# {"allowed": true, "reason": "ok", "retry_after": 0}
berth sql --app edgeguard "delete from edge_guard_counters where endpoint = 'selftest'"
```

The table is created with plain SQL, so it gets Berth's default policy: secret key only for both reads and writes. `/rpc/` also needs the secret key.

## 2. Env vars per Vercel project

| Env var | clearbooks-landing (AllSorted) | glassnav | date-hud | reviewsandmarketing |
|---|---|---|---|---|
| `GUARD_URL` | `https://api.atberth.com/v1/apps/edgeguard` | same | same | same |
| `GUARD_KEY` | the edgeguard secret key (`bsk_...`) | same | same | same |
| `GUARD_SALT` | a random string, e.g. `openssl rand -hex 32` | same or its own | same or its own | same or its own |
| `RATE_LIMIT_PER_MINUTE` | `15` | `20` | `12` | `10` |
| `DAILY_REQUEST_CAP` | `1000` | `2000` | `300` | `200` |
| `ALLOWED_ORIGINS` (optional) | default `https://allsortedpro.com,https://www.allsortedpro.com` | default `https://glassnav-tan.vercel.app` | default `https://date-hud.vercel.app` | default `https://www.reviewsandmarketing.com,https://reviewsandmarketing.com` |
| `MAX_AUDIO_BYTES` (optional) | | | | default `4194304` (4 MB) |

If `RATE_LIMIT_PER_MINUTE` and `DAILY_REQUEST_CAP` are not set, the endpoint uses the defaults shown above. Only the three `GUARD_*` vars are required.

Set them with the CLI, for example:

```sh
vercel env add GUARD_URL production          # then paste the value
vercel env add GUARD_KEY production
vercel env add GUARD_SALT production
vercel env add RATE_LIMIT_PER_MINUTE production
vercel env add DAILY_REQUEST_CAP production
```

Add them to `preview` too if previews should have working AI.

## 3. Size caps

| Endpoint | Cap | Why |
|---|---|---|
| AllSorted `team-chat` | 4.25 MB | The dashboard refuses to send more than 4 MB of JSON: up to 6 photos as base64 JPEG (resized to 1280 px) plus 40 messages of history. The extra quarter MB covers multi-byte text. Vercel's own serverless body limit is 4.5 MB. |
| GlassNav `summarize` | 64 KB | Place facts plus up to 5 full Google review texts. The server keeps only 420 characters of each review. |
| Date HUD `ai` | 32 KB | The payload limit after parsing is still 8000 characters. |
| RandM `transcribe` | `MAX_AUDIO_BYTES` (4 MB) plus 16 KB of form overhead | Checked against `Content-Length` and against the bytes actually read. A 180 second recording from `/listen` is about 0.5 to 1.5 MB. Duration is not checked, because MediaRecorder webm files carry no duration header. |

## 4. Reading the counters

```sh
berth sql --app edgeguard "select endpoint, window_start, hits from edge_guard_counters where scope = 'day' order by window_start desc, endpoint"
```
