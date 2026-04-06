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

async function collectChatUserKeys(kv) {
  const keys = [];
  let cursor = '0';
  do {
    const res = await kv.scan(cursor, { match: 'chat:user:*', count: 200 });
    if (!res || !res.length) break;
    cursor = String(res[0]);
    const batch = res.slice(1);
    if (batch.length) keys.push.apply(keys, batch);
  } while (cursor !== '0');
  return keys;
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
  const kv = getKv();

  if (body.list === true) {
    if (body.secret !== scraperSecret) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    if (!kv) {
      return res.status(200).json({ ok: true, configured: false, users: [] });
    }
    let keys = [];
    try {
      keys = await collectChatUserKeys(kv);
    } catch {
      keys = [];
    }
    const users = [];
    for (const key of keys) {
      let raw;
      try {
        raw = await kv.get(key);
      } catch {
        continue;
      }
      if (raw == null) continue;
      let parsed = raw;
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }
      }
      if (!parsed || typeof parsed !== 'object') continue;
      if (!parsed.userId) {
        const id = String(key).replace(/^chat:user:/, '');
        if (id) parsed.userId = id;
      }
      users.push(parsed);
    }
    users.sort(function (a, b) {
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
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

  if (!kv) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const payload = {
    userId: userId.slice(0, 120),
    email: String(body.email || '').slice(0, 200),
    name: String(body.name || '').slice(0, 120),
    updatedAt: new Date().toISOString(),
    messages: messages.slice(-100),
  };

  try {
    await kv.set('chat:user:' + userId, payload);
  } catch (e) {
    return res.status(500).json({
      error: e && e.message ? e.message : 'Save failed',
    });
  }

  return res.status(200).json({ ok: true });
};
