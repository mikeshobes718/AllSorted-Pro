'use strict';
const { getDb } = require('../lib/db');

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
  if (!sql) return res.status(200).json({ ok: false, error: 'db_not_configured' });

  const action = body.action;

  try {
    if (action === 'setRole') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email || email.indexOf('@') === -1) return res.status(400).json({ error: 'email required' });
      const role = body.role === 'admin' ? 'admin' : 'caller';
      const rows = await sql`UPDATE portal_users SET role = ${role}, updated_at = NOW() WHERE email = ${email} RETURNING id`;
      if (!rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
      return res.status(200).json({ ok: true });
    }

    if (action === 'setEmploymentStatus') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email || email.indexOf('@') === -1) return res.status(400).json({ error: 'email required' });
      const status = normalizeEmploymentStatus(body.employmentStatus);
      const rows = await sql`UPDATE portal_users SET employment_status = ${status}, updated_at = NOW() WHERE email = ${email} RETURNING id`;
      if (!rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email || email.indexOf('@') === -1) return res.status(400).json({ error: 'email required' });
      await sql`UPDATE portal_users SET employment_status = 'inactive', updated_at = NOW() WHERE email = ${email}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'server error' });
  }
};
