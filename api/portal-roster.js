const { getSupabaseAdmin } = require('../lib/supabase-server');

function normalizeEmploymentStatus(v) {
  const allowed = ['active', 'inactive', 'training', 'interviewing', 'on_leave'];
  let s = String(v || 'active')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (s === 'onleave' || s === 'leave') s = 'on_leave';
  if (s === 'interview') s = 'interviewing';
  return allowed.includes(s) ? s : 'active';
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
    return res.status(200).json({ ok: false, error: 'supabase_not_configured' });
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

    const { data, error } = await supabase
      .from('portal_users')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('email', email)
      .select('id');

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    if (!data || data.length === 0) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    return res.status(200).json({ ok: true });
  }

  if (action === 'setEmploymentStatus') {
    const email = String(body.email || '')
      .trim()
      .toLowerCase();
    if (!email || email.indexOf('@') === -1) {
      return res.status(400).json({ error: 'email required' });
    }
    const status = normalizeEmploymentStatus(body.employmentStatus);

    const { data, error } = await supabase
      .from('portal_users')
      .update({ employment_status: status, updated_at: new Date().toISOString() })
      .eq('email', email)
      .select('id');

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    if (!data || data.length === 0) {
      return res.status(404).json({ ok: false, error: 'not_found' });
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

    await supabase
      .from('portal_users')
      .update({ employment_status: 'inactive', updated_at: new Date().toISOString() })
      .eq('email', email);

    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Invalid action' });
};
