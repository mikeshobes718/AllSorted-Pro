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
  const supabase = getSupabaseAdmin();

  if (body.list === true) {
    if (body.secret !== scraperSecret) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    if (!supabase) {
      return res.status(200).json({ ok: true, configured: false, users: [] });
    }
    const { data, error } = await supabase
      .from('team_chat_messages')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const users = (data || []).map(function (row) {
      return {
        userId: row.user_id,
        email: row.email || '',
        name: row.name || '',
        updatedAt: row.updated_at,
        messages: row.messages || [],
      };
    });

    return res.status(200).json({ ok: true, configured: true, users });
  }

  const userId = body.userId;
  const messages = body.messages;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId required' });
  }
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  if (!supabase) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('team_chat_messages')
    .upsert(
      {
        user_id: userId.slice(0, 120),
        email: String(body.email || '').slice(0, 200),
        name: String(body.name || '').slice(0, 120),
        messages: messages.slice(-100),
        updated_at: now,
      },
      { onConflict: 'user_id' }
    );

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ ok: true });
};
