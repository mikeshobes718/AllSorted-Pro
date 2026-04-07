const crypto = require('crypto');

function getKv() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return null;
  }
  try {
    return require('@vercel/kv').kv;
  } catch {
    return null;
  }
}

function rosterKeyFromEmail(email) {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (!e || e.indexOf('@') === -1) return null;
  return 'portal:roster:byemail:v1:' + crypto.createHash('sha256').update(e).digest('hex');
}

async function collectPresenceKeys(kv) {
  const keys = [];
  let cursor = '0';
  do {
    let res;
    try {
      res = await kv.scan(cursor, { match: 'portal:presence:v1:*', count: 200 });
    } catch {
      break;
    }
    if (!res || !Array.isArray(res) || res.length < 2) break;
    cursor = String(res[0]);
    const batch = res[1];
    if (Array.isArray(batch) && batch.length) {
      keys.push.apply(keys, batch);
    }
  } while (cursor !== '0');
  return keys;
}

async function collectRosterKeys(kv) {
  const keys = [];
  let cursor = '0';
  do {
    let res;
    try {
      res = await kv.scan(cursor, { match: 'portal:roster:byemail:v1:*', count: 200 });
    } catch {
      break;
    }
    if (!res || !Array.isArray(res) || res.length < 2) break;
    cursor = String(res[0]);
    const batch = res[1];
    if (Array.isArray(batch) && batch.length) {
      keys.push.apply(keys, batch);
    }
  } while (cursor !== '0');
  return keys;
}

const ONLINE_MS = 3 * 60 * 1000;

function normalizeEmploymentStatus(v) {
  const allowed = ['active', 'inactive', 'training', 'interviewing', 'on_leave'];
  let s = String(v || 'active')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (s === 'onleave' || s === 'leave') s = 'on_leave';
  if (s === 'interview') s = 'interviewing';
  return allowed.includes(s) ? s : 'active';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const scraperSecret = process.env.SCRAPER_SECRET || 'Free2026';
  if (body.secret !== scraperSecret) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  const kv = getKv();

  if (body.list === true) {
    if (!kv) {
      return res.status(200).json({ ok: true, configured: false, records: [], roster: [] });
    }
    let keys = [];
    try {
      keys = await collectPresenceKeys(kv);
    } catch {
      keys = [];
    }
    const records = [];
    const now = Date.now();
    for (const key of keys) {
      let raw;
      try {
        raw = await kv.get(key);
      } catch {
        continue;
      }
      if (raw == null) continue;
      let parsed = raw;
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }
      }
      if (!parsed || typeof parsed !== 'object') continue;
      const uid = parsed.userId || String(key).replace(/^portal:presence:v1:/, '');
      const lastSeen = parsed.lastSeenAt ? new Date(parsed.lastSeenAt).getTime() : 0;
      const online = lastSeen > 0 && now - lastSeen < ONLINE_MS;
      records.push(
        Object.assign({}, parsed, {
          userId: uid,
          online: online,
        })
      );
    }
    let roster = [];
    try {
      const rkeys = await collectRosterKeys(kv);
      for (const rk of rkeys) {
        let raw;
        try {
          raw = await kv.get(rk);
        } catch {
          continue;
        }
        if (raw == null) continue;
        let parsed = raw;
        if (typeof raw === 'string') {
          try {
            parsed = JSON.parse(raw);
          } catch {
            continue;
          }
        }
        if (parsed && typeof parsed === 'object' && parsed.email) {
          roster.push(parsed);
        }
      }
    } catch {
      roster = [];
    }
    return res.status(200).json({ ok: true, configured: true, records: records, roster: roster });
  }

  const userId = body.userId;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId required' });
  }

  const fwd = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  const ip = fwd || (req.socket && req.socket.remoteAddress) || '';

  if (!kv) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const key = 'portal:presence:v1:' + userId.slice(0, 120);
  let prev = null;
  try {
    prev = await kv.get(key);
    if (typeof prev === 'string') {
      try {
        prev = JSON.parse(prev);
      } catch {
        prev = null;
      }
    }
  } catch {
    prev = null;
  }

  const now = new Date().toISOString();
  var sessionStarted =
    (prev && prev.sessionStartedAt) ||
    (body.sessionStartedAt && String(body.sessionStartedAt).slice(0, 40)) ||
    now;
  var lastLogin =
    (body.lastLoginAt && String(body.lastLoginAt).slice(0, 40)) ||
    (prev && prev.lastLoginAt) ||
    null;

  const next = {
    userId: userId.slice(0, 120),
    lastSeenAt: now,
    sessionStartedAt: sessionStarted,
    lastLoginAt: lastLogin,
    lastIp: ip || (prev && prev.lastIp) || '',
  };

  try {
    await kv.set(key, next);
  } catch (e) {
    return res.status(500).json({
      error: e && e.message ? e.message : 'Save failed',
    });
  }

  if (body.roster && typeof body.roster === 'object') {
    const email = String(body.roster.email || '')
      .trim()
      .toLowerCase();
    if (email && email.indexOf('@') > 0) {
      const rk = rosterKeyFromEmail(email);
      if (rk) {
        let prevRec = null;
        try {
          prevRec = await kv.get(rk);
          if (typeof prevRec === 'string') {
            try {
              prevRec = JSON.parse(prevRec);
            } catch {
              prevRec = null;
            }
          }
        } catch {
          prevRec = null;
        }
        const fromBody = body.roster.employmentStatus;
        const mergedStatus =
          fromBody != null && String(fromBody).trim() !== ''
            ? normalizeEmploymentStatus(fromBody)
            : prevRec && prevRec.employmentStatus
              ? normalizeEmploymentStatus(prevRec.employmentStatus)
              : 'active';
        const rosterRec = {
          userId: userId.slice(0, 120),
          email: email.slice(0, 200),
          name: String(body.roster.name || '').trim().slice(0, 200),
          role: body.roster.role === 'admin' ? 'admin' : 'caller',
          employeeId:
            body.roster.employeeId != null ? String(body.roster.employeeId).slice(0, 12) : '',
          createdAt: String(body.roster.createdAt || '').slice(0, 40) || null,
          employmentStatus: mergedStatus,
          updatedAt: now,
        };
        try {
          await kv.set(rk, rosterRec);
        } catch (e) {
          /* roster best-effort; presence already saved */
        }
      }
    }
  }

  return res.status(200).json({ ok: true });
};
