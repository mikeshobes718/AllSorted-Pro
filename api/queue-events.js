'use strict';
// Fast delta-fetch endpoint for lead queue real-time updates.
// Client polls this every 4s with `since` timestamp — only changed rows come back.
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

  const sql = getDb();
  if (!sql) return res.status(200).json({ ok: true, configured: false, leads: [], deletedIds: [] });

  const since = body.since ? String(body.since) : null;
  const limit = Math.min(parseInt(body.limit, 10) || 2000, 10000);

  try {
    const countRows = await sql`SELECT COUNT(*)::int AS cnt FROM portal_queue_leads`;
    const totalCount = (countRows[0] || {}).cnt || 0;

    let rows;
    if (since) {
      rows = await sql`
        SELECT data, updated_at FROM portal_queue_leads
        WHERE updated_at > ${since}::timestamptz
        ORDER BY updated_at ASC
        LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT data, updated_at FROM portal_queue_leads
        ORDER BY updated_at ASC
        LIMIT ${limit}
      `;
    }

    const leads = rows.map(r => r.data).filter(Boolean);
    let latestTs = null;
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i].updated_at;
      if (t && (!latestTs || new Date(t) > new Date(latestTs))) latestTs = t;
    }

    return res.status(200).json({
      ok: true, configured: true,
      leads, latestTs, count: leads.length, totalCount,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'server error' });
  }
};
