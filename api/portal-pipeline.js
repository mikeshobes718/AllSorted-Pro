const { getSupabaseAdmin } = require('../lib/supabase-server');

const CAPS = {
  leads: 12000,
  callLog: 50000,
  appointments: 8000,
  leadRemovalRequests: 4000,
  leadDb: 100000,
};

function clipArray(arr, max) {
  if (!Array.isArray(arr)) return [];
  if (arr.length <= max) return arr;
  return arr.slice(-max);
}

function normalizePayload(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      leads: [],
      callLog: [],
      appointments: [],
      leadRemovalRequests: [],
      leadDb: [],
    };
  }
  return {
    leads: clipArray(raw.leads, CAPS.leads),
    callLog: clipArray(raw.callLog, CAPS.callLog),
    appointments: clipArray(raw.appointments, CAPS.appointments),
    leadRemovalRequests: clipArray(raw.leadRemovalRequests, CAPS.leadRemovalRequests),
    leadDb: clipArray(raw.leadDb, CAPS.leadDb),
  };
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

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(200).json({ ok: true, configured: false, payload: null });
  }

  const action = body.action === 'set' ? 'set' : 'get';

  if (action === 'get') {
    const { data, error } = await supabase
      .from('portal_pipeline')
      .select('payload')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
    const raw = data && data.payload != null ? data.payload : null;
    const payload = normalizePayload(raw);
    return res.status(200).json({ ok: true, configured: true, payload });
  }

  const payload = normalizePayload(body.payload);
  const { error } = await supabase.from('portal_pipeline').upsert(
    {
      id: 1,
      payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
  return res.status(200).json({ ok: true, configured: true });
};
