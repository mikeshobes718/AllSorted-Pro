var { getSupabaseAdmin } = require('../lib/supabase-server');

function nowIso() {
  return new Date().toISOString();
}

function calcWorkedMs(shift) {
  if (!shift || !shift.clockedInAt) return 0;
  var start = new Date(shift.clockedInAt).getTime();
  var end = Date.now();
  var totalBreak = 0;
  if (Array.isArray(shift.breaks)) {
    shift.breaks.forEach(function (b) {
      var bs = new Date(b.start).getTime();
      var be = b.end ? new Date(b.end).getTime() : end;
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
  var e = {
    type: row.entry_type,
    ts: row.ts,
    ip: row.ip,
    note: row.note,
    name: row.name,
    email: row.email,
  };
  if (row.shift_start != null) e.shiftStart = row.shift_start;
  if (row.breaks != null) e.breaks = row.breaks;
  if (row.worked_ms != null) e.workedMs = row.worked_ms;
  if (row.adjusted_by != null) e.adjustedBy = row.adjusted_by;
  if (row.adjusted_at != null) e.adjustedAt = row.adjusted_at;
  return e;
}

async function getActiveShift(supabase, userId) {
  var { data } = await supabase
    .from('timeclock_active_shifts')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return data ? shiftFromRow(data) : null;
}

async function upsertActiveShift(supabase, userId, shift) {
  await supabase.from('timeclock_active_shifts').upsert(
    {
      user_id: userId,
      clocked_in_at: shift.clockedInAt,
      status: shift.status,
      breaks: shift.breaks,
      email: shift.email,
      name: shift.name,
      updated_at: nowIso(),
    },
    { onConflict: 'user_id' }
  );
}

async function deleteActiveShift(supabase, userId) {
  await supabase
    .from('timeclock_active_shifts')
    .delete()
    .eq('user_id', userId);
}

async function insertEntry(supabase, entry) {
  await supabase.from('timeclock_entries').insert({
    user_id: entry.userId,
    entry_type: entry.type,
    ts: entry.ts,
    ip: entry.ip || null,
    note: entry.note || null,
    name: entry.name || null,
    email: entry.email || null,
    shift_start: entry.shiftStart || null,
    breaks: entry.breaks || null,
    worked_ms: entry.workedMs || null,
    adjusted_by: entry.adjustedBy || null,
    adjusted_at: entry.adjustedAt || null,
    created_at: nowIso(),
  });
}

async function getEntries(supabase, userId) {
  var { data } = await supabase
    .from('timeclock_entries')
    .select('*')
    .eq('user_id', userId)
    .gte('ts', cutoff90d())
    .order('ts', { ascending: true });
  return (data || []).map(entryFromRow);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid body' });

  var supabase = getSupabaseAdmin();
  if (!supabase) return res.status(200).json({ ok: false, configured: false, error: 'Supabase not configured' });

  var action = String(body.action || '').trim();
  var userId = String(body.userId || '').trim();
  var email = String(body.email || '').trim();
  var name = String(body.name || '').trim();
  var note = String(body.note || '').trim().slice(0, 300);
  var scraperSecret = process.env.SCRAPER_SECRET || 'Free2026';
  var ip = '';
  try {
    ip = String(
      req.headers['x-real-ip'] ||
      req.headers['x-forwarded-for'] ||
      req.socket.remoteAddress ||
      ''
    ).split(',')[0].trim();
  } catch {}

  try {
    if (action === 'clock_in') {
      if (!userId) return res.status(400).json({ error: 'userId required' });
      var existing = await getActiveShift(supabase, userId);
      if (existing && existing.clockedInAt) {
        return res.status(200).json({ ok: false, error: 'Already clocked in', active: existing });
      }
      var shift = {
        clockedInAt: nowIso(),
        breaks: [],
        status: 'working',
        userId: userId,
        email: email,
        name: name,
      };
      await upsertActiveShift(supabase, userId, shift);
      await insertEntry(supabase, { userId: userId, type: 'clock_in', ts: shift.clockedInAt, ip: ip, note: note, name: name, email: email });
      return res.status(200).json({ ok: true, active: shift });
    }

    if (action === 'clock_out') {
      if (!userId) return res.status(400).json({ error: 'userId required' });
      var shift = await getActiveShift(supabase, userId);
      if (!shift || !shift.clockedInAt) {
        return res.status(200).json({ ok: false, error: 'Not clocked in' });
      }
      if (shift.status === 'on_break' && Array.isArray(shift.breaks) && shift.breaks.length) {
        var last = shift.breaks[shift.breaks.length - 1];
        if (!last.end) last.end = nowIso();
      }
      var workedMs = calcWorkedMs(shift);
      var ts = nowIso();
      await insertEntry(supabase, {
        userId: userId,
        type: 'clock_out',
        ts: ts,
        ip: ip,
        note: note,
        name: name,
        email: email,
        shiftStart: shift.clockedInAt,
        breaks: shift.breaks,
        workedMs: workedMs,
      });
      await deleteActiveShift(supabase, userId);
      return res.status(200).json({ ok: true, workedMs: workedMs });
    }

    if (action === 'break_start') {
      if (!userId) return res.status(400).json({ error: 'userId required' });
      var shift = await getActiveShift(supabase, userId);
      if (!shift || !shift.clockedInAt) return res.status(200).json({ ok: false, error: 'Not clocked in' });
      if (shift.status === 'on_break') return res.status(200).json({ ok: false, error: 'Already on break' });
      if (!Array.isArray(shift.breaks)) shift.breaks = [];
      shift.breaks.push({ start: nowIso(), end: null });
      shift.status = 'on_break';
      await upsertActiveShift(supabase, userId, shift);
      var breakTs = shift.breaks[shift.breaks.length - 1].start;
      await insertEntry(supabase, { userId: userId, type: 'break_start', ts: breakTs, ip: ip, note: note, name: name, email: email });
      return res.status(200).json({ ok: true, active: shift });
    }

    if (action === 'break_end') {
      if (!userId) return res.status(400).json({ error: 'userId required' });
      var shift = await getActiveShift(supabase, userId);
      if (!shift || !shift.clockedInAt) return res.status(200).json({ ok: false, error: 'Not clocked in' });
      if (shift.status !== 'on_break') return res.status(200).json({ ok: false, error: 'Not on break' });
      if (Array.isArray(shift.breaks) && shift.breaks.length) {
        var last = shift.breaks[shift.breaks.length - 1];
        if (!last.end) last.end = nowIso();
      }
      shift.status = 'working';
      await upsertActiveShift(supabase, userId, shift);
      await insertEntry(supabase, { userId: userId, type: 'break_end', ts: nowIso(), ip: ip, note: note, name: name, email: email });
      return res.status(200).json({ ok: true, active: shift });
    }

    if (action === 'status') {
      if (!userId) return res.status(400).json({ error: 'userId required' });
      var shift = await getActiveShift(supabase, userId);
      var entries = await getEntries(supabase, userId);
      return res.status(200).json({ ok: true, configured: true, active: shift || null, log: entries });
    }

    if (action === 'history') {
      if (!userId) return res.status(400).json({ error: 'userId required' });
      var entries = await getEntries(supabase, userId);
      return res.status(200).json({ ok: true, configured: true, log: entries });
    }

    if (action === 'admin_list') {
      if (body.secret !== scraperSecret) return res.status(401).json({ error: 'Wrong password' });
      var { data: activeRows } = await supabase.from('timeclock_active_shifts').select('*');
      var actives = (activeRows || []).map(function (row) {
        var s = shiftFromRow(row);
        s._workedMs = calcWorkedMs(s);
        return s;
      });
      var { data: entryRows } = await supabase
        .from('timeclock_entries')
        .select('*')
        .gte('ts', cutoff90d())
        .order('ts', { ascending: true });
      var allLogs = {};
      (entryRows || []).forEach(function (row) {
        var uid = row.user_id;
        if (!allLogs[uid]) allLogs[uid] = [];
        allLogs[uid].push(entryFromRow(row));
      });
      return res.status(200).json({ ok: true, configured: true, actives: actives, logs: allLogs });
    }

    if (action === 'admin_adjust') {
      if (body.secret !== scraperSecret) return res.status(401).json({ error: 'Wrong password' });
      var targetUserId = String(body.targetUserId || '').trim();
      if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
      var entry = body.entry;
      if (!entry || !entry.type || !entry.ts) return res.status(400).json({ error: 'entry with type and ts required' });
      await insertEntry(supabase, {
        userId: targetUserId,
        type: entry.type,
        ts: entry.ts,
        ip: entry.ip || null,
        note: entry.note || null,
        name: entry.name || null,
        email: entry.email || null,
        shiftStart: entry.shiftStart || null,
        breaks: entry.breaks || null,
        workedMs: entry.workedMs || null,
        adjustedBy: 'admin',
        adjustedAt: nowIso(),
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'server error' });
  }
};
