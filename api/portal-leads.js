const { getSupabaseAdmin } = require('../lib/supabase-server');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid body' });

  const scraperSecret = process.env.SCRAPER_SECRET || 'Free2026';
  if (body.secret !== scraperSecret) return res.status(401).json({ error: 'Wrong password' });

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(200).json({ ok: true, configured: false, leads: [] });

  const action = body.action || 'list';

  if (action === 'list') {
    let all = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('portal_queue_leads')
        .select('data')
        .order('updated_at', { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) return res.status(500).json({ ok: false, error: error.message });
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    const leads = all.map((r) => r.data).filter(Boolean);
    return res.status(200).json({ ok: true, configured: true, leads });
  }

  if (action === 'upsert') {
    const lead = body.lead;
    if (!lead || !lead.id) return res.status(400).json({ ok: false, error: 'lead.id required' });
    const row = {
      id: String(lead.id),
      data: lead,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('portal_queue_leads').upsert(row, { onConflict: 'id' });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, configured: true });
  }

  if (action === 'delete') {
    const id = body.leadId != null ? String(body.leadId) : '';
    if (!id) return res.status(400).json({ ok: false, error: 'leadId required' });
    const { error } = await supabase.from('portal_queue_leads').delete().eq('id', id);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, configured: true });
  }

  if (action === 'sync') {
    const leads = body.leads;
    if (!Array.isArray(leads)) return res.status(400).json({ ok: false, error: 'leads array required' });
    if (leads.length === 0) return res.status(200).json({ ok: true, configured: true, count: 0 });

    const now = new Date().toISOString();
    const rows = leads
      .filter((l) => l && l.id)
      .map((l) => ({ id: String(l.id), data: l, updated_at: now }));

    if (rows.length) {
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error: upErr } = await supabase.from('portal_queue_leads').upsert(batch, { onConflict: 'id' });
        if (upErr) return res.status(500).json({ ok: false, error: upErr.message });
      }
    }
    return res.status(200).json({ ok: true, configured: true, count: rows.length });
  }

  return res.status(400).json({ ok: false, error: 'Unknown action' });
};
