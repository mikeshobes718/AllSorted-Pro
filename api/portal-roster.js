const crypto = require('crypto');

function getKv() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return null;
  }
  try {
    return require('@vercel/kv').kv;
  } catch {
    return null;
  }
}

function rosterKeyFromEmail(email) {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (!e || e.indexOf('@') === -1) return null;
  return 'portal:roster:byemail:v1:' + crypto.createHash('sha256').update(e).digest('hex');
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

  const kv = getKv();
  if (!kv) {
    return res.status(200).json({ ok: false, error: 'kv_not_configured' });
  }

  const action = body.action;

  if (action === 'setRole') {
    const email = String(body.email || '')
      .trim()
      .toLowerCase();
    if (!email || email.indexOf('@') === -1) {
      return res.status(400).json({ error: 'email required' });
    }
    const role = body.role === 'admin' ? 'admin' : 'caller';
    const key = rosterKeyFromEmail(email);
    if (!key) {
      return res.status(400).json({ error: 'invalid email' });
    }
    let rec = null;
    try {
      rec = await kv.get(key);
    } catch {
      return res.status(500).json({ error: 'read failed' });
    }
    if (typeof rec === 'string') {
      try {
        rec = JSON.parse(rec);
      } catch {
        rec = null;
      }
    }
    if (!rec || !rec.email) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    rec.role = role;
    rec.updatedAt = new Date().toISOString();
    try {
      await kv.set(key, rec);
    } catch (e) {
      return res.status(500).json({
        error: e && e.message ? e.message : 'Save failed',
      });
    }
    return res.status(200).json({ ok: true });
  }

  if (action === 'delete') {
    const email = String(body.email || '')
      .trim()
      .toLowerCase();
    if (!email || email.indexOf('@') === -1) {
      return res.status(400).json({ error: 'email required' });
    }
    const key = rosterKeyFromEmail(email);
    if (!key) {
      return res.status(400).json({ error: 'invalid email' });
    }
    try {
      await kv.del(key);
    } catch (e) {
      return res.status(500).json({
        error: e && e.message ? e.message : 'Delete failed',
      });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Invalid action' });
};
