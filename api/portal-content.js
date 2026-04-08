const { getSupabaseAdmin } = require('../lib/supabase-server');
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
  const supabase = getSupabaseAdmin();

  if (action === 'trainingGet') {
    let links = [];
    if (supabase) {
      try {
        const { data } = await supabase
          .from('portal_content')
          .select('value')
          .eq('key', 'training_links')
          .maybeSingle();
        if (data && data.value) {
          const raw = data.value;
          if (Array.isArray(raw)) {
            links = raw;
          } else if (typeof raw === 'string') {
            try { links = JSON.parse(raw); } catch { links = []; }
          }
        }
      } catch {
        links = [];
      }
    }
    if (!Array.isArray(links)) links = [];
    links = mergeTrainingLinksWithDefaults(links);
    return res.status(200).json({
      ok: true,
      links,
      configured: Boolean(supabase),
    });
  }

  if (action === 'trainingSet') {
    if (body.secret !== scraperSecret) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' });
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
      const { error } = await supabase
        .from('portal_content')
        .upsert(
          { key: 'training_links', value: cleaned.slice(0, 80), updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );
      if (error) throw error;
    } catch (e) {
      return res.status(500).json({ error: e && e.message ? e.message : 'Save failed' });
    }
    return res.status(200).json({ ok: true });
  }

  if (action === 'assistantKbGet') {
    if (body.secret !== scraperSecret) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    if (!supabase) {
      return res.status(200).json({ ok: true, content: '', configured: false });
    }
    let content = '';
    try {
      const { data } = await supabase
        .from('portal_content')
        .select('value')
        .eq('key', 'assistant_kb')
        .maybeSingle();
      if (data && data.value && typeof data.value === 'object') {
        content = String(data.value.content || '');
      } else if (data && typeof data.value === 'string') {
        content = data.value;
      }
    } catch {
      content = '';
    }
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
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    try {
      const { error } = await supabase
        .from('portal_content')
        .upsert(
          { key: 'assistant_kb', value: { content: String(body.content || '').slice(0, 50000) }, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );
      if (error) throw error;
    } catch (e) {
      return res.status(500).json({ error: e && e.message ? e.message : 'Save failed' });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
};
