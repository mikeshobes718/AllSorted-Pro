const { getSupabaseAdmin } = require('../lib/supabase-server');

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

  const supabase = getSupabaseAdmin();

  if (body.list === true) {
    if (!supabase) {
      return res.status(200).json({ ok: true, configured: false, records: [], roster: [] });
    }

    const now = Date.now();

    const { data: presenceRows, error: presErr } = await supabase
      .from('portal_presence')
      .select('*');
    if (presErr) {
      return res.status(500).json({ error: presErr.message });
    }

    const records = (presenceRows || []).map((r) => {
      const lastSeen = r.last_seen_at ? new Date(r.last_seen_at).getTime() : 0;
      const online = lastSeen > 0 && now - lastSeen < ONLINE_MS;
      return {
        userId: r.user_id,
        lastSeenAt: r.last_seen_at,
        sessionStartedAt: r.session_started_at,
        lastLoginAt: r.last_login_at,
        lastIp: r.last_ip,
        online,
      };
    });

    const { data: userRows, error: usrErr } = await supabase
      .from('portal_users')
      .select('id, email, name, role, employee_id, employment_status, created_at, updated_at');
    if (usrErr) {
      return res.status(500).json({ error: usrErr.message });
    }

    const roster = (userRows || []).map((r) => ({
      userId: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      employeeId: r.employee_id,
      employmentStatus: r.employment_status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return res.status(200).json({ ok: true, configured: true, records, roster });
  }

  const userId = body.userId;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId required' });
  }

  if (!supabase) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const fwd = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  const ip = fwd || (req.socket && req.socket.remoteAddress) || '';
  const now = new Date().toISOString();

  const { data: prev } = await supabase
    .from('portal_presence')
    .select('session_started_at, last_login_at, last_ip')
    .eq('user_id', userId.slice(0, 120))
    .maybeSingle();

  const sessionStarted =
    (prev && prev.session_started_at) ||
    (body.sessionStartedAt && String(body.sessionStartedAt).slice(0, 40)) ||
    now;
  const lastLogin =
    (body.lastLoginAt && String(body.lastLoginAt).slice(0, 40)) ||
    (prev && prev.last_login_at) ||
    null;

  const { error: upsertErr } = await supabase.from('portal_presence').upsert(
    {
      user_id: userId.slice(0, 120),
      last_seen_at: now,
      session_started_at: sessionStarted,
      last_login_at: lastLogin,
      last_ip: ip || (prev && prev.last_ip) || '',
      updated_at: now,
    },
    { onConflict: 'user_id' }
  );

  if (upsertErr) {
    return res.status(500).json({ error: upsertErr.message });
  }

  if (body.roster && typeof body.roster === 'object') {
    const email = String(body.roster.email || '')
      .trim()
      .toLowerCase();
    if (email && email.indexOf('@') > 0) {
      const { data: existing } = await supabase
        .from('portal_users')
        .select('employment_status')
        .eq('email', email)
        .maybeSingle();

      if (existing) {
        const fromBody = body.roster.employmentStatus;
        let mergedStatus;
        if (
          existing.employment_status != null &&
          String(existing.employment_status).trim() !== ''
        ) {
          mergedStatus = normalizeEmploymentStatus(existing.employment_status);
        } else if (fromBody != null && String(fromBody).trim() !== '') {
          mergedStatus = normalizeEmploymentStatus(fromBody);
        } else {
          mergedStatus = 'active';
        }

        await supabase
          .from('portal_users')
          .update({ employment_status: mergedStatus, updated_at: now })
          .eq('email', email);
      }
    }
  }

  return res.status(200).json({ ok: true });
};
