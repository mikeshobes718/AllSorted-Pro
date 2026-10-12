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
  if (body.secret !== scraperSecret) return res.status(401).json({ error: 'Wrong password' });
  if (body.action !== 'purge') return res.status(400).json({ error: 'Invalid action' });

  const userId = String(body.userId || '').trim().slice(0, 120);
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const sql = getDb();
  if (!sql) return res.status(200).json({ ok: false, error: 'db_not_configured' });

  try {
    await Promise.all([
      sql`DELETE FROM portal_presence WHERE user_id = ${userId}`.catch(() => {}),
      sql`DELETE FROM team_chat_clear_state WHERE user_id = ${userId}`.catch(() => {}),
      sql`DELETE FROM team_chat_messages WHERE user_id = ${userId}`.catch(() => {}),
      sql`DELETE FROM timeclock_active_shifts WHERE user_id = ${userId}`.catch(() => {}),
    ]);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'server error' });
  }
};
