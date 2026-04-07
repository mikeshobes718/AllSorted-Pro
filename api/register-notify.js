const { getSupabaseAdmin } = require('../lib/supabase-server');

function normalizeEmailList(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = {};
  for (let i = 0; i < arr.length; i++) {
    const s = String(arr[i] || '')
      .trim()
      .toLowerCase();
    if (!s || s.indexOf('@') === -1 || seen[s]) continue;
    seen[s] = true;
    out.push(s);
  }
  return out.slice(0, 20);
}

async function recordPendingSignup(registrantEmail, registrantName) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { recorded: false, reason: 'no_supabase' };
  }
  const name = String(registrantName || '').trim().slice(0, 200);
  const { data: existing, error: selErr } = await supabase
    .from('portal_access')
    .select('status')
    .eq('email', registrantEmail)
    .maybeSingle();

  if (selErr) {
    return { recorded: false, reason: selErr.message };
  }

  const now = new Date().toISOString();

  if (!existing) {
    const { error } = await supabase.from('portal_access').insert({
      email: registrantEmail,
      status: 'pending',
      display_name: name,
      updated_at: now,
    });
    return error ? { recorded: false, reason: error.message } : { recorded: true };
  }

  if (existing.status === 'approved') {
    return { recorded: true, skipped: true };
  }

  if (existing.status === 'denied') {
    const { error } = await supabase
      .from('portal_access')
      .update({
        status: 'pending',
        display_name: name,
        updated_at: now,
      })
      .eq('email', registrantEmail);
    return error ? { recorded: false, reason: error.message } : { recorded: true, reopened: true };
  }

  const { error } = await supabase
    .from('portal_access')
    .update({
      display_name: name,
      updated_at: now,
    })
    .eq('email', registrantEmail)
    .eq('status', 'pending');

  return error ? { recorded: false, reason: error.message } : { recorded: true };
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

  const registrantEmail = String(body.registrantEmail || '').trim().toLowerCase();
  if (!registrantEmail || registrantEmail.indexOf('@') === -1) {
    return res.status(400).json({ error: 'registrantEmail required' });
  }

  const registrantName = String(body.registrantName || '').trim().slice(0, 200);
  const employeeId =
    body.employeeId != null ? String(body.employeeId).slice(0, 12) : '';

  const signup = await recordPendingSignup(registrantEmail, registrantName);

  const envExtra = normalizeEmailList(
    String(process.env.ADMIN_NOTIFY_EMAILS || '')
      .split(',')
      .map(function (s) {
        return s.trim();
      })
  );
  const fromClient = normalizeEmailList(body.adminEmails);
  const recipients = [];
  const seen = {};
  envExtra.concat(fromClient).forEach(function (e) {
    if (!seen[e]) {
      seen[e] = true;
      recipients.push(e);
    }
  });

  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.RESEND_FROM_EMAIL ||
    process.env.EMAIL_FROM ||
    'AllSorted Pro <onboarding@resend.dev>';

  const portalBase =
    String(process.env.PORTAL_PUBLIC_URL || 'https://allsortedpro.com').replace(/\/$/, '');

  if (!recipients.length) {
    return res.status(200).json({
      ok: true,
      notified: false,
      reason: 'no_recipients',
      signup: signup,
    });
  }

  if (!apiKey) {
    return res.status(200).json({
      ok: true,
      notified: false,
      reason: 'missing_resend_key',
      signup: signup,
    });
  }

  const subject = 'New registration — AllSorted Pro caller portal';
  const text =
    'Someone just registered on the AllSorted Pro caller portal.\n\n' +
    'Name: ' +
    (registrantName || '—') +
    '\n' +
    'Email: ' +
    registrantEmail +
    '\n' +
    'Employee ID: ' +
    (employeeId || '—') +
    '\n\n' +
    'They are in **pending approval** until an admin approves them in the portal: Admin → Signup approvals.\n\n' +
    'Open Admin: ' +
    portalBase +
    '/caller-dashboard.html#view-admin\n';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from,
        to: recipients,
        subject: subject,
        text: text,
      }),
    });
    const data = await r.json().catch(function () {
      return {};
    });
    if (!r.ok) {
      return res.status(502).json({
        ok: false,
        error:
          (data && data.message) ||
          (typeof data === 'string' ? data : 'Resend error'),
        signup: signup,
      });
    }
    return res.status(200).json({ ok: true, notified: true, signup: signup });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      error: e && e.message ? e.message : 'Send failed',
      signup: signup,
    });
  }
};
