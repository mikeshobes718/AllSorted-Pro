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

  const apiKey = process.env.QUO_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    return res.status(200).json({
      ok: false,
      configured: false,
      error: 'QUO_API_KEY is not set on the server',
    });
  }

  const base = 'https://api.openphone.com';
  const headers = {
    Authorization: String(apiKey).trim(),
    Accept: 'application/json',
  };

  let action = 'conversations';
  if (body.action === 'phoneNumbers') action = 'phoneNumbers';
  else if (body.action === 'messages') action = 'messages';

  try {
    if (action === 'phoneNumbers') {
      const r = await fetch(`${base}/v1/phone-numbers`, { headers });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(200).json({
          ok: false,
          configured: true,
          status: r.status,
          error: j.message || j.title || 'OpenPhone request failed',
          details: j,
        });
      }
      return res.status(200).json({ ok: true, configured: true, data: j });
    }

    if (action === 'messages') {
      const phoneNumberId = body.phoneNumberId && String(body.phoneNumberId).trim();
      let participants = body.participants;
      if (typeof participants === 'string') {
        participants = [participants];
      }
      if (!phoneNumberId || !Array.isArray(participants) || participants.length === 0) {
        return res.status(400).json({ error: 'phoneNumberId and participants required' });
      }
      const maxResults = Math.min(100, Math.max(1, parseInt(body.maxResults, 10) || 30));
      const u = new URL(`${base}/v1/messages`);
      u.searchParams.set('phoneNumberId', phoneNumberId);
      participants.forEach((p) => u.searchParams.append('participants', String(p).trim()));
      u.searchParams.set('maxResults', String(maxResults));
      const r = await fetch(u.toString(), { headers });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(200).json({
          ok: false,
          configured: true,
          status: r.status,
          error: j.message || j.title || 'OpenPhone request failed',
          details: j,
        });
      }
      return res.status(200).json({ ok: true, configured: true, data: j });
    }

    const defaultPhone = process.env.QUO_DEFAULT_PHONE_E164 || '+19177733276';
    const phone =
      (body.phoneE164 && String(body.phoneE164).trim()) ||
      (body.phoneNumber && String(body.phoneNumber).trim()) ||
      defaultPhone;
    const maxResults = Math.min(100, Math.max(1, parseInt(body.maxResults, 10) || 25));

    const u = new URL(`${base}/v1/conversations`);
    u.searchParams.set('maxResults', String(maxResults));
    u.searchParams.append('phoneNumbers', phone);

    const r = await fetch(u.toString(), { headers });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(200).json({
        ok: false,
        configured: true,
        status: r.status,
        error: j.message || j.title || 'OpenPhone request failed',
        details: j,
      });
    }
    return res.status(200).json({ ok: true, configured: true, data: j, phoneFilter: phone });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e && e.message ? e.message : 'server error',
    });
  }
};
