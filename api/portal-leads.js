'use strict';
const { getDb } = require('../lib/db');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parseBody(req) {
  let b = req.body;
  if (typeof b === 'string') try { b = JSON.parse(b); } catch { return null; }
  if (!b || typeof b !== 'object') return null;
  return b;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = parseBody(req);
  if (!body) return res.status(400).json({ error: 'Invalid body' });

  const scraperSecret = process.env.SCRAPER_SECRET || 'Free2026';
  if (body.secret !== scraperSecret) return res.status(401).json({ error: 'Wrong password' });

  const sql = getDb();
  if (!sql) return res.status(200).json({ ok: true, configured: false, leads: [] });

  const action = body.action || 'list';

  try {
    // Delta sync: returns only leads changed after `since` timestamp
    if (action === 'list') {
      const since = body.since ? String(body.since) : null;
      const limit = Math.min(parseInt(body.limit, 10) || 5000, 100000);
      const cntRows = await sql`SELECT COUNT(*)::int AS cnt FROM portal_queue_leads`;
      const totalCount = (cntRows[0] || {}).cnt || 0;
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
      return res.status(200).json({ ok: true, configured: true, leads, latestTs, count: leads.length, totalCount });
    }

    if (action === 'count') {
      const rows = await sql`SELECT COUNT(*)::int AS cnt FROM portal_queue_leads`;
      return res.status(200).json({ ok: true, count: (rows[0] || {}).cnt || 0 });
    }

    if (action === 'upsert') {
      const lead = body.lead;
      if (!lead || !lead.id) return res.status(400).json({ ok: false, error: 'lead.id required' });
      const now = new Date().toISOString();
      await sql`
        INSERT INTO portal_queue_leads (id, data, status, company, phone, updated_at)
        VALUES (${String(lead.id)}, ${JSON.stringify(lead)}, ${lead.status||'new'},
          ${lead.company||null}, ${lead.phone||null}, ${now})
        ON CONFLICT (id) DO UPDATE SET
          data = EXCLUDED.data, status = EXCLUDED.status,
          company = EXCLUDED.company, phone = EXCLUDED.phone,
          updated_at = EXCLUDED.updated_at
      `;
      return res.status(200).json({ ok: true, configured: true });
    }

    if (action === 'delete') {
      const id = body.leadId != null ? String(body.leadId) : '';
      if (!id) return res.status(400).json({ ok: false, error: 'leadId required' });
      await sql`DELETE FROM portal_queue_leads WHERE id = ${id}`;
      return res.status(200).json({ ok: true, configured: true });
    }

    if (action === 'sync') {
      const leads = body.leads;
      if (!Array.isArray(leads)) return res.status(400).json({ ok: false, error: 'leads array required' });
      if (!leads.length) return res.status(200).json({ ok: true, configured: true, count: 0 });
      const now = new Date().toISOString();
      const valid = leads.filter(l => l && l.id);
      for (let i = 0; i < valid.length; i += 500) {
        const chunk = valid.slice(i, i + 500);
        for (const l of chunk) {
          await sql`
            INSERT INTO portal_queue_leads (id, data, status, company, phone, updated_at)
            VALUES (${String(l.id)}, ${JSON.stringify(l)}, ${l.status||'new'},
              ${l.company||null}, ${l.phone||null}, ${now})
            ON CONFLICT (id) DO UPDATE SET
              data = EXCLUDED.data, status = EXCLUDED.status,
              company = EXCLUDED.company, phone = EXCLUDED.phone,
              updated_at = EXCLUDED.updated_at
          `;
        }
      }
      return res.status(200).json({ ok: true, configured: true, count: valid.length });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'server error' });
  }
};
