'use strict';
const { getDb } = require('../lib/db');

const BLOCKED_CALL_LOG_IDS = new Set([
  '1775590100441','1775513366302','1775509737687',
  '1775497484981','1775493860660','1775493655547',
]);
const BLOCKED_APPOINTMENT_IDS = new Set(['1775509758542']);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parseBody(req) {
  let b = req.body;
  if (typeof b === 'string') try { b = JSON.parse(b); } catch { return null; }
  if (!b || typeof b !== 'object') return null;
  return b;
}

async function loadCallLogs(sql) {
  const rows = await sql`SELECT data FROM call_logs ORDER BY timestamp DESC LIMIT 50000`;
  return rows.map(r => r.data).filter(Boolean)
    .filter(o => o && !BLOCKED_CALL_LOG_IDS.has(String(o.id)));
}

async function loadAppointments(sql) {
  const rows = await sql`SELECT data FROM appointments ORDER BY updated_at DESC LIMIT 8000`;
  return rows.map(r => r.data).filter(Boolean)
    .filter(o => o && !BLOCKED_APPOINTMENT_IDS.has(String(o.id)));
}

async function loadLeadRemovalRequests(sql) {
  const rows = await sql`SELECT data FROM lead_removal_requests ORDER BY updated_at DESC LIMIT 4000`;
  return rows.map(r => r.data).filter(Boolean);
}

async function loadLeadDb(sql) {
  const rows = await sql`SELECT data FROM lead_db ORDER BY updated_at DESC LIMIT 200000`;
  return rows.map(r => r.data).filter(Boolean);
}

async function upsertCallLogs(sql, arr) {
  if (!Array.isArray(arr) || !arr.length) return;
  const now = new Date().toISOString();
  const valid = arr.filter(o => o && o.id && !BLOCKED_CALL_LOG_IDS.has(String(o.id))
    && String(o.employee_id || o.employeeId || '') !== '399');
  for (let i = 0; i < valid.length; i += 500) {
    const chunk = valid.slice(i, i + 500);
    for (const o of chunk) {
      await sql`
        INSERT INTO call_logs (id, employee_id, company, phone, outcome, notes, callback_date, timestamp, updated_at, data)
        VALUES (${String(o.id)}, ${o.employee_id||o.employeeId||null}, ${o.company||null}, ${o.phone||null},
          ${o.outcome||null}, ${o.notes||null}, ${o.callback_date||o.callbackDate||null},
          ${o.timestamp||now}, ${now}, ${JSON.stringify(o)})
        ON CONFLICT (id) DO UPDATE SET
          employee_id = EXCLUDED.employee_id, company = EXCLUDED.company, phone = EXCLUDED.phone,
          outcome = EXCLUDED.outcome, notes = EXCLUDED.notes, callback_date = EXCLUDED.callback_date,
          timestamp = EXCLUDED.timestamp, updated_at = EXCLUDED.updated_at, data = EXCLUDED.data
      `;
    }
  }
  await sql`DELETE FROM call_logs WHERE employee_id = '399'`;
  await sql`DELETE FROM call_logs WHERE id = ANY(${Array.from(BLOCKED_CALL_LOG_IDS)})`;
}

async function upsertAppointments(sql, arr) {
  if (!Array.isArray(arr) || !arr.length) return;
  const now = new Date().toISOString();
  const valid = arr.filter(o => o && o.id && !BLOCKED_APPOINTMENT_IDS.has(String(o.id))
    && String(o.employee_id || o.employeeId || '') !== '399');
  for (const o of valid) {
    await sql`
      INSERT INTO appointments (id, employee_id, company, contact_name, phone, email, status, notes, appointment_date, created_at, updated_at, data)
      VALUES (${String(o.id)}, ${o.employee_id||o.employeeId||null}, ${o.company||null},
        ${o.contact_name||o.contactName||null}, ${o.phone||null}, ${o.email||null},
        ${o.status||null}, ${o.notes||null}, ${o.appointment_date||o.appointmentDate||null},
        ${o.created_at||o.createdAt||now}, ${now}, ${JSON.stringify(o)})
      ON CONFLICT (id) DO UPDATE SET
        employee_id = EXCLUDED.employee_id, company = EXCLUDED.company, contact_name = EXCLUDED.contact_name,
        phone = EXCLUDED.phone, email = EXCLUDED.email, status = EXCLUDED.status, notes = EXCLUDED.notes,
        appointment_date = EXCLUDED.appointment_date, updated_at = EXCLUDED.updated_at, data = EXCLUDED.data
    `;
  }
  await sql`DELETE FROM appointments WHERE employee_id = '399'`;
  await sql`DELETE FROM appointments WHERE id = ANY(${Array.from(BLOCKED_APPOINTMENT_IDS)})`;
}

async function upsertLeadRemovalRequests(sql, arr) {
  if (!Array.isArray(arr) || !arr.length) return;
  const now = new Date().toISOString();
  const valid = arr.filter(o => o && o.id);
  for (const o of valid) {
    await sql`
      INSERT INTO lead_removal_requests (id, lead_id, employee_id, reason, status, created_at, updated_at, data)
      VALUES (${String(o.id)}, ${o.lead_id||o.leadId||null}, ${o.employee_id||o.employeeId||null},
        ${o.reason||null}, ${o.status||null}, ${o.created_at||o.createdAt||now}, ${now}, ${JSON.stringify(o)})
      ON CONFLICT (id) DO UPDATE SET
        lead_id = EXCLUDED.lead_id, employee_id = EXCLUDED.employee_id, reason = EXCLUDED.reason,
        status = EXCLUDED.status, updated_at = EXCLUDED.updated_at, data = EXCLUDED.data
    `;
  }
}

async function upsertLeadDb(sql, arr) {
  if (!Array.isArray(arr) || !arr.length) return;
  const now = new Date().toISOString();
  const valid = arr.filter(o => o && o.id);
  for (let i = 0; i < valid.length; i += 500) {
    const chunk = valid.slice(i, i + 500);
    for (const o of chunk) {
      await sql`
        INSERT INTO lead_db (id, data, category, state, city, pushed, updated_at)
        VALUES (${String(o.id)}, ${JSON.stringify(o)}, ${o.category||null}, ${o.state||null},
          ${o.city||null}, ${!!o.pushed}, ${now})
        ON CONFLICT (id) DO UPDATE SET
          data = EXCLUDED.data, category = EXCLUDED.category, state = EXCLUDED.state,
          city = EXCLUDED.city, pushed = EXCLUDED.pushed, updated_at = EXCLUDED.updated_at
      `;
    }
  }
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = parseBody(req);
  if (!body) return res.status(400).json({ error: 'Invalid body' });

  const scraperSecret = process.env.SCRAPER_SECRET || 'Free2026';
  if (body.secret !== scraperSecret) return res.status(401).json({ error: 'Wrong password' });

  const sql = getDb();
  if (!sql) return res.status(200).json({ ok: true, configured: false, payload: null });

  const action = body.action || 'get';

  try {
    if (action === 'get' || action === 'get_light') {
      const [callLog, appointments, leadRemovalRequests, leadDb] = await Promise.all([
        loadCallLogs(sql),
        loadAppointments(sql),
        loadLeadRemovalRequests(sql),
        action === 'get_light' ? Promise.resolve(undefined) : loadLeadDb(sql),
      ]);
      const payload = { leads: [], callLog, appointments, leadRemovalRequests };
      if (action !== 'get_light') payload.leadDb = leadDb;
      return res.status(200).json({ ok: true, configured: true, payload });
    }

    if (action === 'set') {
      const raw = body.payload && typeof body.payload === 'object' ? body.payload : {};
      await Promise.all([
        upsertCallLogs(sql, raw.callLog),
        upsertAppointments(sql, raw.appointments),
        upsertLeadRemovalRequests(sql, raw.leadRemovalRequests),
        upsertLeadDb(sql, raw.leadDb),
      ]);
      return res.status(200).json({ ok: true, configured: true });
    }

    if (action === 'wipe_leads_data') {
      await sql`DELETE FROM portal_queue_leads`;
      await sql`DELETE FROM lead_db`;
      return res.status(200).json({ ok: true, configured: true, wiped: { portal_queue_leads: true, lead_db: true } });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'server error' });
  }
};
