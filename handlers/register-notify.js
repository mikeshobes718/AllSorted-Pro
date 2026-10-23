'use strict';
const { getDb } = require('../lib/db');

function normalizeEmailList(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [], seen = {};
  for (const e of arr) {
    const s = String(e || '').trim().toLowerCase();
    if (!s || s.indexOf('@') === -1 || seen[s]) continue;
    seen[s] = true;
    out.push(s);
  }
  return out.slice(0, 20);
}

async function recordPendingSignup(sql, registrantEmail, registrantName) {
  if (!sql) return { recorded: false, reason: 'no_db' };
  const name = String(registrantName || '').trim().slice(0, 200);
  const now = new Date().toISOString();
  try {
    const existing = await sql`SELECT status FROM portal_access WHERE email = ${registrantEmail} LIMIT 1`;
    if (!existing.length) {
      await sql`INSERT INTO portal_access (email, status, display_name, created_at, updated_at) VALUES (${registrantEmail}, 'pending', ${name}, ${now}, ${now})`;
      return { recorded: true };
    }
    const st = existing[0].status;
    if (st === 'approved') return { recorded: true, skipped: true };
    if (st === 'denied') {
      await sql`UPDATE portal_access SET status = 'pending', display_name = ${name}, updated_at = ${now} WHERE email = ${registrantEmail}`;
      return { recorded: true, reopened: true };
    }
    await sql`UPDATE portal_access SET display_name = ${name}, updated_at = ${now} WHERE email = ${registrantEmail} AND status = 'pending'`;
    return { recorded: true };
  } catch (e) {
    return { recorded: false, reason: e && e.message ? e.message : 'db_error' };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid body' });

  const registrantEmail = String(body.registrantEmail || '').trim().toLowerCase();
  if (!registrantEmail || registrantEmail.indexOf('@') === -1) return res.status(400).json({ error: 'registrantEmail required' });

  const registrantName = String(body.registrantName || '').trim().slice(0, 200);
  const employeeId = body.employeeId != null ? String(body.employeeId).slice(0, 12) : '';

  const sql = getDb();
  const signup = await recordPendingSignup(sql, registrantEmail, registrantName);

  const envExtra = normalizeEmailList(String(process.env.ADMIN_NOTIFY_EMAILS || '').split(',').map(s => s.trim()));
  const fromClient = normalizeEmailList(body.adminEmails);
  const recipients = [];
  const seen = {};
  envExtra.concat(fromClient).forEach(e => { if (!seen[e]) { seen[e] = true; recipients.push(e); } });

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM || 'AllSorted Pro <onboarding@resend.dev>';
  const portalBase = String(process.env.PORTAL_PUBLIC_URL || 'https://allsortedpro.com').replace(/\/$/, '');

  if (!recipients.length) return res.status(200).json({ ok: true, notified: false, reason: 'no_recipients', signup });
  if (!apiKey) return res.status(200).json({ ok: true, notified: false, reason: 'missing_resend_key', signup });

  const subject = 'New registration — AllSorted Pro caller portal';
  const text = 'Someone just registered on the AllSorted Pro caller portal.\n\nName: ' + (registrantName || '—') + '\nEmail: ' + registrantEmail + '\nEmployee ID: ' + (employeeId || '—') + '\n\nThey are in **pending approval** until an admin approves them in the portal: Admin → Signup approvals.\n\nOpen Admin: ' + portalBase + '/caller-dashboard.html#view-admin\n';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipients, subject, text }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ ok: false, error: (data && data.message) || (typeof data === 'string' ? data : 'Resend error'), signup });
    return res.status(200).json({ ok: true, notified: true, signup });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e && e.message ? e.message : 'Send failed', signup });
  }
};
