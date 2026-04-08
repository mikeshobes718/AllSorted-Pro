const { getSupabaseAdmin } = require('../lib/supabase-server');

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

  if (body.action !== 'purge') {
    return res.status(400).json({ error: 'Invalid action' });
  }

  const userId = String(body.userId || '')
    .trim()
    .slice(0, 120);
  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(200).json({ ok: false, error: 'supabase_not_configured' });
  }

  try { await supabase.from('portal_presence').delete().eq('user_id', userId); } catch {}
  try { await supabase.from('team_chat_clear_state').delete().eq('user_id', userId); } catch {}
  try { await supabase.from('team_chat_messages').delete().eq('user_id', userId); } catch {}
  try { await supabase.from('timeclock_active_shifts').delete().eq('user_id', userId); } catch {}

  return res.status(200).json({ ok: true });
};
