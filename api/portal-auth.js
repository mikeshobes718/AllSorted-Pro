const crypto = require('crypto');
const { getSupabaseAdmin } = require('../lib/supabase-server');

/* ── Helpers ── */
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
    id: row.id,
    email: row.email,
    name: row.name || '',
    role: row.role || 'caller',
    employeeId: row.employee_id,
    employmentStatus: row.employment_status || 'active',
    createdAt: row.created_at,
  };
}

/* ── Supabase data helpers ── */
async function getUser(sb, email) {
  const { data } = await sb.from('portal_users').select('*').eq('email', norm(email)).maybeSingle();
  return data || null;
}

async function putUser(sb, rec) {
  await sb.from('portal_users').upsert(rec, { onConflict: 'id' });
}

async function getAllUsers(sb) {
  const { data } = await sb.from('portal_users').select('*');
  return data || [];
}

const ADMIN_EMAIL = 'hello@allsortedpro.com';
const ADMIN_DEFAULT_PW = 'AllSorted2026!';

async function ensureSeed(sb) {
  const { count } = await sb.from('portal_users').select('*', { count: 'exact', head: true });
  if (count > 0) return;
  await putUser(sb, {
    id: genId(),
    email: norm(ADMIN_EMAIL),
    password_hash: hashPw(ADMIN_EMAIL, ADMIN_DEFAULT_PW),
    name: 'Admin',
    role: 'admin',
    employee_id: '100',
    employment_status: 'active',
  });
}

/* ── Handler ── */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Bad JSON' }); }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Bad body' });

  const sb = getSupabaseAdmin();
  if (!sb) return res.json({ ok: false, error: 'storage_unavailable' });

  await ensureSeed(sb);

  const action = String(body.action || '');
  const secret = process.env.SCRAPER_SECRET || 'Free2026';

  /* ── LOGIN ── */
  if (action === 'login') {
    const email = norm(body.email);
    const pw = String(body.password || '');
    if (!email || !pw) return res.json({ ok: false, error: 'Email and password required' });

    const rec = await getUser(sb, email);
    if (!rec || !rec.password_hash) return res.json({ ok: false, error: 'Invalid email or password' });

    const want = Buffer.from(rec.password_hash, 'hex');
    const got = Buffer.from(hashPw(email, pw), 'hex');
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) {
      return res.json({ ok: false, error: 'Invalid email or password' });
    }
    return res.json({ ok: true, user: safe(rec) });
  }

  /* ── REGISTER ── */
  if (action === 'register') {
    const email = norm(body.email);
    const pw = String(body.password || '');
    const name = String(body.name || '').trim();
    if (!email || !pw) return res.json({ ok: false, error: 'Email and password are required' });
    if (!name || name.split(/\s+/).filter(Boolean).length < 2)
      return res.json({ ok: false, error: 'Enter both first and last name' });

    const exists = await getUser(sb, email);
    if (exists) return res.json({ ok: false, error: 'An account with this email already exists' });

    const all = await getAllUsers(sb);
    const rec = {
      id: genId(),
      email,
      password_hash: hashPw(email, pw),
      name,
      role: 'caller',
      employee_id: String(pickEid(all)),
      employment_status: 'active',
    };
    await putUser(sb, rec);
    return res.json({ ok: true, user: safe(rec) });
  }

  /* ── RESET PASSWORD ── */
  if (action === 'reset_password') {
    const email = norm(body.email);
    const pw = String(body.password || '');
    if (!email || !pw) return res.json({ ok: false, error: 'Email and new password required' });
    if (pw.length < 4) return res.json({ ok: false, error: 'Password must be at least 4 characters' });

    const rec = await getUser(sb, email);
    if (!rec) return res.json({ ok: false, error: 'No account found with this email' });
    await putUser(sb, { ...rec, password_hash: hashPw(email, pw), updated_at: new Date().toISOString() });
    return res.json({ ok: true });
  }

  /* ── CHANGE PASSWORD (authenticated) ── */
  if (action === 'change_password') {
    const email = norm(body.email);
    const curPw = String(body.currentPassword || '');
    const newPw = String(body.newPassword || '');
    if (!email || !curPw || !newPw) return res.json({ ok: false, error: 'All fields required' });
    if (newPw.length < 4) return res.json({ ok: false, error: 'Password must be at least 4 characters' });

    const rec = await getUser(sb, email);
    if (!rec || !rec.password_hash) return res.json({ ok: false, error: 'Account not found' });
    const want = Buffer.from(rec.password_hash, 'hex');
    const got = Buffer.from(hashPw(email, curPw), 'hex');
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got))
      return res.json({ ok: false, error: 'Current password is incorrect' });
    await putUser(sb, { ...rec, password_hash: hashPw(email, newPw), updated_at: new Date().toISOString() });
    return res.json({ ok: true });
  }

  /* ── LIST USERS (admin) ── */
  if (action === 'list_users') {
    if (body.secret !== secret) return res.status(401).json({ error: 'Unauthorized' });
    const all = await getAllUsers(sb);
    return res.json({ ok: true, users: all.map(safe) });
  }

  /* ── UPDATE USER (admin) ── */
  if (action === 'update_user') {
    if (body.secret !== secret) return res.status(401).json({ error: 'Unauthorized' });
    const email = norm(body.email);
    if (!email) return res.json({ ok: false, error: 'email required' });
    const rec = await getUser(sb, email);
    if (!rec) return res.json({ ok: false, error: 'not_found' });
    const c = body.changes || {};
    const updates = { updated_at: new Date().toISOString() };
    if (c.role !== undefined) updates.role = c.role;
    if (c.employmentStatus !== undefined) updates.employment_status = c.employmentStatus;
    if (c.name !== undefined) updates.name = c.name;
    if (c.employeeId !== undefined) updates.employee_id = String(c.employeeId);
    await putUser(sb, { ...rec, ...updates });
    const updated = await getUser(sb, email);
    return res.json({ ok: true, user: safe(updated) });
  }

  /* ── DELETE USER (admin) ── */
  if (action === 'delete_user') {
    if (body.secret !== secret) return res.status(401).json({ error: 'Unauthorized' });
    const email = norm(body.email);
    if (!email) return res.json({ ok: false, error: 'email required' });
    await sb.from('portal_users').delete().eq('email', email);
    return res.json({ ok: true });
  }

  /* ── MIGRATE (bulk import from localStorage — only creates NEW accounts) ── */
  if (action === 'migrate') {
    if (body.secret !== secret) return res.status(401).json({ error: 'Unauthorized' });
    const users = body.users;
    if (!Array.isArray(users)) return res.json({ ok: false, error: 'users array required' });
    let migrated = 0, skipped = 0;
    for (const u of users) {
      if (!u || !u.email || !u.password) { skipped++; continue; }
      const email = norm(u.email);
      const exists = await getUser(sb, email);
      if (exists) { skipped++; continue; }
      await putUser(sb, {
        id: u.id || genId(),
        email,
        password_hash: hashPw(email, u.password),
        name: u.name || '',
        role: u.role || 'caller',
        employee_id: u.employeeId != null ? String(u.employeeId) : null,
        employment_status: u.employmentStatus || 'active',
      });
      migrated++;
    }
    return res.json({ ok: true, migrated, skipped });
  }

  return res.status(400).json({ error: 'Unknown action' });
};
