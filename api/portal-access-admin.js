const { getSupabaseAdmin } = require('../lib/supabase-server');
const { normalizeEmail } = require('../lib/portal-access-shared');

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
    return res.status(200).json({ ok: true, configured: false, pending: [] });
  }

  const action = body.action === 'approve' || body.action === 'deny' ? body.action : 'list';

  if (action === 'list') {
    const { data, error } = await supabase
      .from('portal_access')
      .select('email, status, display_name, created_at, updated_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
    return res.status(200).json({ ok: true, configured: true, pending: data || [] });
  }

  const email = normalizeEmail(body.email);
  if (!email || email.indexOf('@') === -1) {
    return res.status(400).json({ error: 'email required' });
  }

  const nextStatus = action === 'approve' ? 'approved' : 'denied';
  const { error } = await supabase
    .from('portal_access')
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq('email', email);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, configured: true });
};
