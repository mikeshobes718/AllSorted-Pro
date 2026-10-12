'use strict';
const crypto = require('crypto');
const { getDb } = require('../lib/db');

function norm(email) {
  return String(email || '').trim().toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g, '');
}

const PEPPER = 'asp-auth-v3';
function hashPw(email, password) {
  return crypto.createHash('sha256')
    .update(PEPPER + '|' + norm(email) + '|' + String(password), 'utf8')
    .digest('hex');
}

function genId() {
  return 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function pickEid(existing) {
  const taken = {};
  (existing || []).forEach(u => {
    const n = parseInt(String(u.employee_id), 10);
    if (n >= 100 && n <= 999) taken[n] = true;
  });
  let id, tries = 0;
  do { id = 100 + Math.floor(Math.random() * 900); tries++; } while (taken[id] && tries < 500);
  return id;
}

function safe(row) {
  if (!row) return null;
  return {
    id: row.id, email: row.email, name: row.name || '',
    role: row.role || 'caller', employeeId: row.employee_id,
    employmentStatus: row.employment_status || 'active', createdAt: row.created_at,
  };
}

const ADMIN_EMAIL = 'hello@allsortedpro.com';
const ADMIN_DEFAULT_PW = 'AllSorted2026!';

async function ensureSeed(sql) {
  const rows = await sql`SELECT COUNT(*)::int AS cnt FROM portal_users`;
  if ((rows[0] || {}).cnt > 0) return;
  const now = new Date().toISOString();
  await sql`
    INSERT INTO portal_users (id, email, password_hash, name, role, employee_id, employment_status, created_at, updated_at)
    VALUES (${genId()}, ${norm(ADMIN_EMAIL)}, ${hashPw(ADMIN_EMAIL, ADMIN_DEFAULT_PW)}, 'Admin', 'admin', '100', 'active', ${now}, ${now})
    ON CONFLICT DO NOTHING
  `;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Bad JSON' }); }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Bad body' });

  const sql = getDb();
  if (!sql) return res.json({ ok: false, error: 'storage_unavailable' });

  try {
    await ensureSeed(sql);
  } catch {}

  const action = String(body.action || '');
  const secret = process.env.SCRAPER_SECRET || 'Free2026';

  if (action === 'login') {
    const email = norm(body.email);
    const pw = String(body.password || '');
    if (!email || !pw) return res.json({ ok: false, error: 'Email and password required' });
    const rows = await sql`SELECT * FROM portal_users WHERE email = ${email} LIMIT 1`;
    const rec = rows[0] || null;
    if (!rec || !rec.password_hash) return res.json({ ok: false, error: 'Invalid email or password' });
    const want = Buffer.from(rec.password_hash, 'hex');
    const got = Buffer.from(hashPw(email, pw), 'hex');
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got))
      return res.json({ ok: false, error: 'Invalid email or password' });
    return res.json({ ok: true, user: safe(rec) });
  }

  if (action === 'register') {
    const email = norm(body.email);
    const pw = String(body.password || '');
    const name = String(body.name || '').trim();
    if (!email || !pw) return res.json({ ok: false, error: 'Email and password are required' });
    if (!name || name.split(/\s+/).filter(Boolean).length < 2)
      return res.json({ ok: false, error: 'Enter both first and last name' });
    const existing = await sql`SELECT id FROM portal_users WHERE email = ${email} LIMIT 1`;
    if (existing.length > 0) return res.json({ ok: false, error: 'An account with this email already exists' });
    const all = await sql`SELECT employee_id FROM portal_users`;
    const now = new Date().toISOString();
    const newEid = String(pickEid(all));
    await sql`
      INSERT INTO portal_users (id, email, password_hash, name, role, employee_id, employment_status, created_at, updated_at)
      VALUES (${genId()}, ${email}, ${hashPw(email, pw)}, ${name}, 'caller', ${newEid}, 'active', ${now}, ${now})
    `;
    const created = await sql`SELECT * FROM portal_users WHERE email = ${email} LIMIT 1`;
    return res.json({ ok: true, user: safe(created[0]) });
  }

  if (action === 'reset_password') {
    const email = norm(body.email);
    const pw = String(body.password || '');
    if (!email || !pw) return res.json({ ok: false, error: 'Email and new password required' });
    if (pw.length < 4) return res.json({ ok: false, error: 'Password must be at least 4 characters' });
    const rows = await sql`SELECT id FROM portal_users WHERE email = ${email} LIMIT 1`;
    if (!rows.length) return res.json({ ok: false, error: 'No account found with this email' });
    await sql`UPDATE portal_users SET password_hash = ${hashPw(email, pw)}, updated_at = NOW() WHERE email = ${email}`;
    return res.json({ ok: true });
  }

  if (action === 'change_password') {
    const email = norm(body.email);
    const curPw = String(body.currentPassword || '');
    const newPw = String(body.newPassword || '');
    if (!email || !curPw || !newPw) return res.json({ ok: false, error: 'All fields required' });
    if (newPw.length < 4) return res.json({ ok: false, error: 'Password must be at least 4 characters' });
    const rows = await sql`SELECT password_hash FROM portal_users WHERE email = ${email} LIMIT 1`;
    if (!rows.length) return res.json({ ok: false, error: 'Account not found' });
    const want = Buffer.from(rows[0].password_hash, 'hex');
    const got = Buffer.from(hashPw(email, curPw), 'hex');
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got))
      return res.json({ ok: false, error: 'Current password is incorrect' });
    await sql`UPDATE portal_users SET password_hash = ${hashPw(email, newPw)}, updated_at = NOW() WHERE email = ${email}`;
    return res.json({ ok: true });
  }

  if (action === 'list_users') {
    if (body.secret !== secret) return res.status(401).json({ error: 'Unauthorized' });
    const all = await sql`SELECT * FROM portal_users ORDER BY created_at`;
    return res.json({ ok: true, users: all.map(safe) });
  }

  if (action === 'update_user') {
    if (body.secret !== secret) return res.status(401).json({ error: 'Unauthorized' });
    const email = norm(body.email);
    if (!email) return res.json({ ok: false, error: 'email required' });
    const rows = await sql`SELECT * FROM portal_users WHERE email = ${email} LIMIT 1`;
    if (!rows.length) return res.json({ ok: false, error: 'not_found' });
    const rec = rows[0];
    const c = body.changes || {};
    const newRole = c.role !== undefined ? c.role : rec.role;
    const newEs = c.employmentStatus !== undefined ? c.employmentStatus : rec.employment_status;
    const newName = c.name !== undefined ? c.name : rec.name;
    const newEid = c.employeeId !== undefined ? String(c.employeeId) : rec.employee_id;
    await sql`
      UPDATE portal_users SET role = ${newRole}, employment_status = ${newEs},
        name = ${newName}, employee_id = ${newEid}, updated_at = NOW()
      WHERE email = ${email}
    `;
    const updated = await sql`SELECT * FROM portal_users WHERE email = ${email} LIMIT 1`;
    return res.json({ ok: true, user: safe(updated[0]) });
  }

  if (action === 'delete_user') {
    if (body.secret !== secret) return res.status(401).json({ error: 'Unauthorized' });
    const email = norm(body.email);
    if (!email) return res.json({ ok: false, error: 'email required' });
    await sql`DELETE FROM portal_users WHERE email = ${email}`;
    return res.json({ ok: true });
  }

  if (action === 'migrate') {
    if (body.secret !== secret) return res.status(401).json({ error: 'Unauthorized' });
    const users = body.users;
    if (!Array.isArray(users)) return res.json({ ok: false, error: 'users array required' });
    let migrated = 0, skipped = 0;
    for (const u of users) {
      if (!u || !u.email || !u.password) { skipped++; continue; }
      const email = norm(u.email);
      const existing = await sql`SELECT id FROM portal_users WHERE email = ${email} LIMIT 1`;
      if (existing.length > 0) { skipped++; continue; }
      const now = new Date().toISOString();
      await sql`
        INSERT INTO portal_users (id, email, password_hash, name, role, employee_id, employment_status, created_at, updated_at)
        VALUES (${u.id || genId()}, ${email}, ${hashPw(email, u.password)}, ${u.name||''}, ${u.role||'caller'}, ${u.employeeId != null ? String(u.employeeId) : null}, ${u.employmentStatus||'active'}, ${now}, ${now})
        ON CONFLICT DO NOTHING
      `;
      migrated++;
    }
    return res.json({ ok: true, migrated, skipped });
  }

  return res.status(400).json({ error: 'Unknown action' });
};
