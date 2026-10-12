'use strict';
const { getDb } = require('../lib/db');
const { mergeTrainingLinksWithDefaults, normalizeLinkSection } = require('./training-library-shared');

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
    if (action === 'trainingGet') {
      let links = [];
      if (sql) {
        const rows = await sql`SELECT value FROM portal_content WHERE key = 'training_links' LIMIT 1`;
        if (rows.length && rows[0].value) {
          const raw = rows[0].value;
          if (Array.isArray(raw)) links = raw;
          else if (typeof raw === 'string') try { links = JSON.parse(raw); } catch { links = []; }
        }
      }
      if (!Array.isArray(links)) links = [];
      links = mergeTrainingLinksWithDefaults(links);
      return res.status(200).json({ ok: true, links, configured: !!sql });
    }

    if (action === 'trainingSet') {
      if (body.secret !== scraperSecret) return res.status(401).json({ error: 'Wrong password' });
      if (!sql) return res.status(503).json({ error: 'Database not configured' });
      const links = Array.isArray(body.links) ? body.links : [];
      const cleaned = links.map(x => {
        if (!x || typeof x !== 'object') return null;
        return { title: String(x.title||'').slice(0,200), url: String(x.url||'').trim().slice(0,2000), note: String(x.note||'').slice(0,500), kind: String(x.kind||'Link').slice(0,40), section: normalizeLinkSection(x, null) };
      }).filter(x => {
        if (!x) return false;
        return String(x.title||'').trim() || String(x.url||'').trim() || String(x.note||'').trim();
      });
      await sql`
        INSERT INTO portal_content (key, value, updated_at) VALUES ('training_links', ${JSON.stringify(cleaned.slice(0,80))}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `;
      return res.status(200).json({ ok: true });
    }

    if (action === 'assistantKbGet') {
      if (body.secret !== scraperSecret) return res.status(401).json({ error: 'Wrong password' });
      if (!sql) return res.status(200).json({ ok: true, content: '', configured: false });
      let content = '';
      const rows = await sql`SELECT value FROM portal_content WHERE key = 'assistant_kb' LIMIT 1`;
      if (rows.length && rows[0].value) {
        const v = rows[0].value;
        if (typeof v === 'object') content = String(v.content || '');
        else if (typeof v === 'string') content = v;
      }
      return res.status(200).json({ ok: true, content: content.slice(0,50000), configured: true });
    }

    if (action === 'assistantKbSet') {
      if (body.secret !== scraperSecret) return res.status(401).json({ error: 'Wrong password' });
      if (!sql) return res.status(503).json({ error: 'Database not configured' });
      await sql`
        INSERT INTO portal_content (key, value, updated_at) VALUES ('assistant_kb', ${JSON.stringify({ content: String(body.content||'').slice(0,50000) })}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'server error' });
  }
};
