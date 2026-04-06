const crypto = require('crypto');

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

function rosterKeyFromEmail(email) {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (!e || e.indexOf('@') === -1) return null;
  return 'portal:roster:byemail:v1:' + crypto.createHash('sha256').update(e).digest('hex');
}

async function readTeamChatClearState(kv) {
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

async function writeTeamChatClearState(kv, state) {
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
  if (body.secret !== scraperSecret) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  if (body.action !== 'purge') {
    return res.status(400).json({ error: 'Invalid action' });
  }

  const email = String(body.email || '')
    .trim()
    .toLowerCase();
  const userId = String(body.userId || '')
    .trim()
    .slice(0, 120);
  if (!email || email.indexOf('@') === -1) {
    return res.status(400).json({ error: 'email required' });
  }
  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  const kv = getKv();
  if (!kv) {
    return res.status(200).json({ ok: false, error: 'kv_not_configured' });
  }

  const rk = rosterKeyFromEmail(email);
  if (rk) {
    try {
      await kv.del(rk);
    } catch (e) {
      /* continue */
    }
  }

  try {
    await kv.del('portal:presence:v1:' + userId);
  } catch (e) {
    /* continue */
  }

  try {
    const state = await readTeamChatClearState(kv);
    delete state.pending[userId];
    delete state.approved[userId];
    await writeTeamChatClearState(kv, state);
  } catch (e) {
    /* continue */
  }

  try {
    await kv.del('chat:user:' + userId);
  } catch (e) {
    /* continue */
  }

  return res.status(200).json({ ok: true });
};
