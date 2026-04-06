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

const { mergeTrainingLinksWithDefaults, normalizeLinkSection } = require('./training-library-shared');

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
  const action = body.action;
  const kv = getKv();

  if (action === 'trainingGet') {
    let links = [];
    if (kv) {
      let raw;
      try {
        raw = await kv.get('portal:training_links');
      } catch {
        raw = null;
      }
      if (raw != null) {
        if (typeof raw === 'string') {
          try {
            links = JSON.parse(raw);
          } catch {
            links = [];
          }
        } else if (Array.isArray(raw)) {
          links = raw;
        }
      }
    }
    if (!Array.isArray(links)) links = [];
    links = mergeTrainingLinksWithDefaults(links);
    return res.status(200).json({
      ok: true,
      links,
      configured: Boolean(kv),
    });
  }

  if (action === 'trainingSet') {
    if (body.secret !== scraperSecret) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    if (!kv) {
      return res.status(503).json({ error: 'KV not configured' });
    }
    const links = Array.isArray(body.links) ? body.links : [];
    const cleaned = links
      .map(function (x) {
        if (!x || typeof x !== 'object') return null;
        return {
          title: String(x.title || '').slice(0, 200),
          url: String(x.url || '').trim().slice(0, 2000),
          note: String(x.note || '').slice(0, 500),
          kind: String(x.kind || 'Link').slice(0, 40),
          section: normalizeLinkSection(x, null),
        };
      })
      .filter(function (x) {
        if (!x) return false;
        var t = String(x.title || '').trim();
        var u = String(x.url || '').trim();
        var n = String(x.note || '').trim();
        return t || u || n;
      });
    try {
      await kv.set('portal:training_links', JSON.stringify(cleaned.slice(0, 80)));
    } catch (e) {
      return res.status(500).json({ error: e && e.message ? e.message : 'Save failed' });
    }
    return res.status(200).json({ ok: true });
  }

  if (action === 'assistantKbGet') {
    if (body.secret !== scraperSecret) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    if (!kv) {
      return res.status(200).json({ ok: true, content: '', configured: false });
    }
    let raw;
    try {
      raw = await kv.get('portal:assistant_kb');
    } catch {
      raw = null;
    }
    const content =
      raw == null ? '' : typeof raw === 'string' ? raw : String(raw);
    return res.status(200).json({
      ok: true,
      content: content.slice(0, 50000),
      configured: true,
    });
  }

  if (action === 'assistantKbSet') {
    if (body.secret !== scraperSecret) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    if (!kv) {
      return res.status(503).json({ error: 'KV not configured' });
    }
    try {
      await kv.set('portal:assistant_kb', String(body.content || '').slice(0, 50000));
    } catch (e) {
      return res.status(500).json({ error: e && e.message ? e.message : 'Save failed' });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
};
