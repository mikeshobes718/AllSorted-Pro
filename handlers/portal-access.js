'use strict';
const { getDb } = require('../lib/db');
const { normalizeEmail } = require('../lib/portal-access-shared');

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

  const email = normalizeEmail(body.email);
  if (!email || email.indexOf('@') === -1) return res.status(400).json({ error: 'email required' });

  const sql = getDb();
  if (!sql) return res.status(200).json({ ok: true, configured: false, status: null });

  try {
    const rows = await sql`SELECT status FROM portal_access WHERE email = ${email} LIMIT 1`;
    if (!rows.length) return res.status(200).json({ ok: true, configured: true, status: null });
    return res.status(200).json({ ok: true, configured: true, status: rows[0].status });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'server error' });
  }
};
