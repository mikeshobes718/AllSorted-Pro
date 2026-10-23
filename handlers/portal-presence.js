'use strict';
const { getDb } = require('../lib/db');

const ONLINE_MS = 3 * 60 * 1000;

function normalizeEmploymentStatus(v) {
  const allowed = ['active', 'inactive', 'training', 'interviewing', 'on_leave'];
  let s = String(v || 'active').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'onleave' || s === 'leave') s = 'on_leave';
  if (s === 'interview') s = 'interviewing';
  return allowed.includes(s) ? s : 'active';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid body' });

  const scraperSecret = process.env.SCRAPER_SECRET || 'Free2026';
  if (body.secret !== scraperSecret) return res.status(401).json({ error: 'Wrong password' });

  const sql = getDb();

  try {
    if (body.list === true) {
      if (!sql) return res.status(200).json({ ok: true, configured: false, records: [], roster: [] });
      const now = Date.now();
      const [presenceRows, userRows] = await Promise.all([
        sql`SELECT * FROM portal_presence`,
        sql`SELECT id, email, name, role, employee_id, employment_status, created_at, updated_at FROM portal_users`,
      ]);
      const records = (presenceRows || []).map(r => {
        const lastSeen = r.last_seen_at ? new Date(r.last_seen_at).getTime() : 0;
        return {
          userId: r.user_id, lastSeenAt: r.last_seen_at, sessionStartedAt: r.session_started_at,
          lastLoginAt: r.last_login_at, lastIp: r.last_ip, online: lastSeen > 0 && now - lastSeen < ONLINE_MS,
        };
      });
      const roster = (userRows || []).map(r => ({
        userId: r.id, email: r.email, name: r.name, role: r.role, employeeId: r.employee_id,
        employmentStatus: r.employment_status, createdAt: r.created_at, updatedAt: r.updated_at,
      }));
      return res.status(200).json({ ok: true, configured: true, records, roster });
    }

    const userId = body.userId;
    if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'userId required' });

    if (!sql) return res.status(200).json({ ok: true, skipped: true });

    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = fwd || (req.socket && req.socket.remoteAddress) || '';
    const now = new Date().toISOString();

    const prev = await sql`SELECT session_started_at, last_login_at, last_ip FROM portal_presence WHERE user_id = ${userId.slice(0,120)} LIMIT 1`;
    const prevRec = prev[0] || null;
    const sessionStarted = (prevRec && prevRec.session_started_at) || (body.sessionStartedAt && String(body.sessionStartedAt).slice(0,40)) || now;
    const lastLogin = (body.lastLoginAt && String(body.lastLoginAt).slice(0,40)) || (prevRec && prevRec.last_login_at) || null;

    await sql`
      INSERT INTO portal_presence (user_id, last_seen_at, session_started_at, last_login_at, last_ip, updated_at)
      VALUES (${userId.slice(0,120)}, ${now}, ${sessionStarted}, ${lastLogin}, ${ip||(prevRec&&prevRec.last_ip)||''}, ${now})
      ON CONFLICT (user_id) DO UPDATE SET
        last_seen_at = EXCLUDED.last_seen_at, session_started_at = EXCLUDED.session_started_at,
        last_login_at = EXCLUDED.last_login_at, last_ip = EXCLUDED.last_ip, updated_at = EXCLUDED.updated_at
    `;

    if (body.roster && typeof body.roster === 'object') {
      const email = String(body.roster.email || '').trim().toLowerCase();
      if (email && email.indexOf('@') > 0) {
        const existing = await sql`SELECT employment_status FROM portal_users WHERE email = ${email} LIMIT 1`;
        if (existing.length) {
          const fromBody = body.roster.employmentStatus;
          let mergedStatus;
          if (existing[0].employment_status && String(existing[0].employment_status).trim()) {
            mergedStatus = normalizeEmploymentStatus(existing[0].employment_status);
          } else if (fromBody && String(fromBody).trim()) {
            mergedStatus = normalizeEmploymentStatus(fromBody);
          } else {
            mergedStatus = 'active';
          }
          await sql`UPDATE portal_users SET employment_status = ${mergedStatus}, updated_at = ${now} WHERE email = ${email}`;
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'server error' });
  }
};
