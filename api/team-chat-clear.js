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
  const action = body.action;
  const supabase = getSupabaseAdmin();

  if (action === 'status') {
    const userId = body.userId;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId required' });
    }
    if (!supabase) {
      return res.status(200).json({
        ok: true,
        configured: false,
        pending: false,
        approved: false,
      });
    }
    const { data } = await supabase
      .from('team_chat_clear_state')
      .select('state')
      .eq('user_id', userId)
      .maybeSingle();

    return res.status(200).json({
      ok: true,
      configured: true,
      pending: !!(data && data.state === 'pending'),
      approved: !!(data && data.state === 'approved'),
    });
  }

  if (action === 'request') {
    const userId = body.userId;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId required' });
    }
    if (!supabase) {
      return res.status(200).json({ ok: true, configured: false });
    }
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('team_chat_clear_state')
      .upsert(
        {
          user_id: userId,
          state: 'pending',
          requester_email: String(body.email || '').slice(0, 200),
          requester_name: String(body.name || '').slice(0, 120),
          requested_at: now,
          approved_at: null,
          updated_at: now,
        },
        { onConflict: 'user_id' }
      );

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ ok: true, configured: true });
  }

  if (action === 'ack') {
    const userId = body.userId;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId required' });
    }
    if (!supabase) {
      return res.status(200).json({ ok: true, configured: false });
    }
    await supabase
      .from('team_chat_clear_state')
      .delete()
      .eq('user_id', userId);

    return res.status(200).json({ ok: true });
  }

  if (action === 'list') {
    if (body.secret !== scraperSecret) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    if (!supabase) {
      return res.status(200).json({ ok: true, configured: false, pending: [], approved: [] });
    }
    const { data, error } = await supabase
      .from('team_chat_clear_state')
      .select('*')
      .or('state.eq.pending,state.eq.approved');

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const pending = [];
    const approved = [];
    (data || []).forEach(function (row) {
      if (row.state === 'pending') {
        pending.push({
          userId: row.user_id,
          email: row.requester_email || '',
          name: row.requester_name || '',
          requestedAt: row.requested_at || '',
        });
      } else if (row.state === 'approved') {
        approved.push({
          userId: row.user_id,
          approvedAt: row.approved_at || '',
        });
      }
    });

    return res.status(200).json({ ok: true, configured: true, pending, approved });
  }

  if (action === 'approve') {
    if (body.secret !== scraperSecret) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    const userId = body.userId;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId required' });
    }
    if (!supabase) {
      return res.status(503).json({ error: 'Supabase not configured' });
    }

    const { data: existing } = await supabase
      .from('team_chat_clear_state')
      .select('state')
      .eq('user_id', userId)
      .eq('state', 'pending')
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ error: 'No pending request for this user' });
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from('team_chat_clear_state')
      .update({ state: 'approved', approved_at: now, updated_at: now })
      .eq('user_id', userId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ ok: true });
  }

  if (action === 'deny') {
    if (body.secret !== scraperSecret) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    const userId = body.userId;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId required' });
    }
    if (!supabase) {
      return res.status(503).json({ error: 'Supabase not configured' });
    }

    await supabase
      .from('team_chat_clear_state')
      .delete()
      .eq('user_id', userId)
      .eq('state', 'pending');

    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
};
