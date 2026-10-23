'use strict';
const { getDb } = require('../lib/db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid body' });

  const scraperSecret = process.env.SCRAPER_SECRET || 'Free2026';
  if (body.secret !== scraperSecret) return res.status(401).json({ error: 'Unauthorized' });

  const sql = getDb();
  if (!sql) return res.status(503).json({ ok: false, error: 'Database not configured' });

  const act = body.action || '';

  try {
    if (act === 'setup') {
      await sql`SELECT id FROM team_room_messages LIMIT 1`;
      return res.status(200).json({ ok: true, exists: true });
    }

    if (act === 'list') {
      const limit = Math.min(parseInt(body.limit, 10) || 50, 100);
      let messages;
      if (body.before) {
        messages = await sql`
          SELECT id,employee_id,display_name,message,has_attachment,attachment_name,attachment_type,attachment_size,reply_to,reactions,pinned,deleted,deleted_by,edited,created_at
          FROM team_room_messages WHERE deleted = false AND created_at < ${body.before}
          ORDER BY created_at DESC LIMIT ${limit}
        `;
      } else if (body.since) {
        messages = await sql`
          SELECT id,employee_id,display_name,message,has_attachment,attachment_name,attachment_type,attachment_size,reply_to,reactions,pinned,deleted,deleted_by,edited,created_at
          FROM team_room_messages WHERE deleted = false AND created_at > ${body.since}
          ORDER BY created_at DESC LIMIT ${limit}
        `;
      } else {
        messages = await sql`
          SELECT id,employee_id,display_name,message,has_attachment,attachment_name,attachment_type,attachment_size,reply_to,reactions,pinned,deleted,deleted_by,edited,created_at
          FROM team_room_messages WHERE deleted = false
          ORDER BY created_at DESC LIMIT ${limit}
        `;
      }

      let pinned = [];
      if (!body.since && !body.before) {
        pinned = await sql`
          SELECT id,employee_id,display_name,message,has_attachment,attachment_name,attachment_type,attachment_size,reply_to,reactions,pinned,deleted,deleted_by,edited,created_at
          FROM team_room_messages WHERE pinned = true AND deleted = false
          ORDER BY created_at DESC LIMIT 10
        `;
      }

      return res.status(200).json({ ok: true, messages: [...messages].reverse(), pinned });
    }

    if (act === 'send') {
      const { employeeId, displayName, message, replyTo } = body;
      if (!employeeId) return res.status(400).json({ ok: false, error: 'employeeId required' });
      if (!message && !body.attachmentData) return res.status(400).json({ ok: false, error: 'message or attachment required' });
      const rows = await sql`
        INSERT INTO team_room_messages (employee_id, display_name, message, has_attachment, attachment_name, attachment_type, attachment_size, attachment_data, reply_to, reactions, pinned, deleted, edited)
        VALUES (${String(employeeId).slice(0,120)}, ${String(displayName||'Anonymous').slice(0,50)},
          ${message ? String(message).slice(0,5000) : null}, ${!!body.attachmentData},
          ${body.attachmentName ? String(body.attachmentName).slice(0,255) : null},
          ${body.attachmentType ? String(body.attachmentType).slice(0,100) : null},
          ${parseInt(body.attachmentSize,10)||0},
          ${body.attachmentData ? String(body.attachmentData) : null},
          ${replyTo ? String(replyTo) : null},
          ${JSON.stringify({})}, false, false, false)
        RETURNING id,employee_id,display_name,message,has_attachment,attachment_name,attachment_type,attachment_size,reply_to,reactions,pinned,deleted,deleted_by,edited,created_at
      `;
      return res.status(200).json({ ok: true, message: rows[0] || null });
    }

    if (act === 'delete') {
      if (!body.messageId) return res.status(400).json({ ok: false, error: 'messageId required' });
      await sql`UPDATE team_room_messages SET deleted = true, deleted_by = ${body.adminId||'admin'} WHERE id = ${body.messageId}::uuid`;
      return res.status(200).json({ ok: true });
    }

    if (act === 'react') {
      if (!body.messageId || !body.employeeId || !body.emoji) return res.status(400).json({ ok: false, error: 'messageId, employeeId, and emoji required' });
      const rows = await sql`SELECT reactions FROM team_room_messages WHERE id = ${body.messageId}::uuid LIMIT 1`;
      if (!rows.length) return res.status(404).json({ ok: false, error: 'Message not found' });
      const reactions = rows[0].reactions || {};
      const emoji = String(body.emoji).slice(0, 8);
      const eid = String(body.employeeId);
      if (!reactions[emoji]) reactions[emoji] = [];
      const idx = reactions[emoji].indexOf(eid);
      if (idx >= 0) {
        reactions[emoji].splice(idx, 1);
        if (!reactions[emoji].length) delete reactions[emoji];
      } else {
        reactions[emoji].push(eid);
      }
      await sql`UPDATE team_room_messages SET reactions = ${JSON.stringify(reactions)} WHERE id = ${body.messageId}::uuid`;
      return res.status(200).json({ ok: true, reactions });
    }

    if (act === 'pin') {
      if (!body.messageId) return res.status(400).json({ ok: false, error: 'messageId required' });
      const rows = await sql`SELECT pinned FROM team_room_messages WHERE id = ${body.messageId}::uuid LIMIT 1`;
      if (!rows.length) return res.status(404).json({ ok: false, error: 'Message not found' });
      const newPinned = !rows[0].pinned;
      await sql`UPDATE team_room_messages SET pinned = ${newPinned} WHERE id = ${body.messageId}::uuid`;
      return res.status(200).json({ ok: true, pinned: newPinned });
    }

    if (act === 'edit') {
      if (!body.messageId || !body.employeeId || !body.message) return res.status(400).json({ ok: false, error: 'messageId, employeeId, and message required' });
      const rows = await sql`SELECT employee_id, created_at FROM team_room_messages WHERE id = ${body.messageId}::uuid LIMIT 1`;
      if (!rows.length) return res.status(404).json({ ok: false, error: 'Message not found' });
      if (rows[0].employee_id !== body.employeeId) return res.status(403).json({ ok: false, error: 'Can only edit own messages' });
      const age = Date.now() - new Date(rows[0].created_at).getTime();
      if (age > 5 * 60 * 1000) return res.status(403).json({ ok: false, error: 'Edit window expired (5 min)' });
      await sql`UPDATE team_room_messages SET message = ${String(body.message).slice(0,5000)}, edited = true WHERE id = ${body.messageId}::uuid`;
      return res.status(200).json({ ok: true });
    }

    if (act === 'attachment') {
      if (!body.messageId) return res.status(400).json({ ok: false, error: 'messageId required' });
      const rows = await sql`SELECT attachment_data, attachment_name, attachment_type FROM team_room_messages WHERE id = ${body.messageId}::uuid LIMIT 1`;
      if (!rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
      return res.status(200).json({ ok: true, data: rows[0].attachment_data, name: rows[0].attachment_name, type: rows[0].attachment_type });
    }

    if (act === 'presence') {
      if (!body.employeeId) return res.status(400).json({ ok: false, error: 'employeeId required' });
      const now = new Date().toISOString();
      await sql`
        INSERT INTO team_room_presence (employee_id, display_name, last_seen, typing)
        VALUES (${String(body.employeeId)}, ${String(body.displayName||'Anonymous').slice(0,50)}, ${now}, ${!!body.typing})
        ON CONFLICT (employee_id) DO UPDATE SET display_name = EXCLUDED.display_name, last_seen = EXCLUDED.last_seen, typing = EXCLUDED.typing
      `;
      const cutoff = new Date(Date.now() - 30000).toISOString();
      const online = await sql`SELECT employee_id, display_name, typing, last_seen FROM team_room_presence WHERE last_seen >= ${cutoff}`;
      return res.status(200).json({ ok: true, online });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action: ' + act });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : 'server error' });
  }
};
