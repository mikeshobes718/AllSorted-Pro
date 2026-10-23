'use strict';
const { getDb } = require('../lib/db');

function nowIso() { return new Date().toISOString(); }

function calcWorkedMs(shift) {
  if (!shift || !shift.clockedInAt) return 0;
  const start = new Date(shift.clockedInAt).getTime();
  const end = Date.now();
  let totalBreak = 0;
  if (Array.isArray(shift.breaks)) {
    shift.breaks.forEach(function(b) {
      const bs = new Date(b.start).getTime();
      const be = b.end ? new Date(b.end).getTime() : end;
      totalBreak += be - bs;
    });
  }
  return Math.max(0, end - start - totalBreak);
}

function cutoff90d() {
  return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
}

function shiftFromRow(row) {
  if (!row) return null;
  return {
    clockedInAt: row.clocked_in_at,
    status: row.status,
    breaks: row.breaks || [],
    userId: row.user_id,
    email: row.email,
    name: row.name,
  };
}

function entryFromRow(row) {
  if (!row) return null;
  const e = { type: row.entry_type, ts: row.ts, ip: row.ip, note: row.note, name: row.name, email: row.email };
  if (row.shift_start != null) e.shiftStart = row.shift_start;
  if (row.breaks != null) e.breaks = row.breaks;
  if (row.worked_ms != null) e.workedMs = row.worked_ms;
  if (row.adjusted_by != null) e.adjustedBy = row.adjusted_by;
  if (row.adjusted_at != null) e.adjustedAt = row.adjusted_at;
  return e;
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

  const sql = getDb();
  if (!sql) return res.status(200).json({ ok: false, configured: false, error: 'DB not configured' });

  const action = String(body.action || '').trim();
  const userId = String(body.userId || '').trim();
  const email = String(body.email || '').trim();
  const name = String(body.name || '').trim();
  const note = String(body.note || '').trim().slice(0, 300);
  const scraperSecret = process.env.SCRAPER_SECRET || 'Free2026';
  let ip = '';
  try {
    ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  } catch {}

  try {
    if (action === 'clock_in') {
      if (!userId) return res.status(400).json({ error: 'userId required' });
      const existing = await sql`SELECT * FROM timeclock_active_shifts WHERE user_id = ${userId} LIMIT 1`;
      if (existing.length > 0 && existing[0].clocked_in_at) {
        return res.status(200).json({ ok: false, error: 'Already clocked in', active: shiftFromRow(existing[0]) });
      }
      const shift = { clockedInAt: nowIso(), breaks: [], status: 'working', userId, email, name };
      await sql`
        INSERT INTO timeclock_active_shifts (user_id, clocked_in_at, status, breaks, email, name, updated_at)
        VALUES (${userId}, ${shift.clockedInAt}, 'working', ${JSON.stringify([])}, ${email}, ${name}, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          clocked_in_at = EXCLUDED.clocked_in_at, status = EXCLUDED.status, breaks = EXCLUDED.breaks,
          email = EXCLUDED.email, name = EXCLUDED.name, updated_at = EXCLUDED.updated_at
      `;
      await sql`
        INSERT INTO timeclock_entries (user_id, entry_type, ts, ip, note, name, email, created_at)
        VALUES (${userId}, 'clock_in', ${shift.clockedInAt}, ${ip||null}, ${note||null}, ${name||null}, ${email||null}, NOW())
      `;
      return res.status(200).json({ ok: true, active: shift });
    }

    if (action === 'clock_out') {
      if (!userId) return res.status(400).json({ error: 'userId required' });
      const rows = await sql`SELECT * FROM timeclock_active_shifts WHERE user_id = ${userId} LIMIT 1`;
      if (!rows.length || !rows[0].clocked_in_at) return res.status(200).json({ ok: false, error: 'Not clocked in' });
      const shift = shiftFromRow(rows[0]);
      if (shift.status === 'on_break' && Array.isArray(shift.breaks) && shift.breaks.length) {
        const last = shift.breaks[shift.breaks.length - 1];
        if (!last.end) last.end = nowIso();
      }
      const workedMs = calcWorkedMs(shift);
      const ts = nowIso();
      await sql`
        INSERT INTO timeclock_entries (user_id, entry_type, ts, ip, note, name, email, shift_start, breaks, worked_ms, created_at)
        VALUES (${userId}, 'clock_out', ${ts}, ${ip||null}, ${note||null}, ${name||null}, ${email||null},
          ${shift.clockedInAt}, ${JSON.stringify(shift.breaks)}, ${workedMs}, NOW())
      `;
      await sql`DELETE FROM timeclock_active_shifts WHERE user_id = ${userId}`;
      return res.status(200).json({ ok: true, workedMs });
    }

    if (action === 'break_start') {
      if (!userId) return res.status(400).json({ error: 'userId required' });
      const rows = await sql`SELECT * FROM timeclock_active_shifts WHERE user_id = ${userId} LIMIT 1`;
      if (!rows.length || !rows[0].clocked_in_at) return res.status(200).json({ ok: false, error: 'Not clocked in' });
      const shift = shiftFromRow(rows[0]);
      if (shift.status === 'on_break') return res.status(200).json({ ok: false, error: 'Already on break' });
      if (!Array.isArray(shift.breaks)) shift.breaks = [];
      shift.breaks.push({ start: nowIso(), end: null });
      shift.status = 'on_break';
      const breakTs = shift.breaks[shift.breaks.length - 1].start;
      await sql`
        UPDATE timeclock_active_shifts SET status = 'on_break', breaks = ${JSON.stringify(shift.breaks)}, updated_at = NOW()
        WHERE user_id = ${userId}
      `;
      await sql`
        INSERT INTO timeclock_entries (user_id, entry_type, ts, ip, note, name, email, created_at)
        VALUES (${userId}, 'break_start', ${breakTs}, ${ip||null}, ${note||null}, ${name||null}, ${email||null}, NOW())
      `;
      return res.status(200).json({ ok: true, active: shift });
    }

    if (action === 'break_end') {
      if (!userId) return res.status(400).json({ error: 'userId required' });
      const rows = await sql`SELECT * FROM timeclock_active_shifts WHERE user_id = ${userId} LIMIT 1`;
      if (!rows.length || !rows[0].clocked_in_at) return res.status(200).json({ ok: false, error: 'Not clocked in' });
      const shift = shiftFromRow(rows[0]);
      if (shift.status !== 'on_break') return res.status(200).json({ ok: false, error: 'Not on break' });
      if (Array.isArray(shift.breaks) && shift.breaks.length) {
        const last = shift.breaks[shift.breaks.length - 1];
        if (!last.end) last.end = nowIso();
      }
      shift.status = 'working';
      await sql`
        UPDATE timeclock_active_shifts SET status = 'working', breaks = ${JSON.stringify(shift.breaks)}, updated_at = NOW()
        WHERE user_id = ${userId}
      `;
      await sql`
        INSERT INTO timeclock_entries (user_id, entry_type, ts, ip, note, name, email, created_at)
        VALUES (${userId}, 'break_end', ${nowIso()}, ${ip||null}, ${note||null}, ${name||null}, ${email||null}, NOW())
      `;
      return res.status(200).json({ ok: true, active: shift });
    }

    if (action === 'status') {
      if (!userId) return res.status(400).json({ error: 'userId required' });
      const shiftRows = await sql`SELECT * FROM timeclock_active_shifts WHERE user_id = ${userId} LIMIT 1`;
      const entryRows = await sql`SELECT * FROM timeclock_entries WHERE user_id = ${userId} AND ts >= ${cutoff90d()} ORDER BY ts ASC`;
      return res.status(200).json({ ok: true, configured: true, active: shiftRows.length ? shiftFromRow(shiftRows[0]) : null, log: entryRows.map(entryFromRow) });
    }

    if (action === 'history') {
      if (!userId) return res.status(400).json({ error: 'userId required' });
      const entryRows = await sql`SELECT * FROM timeclock_entries WHERE user_id = ${userId} AND ts >= ${cutoff90d()} ORDER BY ts ASC`;
      return res.status(200).json({ ok: true, configured: true, log: entryRows.map(entryFromRow) });
    }

    if (action === 'admin_list') {
      if (body.secret !== scraperSecret) return res.status(401).json({ error: 'Wrong password' });
      const activeRows = await sql`SELECT * FROM timeclock_active_shifts`;
      const actives = activeRows.map(function(row) {
        const s = shiftFromRow(row);
        s._workedMs = calcWorkedMs(s);
        return s;
      });
      const entryRows = await sql`SELECT * FROM timeclock_entries WHERE ts >= ${cutoff90d()} ORDER BY ts ASC`;
      const allLogs = {};
      entryRows.forEach(function(row) {
        const uid = row.user_id;
        if (!allLogs[uid]) allLogs[uid] = [];
        allLogs[uid].push(entryFromRow(row));
      });
      return res.status(200).json({ ok: true, configured: true, actives, logs: allLogs });
    }

    if (action === 'admin_adjust') {
      if (body.secret !== scraperSecret) return res.status(401).json({ error: 'Wrong password' });
      const targetUserId = String(body.targetUserId || '').trim();
      if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
      const entry = body.entry;
      if (!entry || !entry.type || !entry.ts) return res.status(400).json({ error: 'entry with type and ts required' });
      await sql`
        INSERT INTO timeclock_entries (user_id, entry_type, ts, ip, note, name, email, shift_start, breaks, worked_ms, adjusted_by, adjusted_at, created_at)
        VALUES (${targetUserId}, ${entry.type}, ${entry.ts}, ${entry.ip||null}, ${entry.note||null},
          ${entry.name||null}, ${entry.email||null}, ${entry.shiftStart||null},
          ${entry.breaks ? JSON.stringify(entry.breaks) : null}, ${entry.workedMs||null},
          'admin', ${nowIso()}, NOW())
      `;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'server error' });
  }
};
