/* Edge guard for the public AI endpoint: origin allowlist, request size cap,
   and a per-IP rate limit plus a daily cap kept in a shared Berth table
   (guard/edge_guard.sql). Serverless instances share no memory, so the
   counters live in Postgres and are bumped through Berth's RPC route.

   Fails closed: if GUARD_URL, GUARD_KEY or GUARD_SALT is missing, or the RPC
   errors or takes longer than GUARD_TIMEOUT_MS, the request is refused with
   503 before any paid model call. The same design runs in GlassNav,
   Date HUD and ReviewsAndMarketing; see guard/README.md. */
const { createHash } = require('node:crypto');

// This app's own sites. ALLOWED_ORIGINS (comma separated) replaces the list;
// the deployment's own Vercel URLs are always allowed so previews keep working.
const DEFAULT_ORIGINS = ['https://allsortedpro.com', 'https://www.allsortedpro.com'];

const GUARD_TIMEOUT_MS = 3000;

function vercelOrigins() {
  return [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
    .map(h => String(h || '').trim())
    .filter(Boolean)
    .map(h => 'https://' + h.replace(/^https?:\/\//, '').replace(/\/+$/, ''));
}

function allowedOrigins() {
  const raw = String(process.env.ALLOWED_ORIGINS || '').trim();
  const base = raw
    ? raw.split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean)
    : DEFAULT_ORIGINS;
  return new Set(base.concat(vercelOrigins()));
}

function header(req, name) {
  const v = req.headers ? req.headers[name] : undefined;
  return Array.isArray(v) ? v[0] : v;
}

/* Sets CORS headers for an allowed Origin (never "*") and reports whether the
   request may go on. Browsers send Origin on every POST, same-origin included,
   and no server calls this endpoint, so a missing Origin is refused too. */
function checkOrigin(req, res, methods) {
  const origin = String(header(req, 'origin') || '').trim();
  res.setHeader('Vary', 'Origin');
  if (!origin) return { ok: false, origin: '' };
  if (!allowedOrigins().has(origin)) return { ok: false, origin };
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', methods || 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  return { ok: true, origin };
}

/* Declared size, checked before the body is read or parsed. */
function declaredTooLarge(req, maxBytes) {
  const n = Number(header(req, 'content-length'));
  return Number.isFinite(n) && n > maxBytes;
}

/* Actual size of a body the platform already read, for requests that sent no
   Content-Length (chunked). */
function bodyBytes(body) {
  if (body == null) return 0;
  if (typeof body === 'string') return Buffer.byteLength(body);
  if (Buffer.isBuffer(body)) return body.length;
  try { return Buffer.byteLength(JSON.stringify(body)); } catch (e) { return Infinity; }
}

function clientIp(req) {
  const fwd = String(header(req, 'x-forwarded-for') || '').split(',')[0].trim();
  if (fwd) return fwd;
  const real = String(header(req, 'x-real-ip') || '').trim();
  return real || 'unknown';
}

function intEnv(name, fallback) {
  const n = parseInt(String(process.env[name] || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/* Returns { allowed: true } or { allowed: false, status, error, code, retryAfter }. */
async function edgeGuard(req, endpoint, defaults) {
  const base = String(process.env.GUARD_URL || '').trim().replace(/\/+$/, '');
  const key = String(process.env.GUARD_KEY || '').trim();
  const salt = String(process.env.GUARD_SALT || '').trim();
  if (!base || !key || !salt) {
    return { allowed: false, status: 503, code: 'guard_not_configured', error: 'AI is paused: the request guard is not configured' };
  }
  const ipHash = createHash('sha256').update(salt + '|' + clientIp(req)).digest('hex');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), GUARD_TIMEOUT_MS);
  let verdict;
  try {
    const r = await fetch(base + '/rpc/edge_guard', {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_endpoint: endpoint,
        p_ip_hash: ipHash,
        p_per_minute: intEnv('RATE_LIMIT_PER_MINUTE', defaults.perMinute),
        p_daily_cap: intEnv('DAILY_REQUEST_CAP', defaults.dailyCap),
      }),
    });
    if (!r.ok) {
      console.error('edge_guard unavailable', r.status);
      return { allowed: false, status: 503, code: 'guard_unavailable', error: 'AI is briefly unavailable, try again soon' };
    }
    verdict = await r.json();
  } catch (e) {
    console.error('edge_guard failed', e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'unknown');
    return { allowed: false, status: 503, code: 'guard_unavailable', error: 'AI is briefly unavailable, try again soon' };
  } finally {
    clearTimeout(timer);
  }
  if (!verdict || typeof verdict !== 'object' || typeof verdict.allowed !== 'boolean') {
    return { allowed: false, status: 503, code: 'guard_unavailable', error: 'AI is briefly unavailable, try again soon' };
  }
  if (verdict.allowed) return { allowed: true };
  const retryAfter = Math.max(1, Math.round(Number(verdict.retry_after) || 60));
  if (verdict.reason === 'daily_cap') {
    return { allowed: false, status: 429, code: 'daily_cap', error: 'Daily AI limit reached, try again tomorrow', retryAfter };
  }
  if (verdict.reason === 'rate_limited') {
    return { allowed: false, status: 429, code: 'rate_limit', error: 'Too many requests, wait a moment', retryAfter };
  }
  return { allowed: false, status: 503, code: 'guard_refused', error: 'AI is briefly unavailable, try again soon' };
}

module.exports = {
  GUARD_TIMEOUT_MS,
  allowedOrigins,
  checkOrigin,
  declaredTooLarge,
  bodyBytes,
  clientIp,
  edgeGuard,
};
