const { getSupabaseAdmin } = require('../lib/supabase-server');

function todayStr() { return new Date().toDateString(); }
function isToday(ts) { return ts && new Date(ts).toDateString() === todayStr(); }
function isThisMonth(ts) {
  if (!ts) return false;
  const d = new Date(ts), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  const secret = process.env.SCRAPER_SECRET || 'Free2026';
  if (!body || body.secret !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const empId = String(body.employeeId || '').trim();
  if (!empId) return res.status(400).json({ error: 'employeeId required' });

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.json({ ok: true, configured: false });

  const [callRes, apptRes] = await Promise.all([
    supabase.from('call_logs').select('data').eq('employee_id', empId),
    supabase.from('appointments').select('data').eq('employee_id', empId),
  ]);

  if (callRes.error) return res.status(500).json({ ok: false, error: callRes.error.message });
  if (apptRes.error) return res.status(500).json({ ok: false, error: apptRes.error.message });

  const empCalls = (callRes.data || []).map(r => r.data).filter(Boolean);
  const empAppts = (apptRes.data || []).map(r => r.data).filter(Boolean);

  const convOutcomes = ['callback', 'booked', 'not_interested', 'not-interested'];
  const interestedOutcomes = ['callback', 'booked'];
  const closeStatuses = ['won', 'closed'];
  const showedStatuses = ['showed', 'won', 'closed'];

  let dialsToday = 0, convsToday = 0, interestedToday = 0, closesToday = 0, dialsMonth = 0;
  empCalls.forEach(c => {
    if (isToday(c.timestamp)) {
      dialsToday++;
      if (convOutcomes.includes(c.outcome)) convsToday++;
      if (interestedOutcomes.includes(c.outcome)) interestedToday++;
    }
    if (isThisMonth(c.timestamp)) dialsMonth++;
  });

  let closesMonth = 0, activeClients = 0, bookedMonth = 0, showedMonth = 0;
  empAppts.forEach(a => {
    const ts = a.updatedAt || a.createdAt;
    if (closeStatuses.includes(a.status)) {
      activeClients++;
      if (isThisMonth(ts)) closesMonth++;
      if (isToday(ts)) closesToday++;
    }
    if (showedStatuses.includes(a.status) && isThisMonth(ts)) showedMonth++;
    if ((a.status === 'booked' || a.status === 'scheduled') && isThisMonth(a.createdAt)) bookedMonth++;
  });

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  let ghostDays = 0;
  for (let day = 1; day < now.getDate(); day++) {
    const d = new Date(year, month, day);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const dialsOnDay = empCalls.filter(c => {
      const cd = new Date(c.timestamp);
      return cd.getDate() === day && cd.getMonth() === month && cd.getFullYear() === year;
    }).length;
    if (dialsOnDay === 0) ghostDays++;
  }

  let workdaysPast = 0;
  for (let wd = 1; wd < now.getDate(); wd++) {
    const dw = new Date(year, month, wd);
    if (dw.getDay() !== 0 && dw.getDay() !== 6) workdaysPast++;
  }

  const avgDials = workdaysPast > 0 ? dialsMonth / workdaysPast : dialsToday;
  const basePay = (avgDials >= 80 || dialsToday >= 80) ? 200 : 0;
  const commission = basePay + (closesMonth * 25) + (activeClients * 10);

  return res.json({
    ok: true,
    configured: true,
    stats: {
      dialsToday, convsToday, interestedToday, closesToday,
      dialsMonth, closesMonth, activeClients, bookedMonth, showedMonth,
      ghostDays, basePay, commission,
      totalCalls: empCalls.length,
      totalAppts: empAppts.length,
    },
  });
};
