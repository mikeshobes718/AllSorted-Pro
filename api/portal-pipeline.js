const { getSupabaseAdmin } = require('../lib/supabase-server');

const BATCH_SIZE = 500;

async function loadQueueLeadsFromTable(supabase) {
  let all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('portal_queue_leads')
      .select('data')
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) return [];
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all.map((r) => r.data).filter(Boolean);
}

async function paginatedSelect(supabase, table, orderCol, maxRows) {
  let all = [];
  let from = 0;
  const PAGE = 1000;
  while (all.length < maxRows) {
    const end = Math.min(from + PAGE - 1, from + (maxRows - all.length) - 1);
    const { data, error } = await supabase
      .from(table)
      .select('data')
      .order(orderCol, { ascending: false })
      .range(from, end);
    if (error || !data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all.map((r) => r.data).filter(Boolean);
}

async function loadCallLogs(supabase) {
  return paginatedSelect(supabase, 'call_logs', 'timestamp', 50000);
}

async function loadAppointments(supabase) {
  return paginatedSelect(supabase, 'appointments', 'updated_at', 8000);
}

async function loadLeadRemovalRequests(supabase) {
  return paginatedSelect(supabase, 'lead_removal_requests', 'updated_at', 4000);
}

async function loadLeadDb(supabase) {
  return paginatedSelect(supabase, 'lead_db', 'updated_at', 100000);
}

async function upsertBatched(supabase, table, rows) {
  if (!rows.length) return null;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: 'id' });
    if (error) return error;
  }
  return null;
}

function buildCallLogRows(arr) {
  if (!Array.isArray(arr)) return [];
  const now = new Date().toISOString();
  return arr.filter((o) => o && o.id).map((o) => ({
    id: String(o.id),
    employee_id: o.employee_id || o.employeeId || null,
    company: o.company || null,
    phone: o.phone || null,
    outcome: o.outcome || null,
    notes: o.notes || null,
    callback_date: o.callback_date || o.callbackDate || null,
    timestamp: o.timestamp || now,
    updated_at: now,
    data: o,
  }));
}

function buildAppointmentRows(arr) {
  if (!Array.isArray(arr)) return [];
  const now = new Date().toISOString();
  return arr.filter((o) => o && o.id).map((o) => ({
    id: String(o.id),
    employee_id: o.employee_id || o.employeeId || null,
    company: o.company || null,
    contact_name: o.contact_name || o.contactName || null,
    phone: o.phone || null,
    email: o.email || null,
    status: o.status || null,
    notes: o.notes || null,
    appointment_date: o.appointment_date || o.appointmentDate || null,
    created_at: o.created_at || o.createdAt || now,
    updated_at: now,
    data: o,
  }));
}

function buildLeadRemovalRows(arr) {
  if (!Array.isArray(arr)) return [];
  const now = new Date().toISOString();
  return arr.filter((o) => o && o.id).map((o) => ({
    id: String(o.id),
    lead_id: o.lead_id || o.leadId || null,
    employee_id: o.employee_id || o.employeeId || null,
    reason: o.reason || null,
    status: o.status || null,
    created_at: o.created_at || o.createdAt || now,
    updated_at: now,
    data: o,
  }));
}

function buildLeadDbRows(arr) {
  if (!Array.isArray(arr)) return [];
  const now = new Date().toISOString();
  return arr.filter((o) => o && o.id).map((o) => ({
    id: String(o.id),
    data: o,
    updated_at: now,
  }));
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

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(200).json({ ok: true, configured: false, payload: null });
  }

  const action = body.action || 'get';

  if (action === 'get' || action === 'get_light') {
    const [leads, callLog, appointments, leadRemovalRequests, leadDb] =
      await Promise.all([
        loadQueueLeadsFromTable(supabase),
        loadCallLogs(supabase),
        loadAppointments(supabase),
        loadLeadRemovalRequests(supabase),
        action === 'get_light' ? Promise.resolve(undefined) : loadLeadDb(supabase),
      ]);

    const payload = { leads, callLog, appointments, leadRemovalRequests };
    if (action !== 'get_light') {
      payload.leadDb = leadDb;
    }

    return res.status(200).json({ ok: true, configured: true, payload });
  }

  if (action === 'set') {
    const rawIn = body.payload && typeof body.payload === 'object' ? body.payload : {};

    const callLogRows = buildCallLogRows(rawIn.callLog);
    const appointmentRows = buildAppointmentRows(rawIn.appointments);
    const removalRows = buildLeadRemovalRows(rawIn.leadRemovalRequests);
    const leadDbRows = buildLeadDbRows(rawIn.leadDb);

    const errors = await Promise.all([
      upsertBatched(supabase, 'call_logs', callLogRows),
      upsertBatched(supabase, 'appointments', appointmentRows),
      upsertBatched(supabase, 'lead_removal_requests', removalRows),
      upsertBatched(supabase, 'lead_db', leadDbRows),
    ]);

    const firstError = errors.find(Boolean);
    if (firstError) {
      return res.status(500).json({ ok: false, error: firstError.message });
    }

    return res.status(200).json({ ok: true, configured: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
};
