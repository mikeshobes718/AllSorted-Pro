'use strict';
const { getDb } = require('../lib/db');

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
  const action = body.action;
  const sql = getDb();

  try {
    if (action === 'status') {
      const userId = body.userId;
      if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'userId required' });
      if (!sql) return res.status(200).json({ ok: true, configured: false, pending: false, approved: false });
      const rows = await sql`SELECT state FROM team_chat_clear_state WHERE user_id = ${userId} LIMIT 1`;
      const row = rows[0] || null;
      return res.status(200).json({ ok: true, configured: true, pending: !!(row && row.state === 'pending'), approved: !!(row && row.state === 'approved') });
    }

    if (action === 'request') {
      const userId = body.userId;
      if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'userId required' });
      if (!sql) return res.status(200).json({ ok: true, configured: false });
      const now = new Date().toISOString();
      await sql`
        INSERT INTO team_chat_clear_state (user_id, state, requester_email, requester_name, requested_at, approved_at, updated_at)
        VALUES (${userId}, 'pending', ${String(body.email||'').slice(0,200)}, ${String(body.name||'').slice(0,120)}, ${now}, null, ${now})
        ON CONFLICT (user_id) DO UPDATE SET
          state = 'pending', requester_email = EXCLUDED.requester_email, requester_name = EXCLUDED.requester_name,
          requested_at = EXCLUDED.requested_at, approved_at = null, updated_at = EXCLUDED.updated_at
      `;
      return res.status(200).json({ ok: true, configured: true });
    }

    if (action === 'ack') {
      const userId = body.userId;
      if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'userId required' });
      if (!sql) return res.status(200).json({ ok: true, configured: false });
      await sql`DELETE FROM team_chat_clear_state WHERE user_id = ${userId}`;
      return res.status(200).json({ ok: true });
    }

    if (action === 'list') {
      if (body.secret !== scraperSecret) return res.status(401).json({ error: 'Wrong password' });
      if (!sql) return res.status(200).json({ ok: true, configured: false, pending: [], approved: [] });
      const rows = await sql`SELECT * FROM team_chat_clear_state WHERE state IN ('pending', 'approved')`;
      const pending = [], approved = [];
      rows.forEach(row => {
        if (row.state === 'pending') pending.push({ userId: row.user_id, email: row.requester_email||'', name: row.requester_name||'', requestedAt: row.requested_at||'' });
        else if (row.state === 'approved') approved.push({ userId: row.user_id, approvedAt: row.approved_at||'' });
      });
      return res.status(200).json({ ok: true, configured: true, pending, approved });
    }

    if (action === 'approve') {
      if (body.secret !== scraperSecret) return res.status(401).json({ error: 'Wrong password' });
      const userId = body.userId;
      if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'userId required' });
      if (!sql) return res.status(503).json({ error: 'DB not configured' });
      const rows = await sql`SELECT state FROM team_chat_clear_state WHERE user_id = ${userId} AND state = 'pending' LIMIT 1`;
      if (!rows.length) return res.status(404).json({ error: 'No pending request for this user' });
      const now = new Date().toISOString();
      await sql`UPDATE team_chat_clear_state SET state = 'approved', approved_at = ${now}, updated_at = ${now} WHERE user_id = ${userId}`;
      return res.status(200).json({ ok: true });
    }

    if (action === 'deny') {
      if (body.secret !== scraperSecret) return res.status(401).json({ error: 'Wrong password' });
      const userId = body.userId;
      if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'userId required' });
      if (!sql) return res.status(503).json({ error: 'DB not configured' });
      await sql`DELETE FROM team_chat_clear_state WHERE user_id = ${userId} AND state = 'pending'`;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'server error' });
  }
};
