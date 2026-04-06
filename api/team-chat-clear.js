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

async function readState(kv) {
  let raw;
  try {
    raw = await kv.get('portal:team_chat_clear');
  } catch {
    raw = null;
  }
  if (raw == null) {
    return { pending: {}, approved: {} };
  }
  let s = raw;
  if (typeof raw === 'string') {
    try {
      s = JSON.parse(raw);
    } catch {
      return { pending: {}, approved: {} };
    }
  }
  if (!s || typeof s !== 'object') {
    return { pending: {}, approved: {} };
  }
  return {
    pending: typeof s.pending === 'object' && s.pending ? s.pending : {},
    approved: typeof s.approved === 'object' && s.approved ? s.approved : {},
  };
}

async function writeState(kv, state) {
  await kv.set('portal:team_chat_clear', state);
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
  const action = body.action;
  const kv = getKv();

  if (action === 'status') {
    const userId = body.userId;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId required' });
    }
    if (!kv) {
      return res.status(200).json({
        ok: true,
        configured: false,
        pending: false,
        approved: false,
      });
    }
    const state = await readState(kv);
    return res.status(200).json({
      ok: true,
      configured: true,
      pending: !!state.pending[userId],
      approved: !!state.approved[userId],
    });
  }

  if (action === 'request') {
    const userId = body.userId;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId required' });
    }
    if (!kv) {
      return res.status(200).json({ ok: true, configured: false });
    }
    const state = await readState(kv);
    state.pending[userId] = {
      email: String(body.email || '').slice(0, 200),
      name: String(body.name || '').slice(0, 120),
      requestedAt: new Date().toISOString(),
    };
    delete state.approved[userId];
    await writeState(kv, state);
    return res.status(200).json({ ok: true, configured: true });
  }

  if (action === 'ack') {
    const userId = body.userId;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId required' });
    }
    if (!kv) {
      return res.status(200).json({ ok: true, configured: false });
    }
    const state = await readState(kv);
    delete state.approved[userId];
    await writeState(kv, state);
    return res.status(200).json({ ok: true });
  }

  if (action === 'list') {
    if (body.secret !== scraperSecret) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    if (!kv) {
      return res.status(200).json({ ok: true, configured: false, pending: [], approved: [] });
    }
    const state = await readState(kv);
    const pending = Object.keys(state.pending || {}).map(function (uid) {
      const p = state.pending[uid];
      return {
        userId: uid,
        email: (p && p.email) || '',
        name: (p && p.name) || '',
        requestedAt: (p && p.requestedAt) || '',
      };
    });
    const approved = Object.keys(state.approved || {}).map(function (uid) {
      return { userId: uid, approvedAt: state.approved[uid] };
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
    if (!kv) {
      return res.status(503).json({ error: 'KV not configured' });
    }
    const state = await readState(kv);
    if (!state.pending[userId]) {
      return res.status(404).json({ error: 'No pending request for this user' });
    }
    delete state.pending[userId];
    state.approved[userId] = new Date().toISOString();
    await writeState(kv, state);
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
    if (!kv) {
      return res.status(503).json({ error: 'KV not configured' });
    }
    const state = await readState(kv);
    delete state.pending[userId];
    await writeState(kv, state);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
};
