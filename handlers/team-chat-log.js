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
  const sql = getDb();

  try {
    if (body.list === true) {
      if (body.secret !== scraperSecret) return res.status(401).json({ error: 'Wrong password' });
      if (!sql) return res.status(200).json({ ok: true, configured: false, users: [] });
      const rows = await sql`SELECT * FROM team_chat_messages ORDER BY updated_at DESC`;
      const users = rows.map(row => ({
        userId: row.user_id, email: row.email || '', name: row.name || '',
        updatedAt: row.updated_at, messages: row.messages || [],
      }));
      return res.status(200).json({ ok: true, configured: true, users });
    }

    const userId = body.userId;
    const messages = body.messages;
    if (!userId || typeof userId !== 'string') return res.status(400).json({ error: 'userId required' });
    if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

    if (!sql) return res.status(200).json({ ok: true, skipped: true });

    await sql`
      INSERT INTO team_chat_messages (user_id, email, name, messages, updated_at)
      VALUES (${userId.slice(0,120)}, ${String(body.email||'').slice(0,200)}, ${String(body.name||'').slice(0,120)}, ${JSON.stringify(messages.slice(-100))}, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        email = EXCLUDED.email, name = EXCLUDED.name, messages = EXCLUDED.messages, updated_at = EXCLUDED.updated_at
    `;
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'server error' });
  }
};
