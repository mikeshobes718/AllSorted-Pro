const Busboy = require('busboy');
const { getDb } = require('../lib/db');

const ZOHO_AUTH_URL = 'https://accounts.zoho.com/oauth/v2/auth';
const ZOHO_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token';
const ZOHO_MAIL_BASE = 'https://mail.zoho.com';
const SCOPES = 'ZohoMail.messages.READ,ZohoMail.messages.CREATE,ZohoMail.accounts.READ,ZohoMail.folders.READ';
const CONTENT_KEY = 'zoho_mail_tokens';

function env(k) { return process.env[k] || ''; }

async function loadTokens(sql) {
  const rows = await sql`SELECT value FROM portal_content WHERE key = ${CONTENT_KEY} LIMIT 1`;
  return rows.length && rows[0].value ? rows[0].value : null;
}

async function saveTokens(sql, tokens) {
  await sql`
    INSERT INTO portal_content (key, value, updated_at) VALUES (${CONTENT_KEY}, ${JSON.stringify(tokens)}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `;
}

async function refreshAccessToken(sql, tokens) {
  const res = await fetch(ZOHO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env('ZOHO_CLIENT_ID'),
      client_secret: env('ZOHO_CLIENT_SECRET'),
      refresh_token: tokens.refreshToken,
    }),
  });
  const d = await res.json();
  if (d.access_token) {
    tokens.accessToken = d.access_token;
    tokens.expiresAt = Date.now() + ((d.expires_in || 3600) * 1000);
    await saveTokens(sql, tokens);
  }
  return tokens;
}

async function getValidTokens(sql) {
  let tokens = await loadTokens(sql);
  if (!tokens || !tokens.refreshToken) return null;
  if (!tokens.expiresAt || Date.now() > tokens.expiresAt - 60000) {
    tokens = await refreshAccessToken(sql, tokens);
  }
  return tokens;
}

async function zohoFetch(tokens, method, path, body) {
  const url = ZOHO_MAIL_BASE + path;
  const opts = {
    method,
    headers: {
      Authorization: 'Zoho-oauthtoken ' + tokens.accessToken,
    },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  return r.json();
}

const MAIL_ATTACH_MAX_FILES = 8;
const MAIL_ATTACH_MAX_SINGLE = 4 * 1024 * 1024;
const MAIL_ATTACH_MAX_TOTAL = 4 * 1024 * 1024;

function parseMultipartMail(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const fileTasks = [];
    const bb = Busboy({
      headers: req.headers,
      limits: {
        files: MAIL_ATTACH_MAX_FILES,
        fileSize: MAIL_ATTACH_MAX_SINGLE,
        parts: 40,
      },
    });
    bb.on('field', (name, val) => {
      fields[name] = val;
    });
    bb.on('file', (fieldname, file, info) => {
      if (fieldname !== 'mail_attach') {
        file.resume();
        return;
      }
      fileTasks.push(
        new Promise((res, rej) => {
          const chunks = [];
          const filename = (info && info.filename) || 'file';
          file.on('data', (d) => {
            chunks.push(d);
          });
          file.on('limit', () => {
            rej(new Error('Each file must be ' + Math.floor(MAIL_ATTACH_MAX_SINGLE / (1024 * 1024)) + ' MB or smaller'));
          });
          file.on('error', rej);
          file.on('end', () => {
            res({ name: filename, buffer: Buffer.concat(chunks) });
          });
        }),
      );
    });
    bb.on('finish', async () => {
      try {
        const files = await Promise.all(fileTasks);
        resolve({ fields, files: files.filter((f) => f.buffer && f.buffer.length) });
      } catch (e) {
        reject(e);
      }
    });
    bb.on('error', reject);
    req.pipe(bb);
  });
}

async function zohoUploadAttachmentRaw(tokens, accountId, fileName, buffer) {
  const q = '?fileName=' + encodeURIComponent(fileName) + '&isInline=false';
  const path = '/api/accounts/' + accountId + '/messages/attachments' + q;
  const url = ZOHO_MAIL_BASE + path;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Zoho-oauthtoken ' + tokens.accessToken,
      'Content-Type': 'application/octet-stream',
    },
    body: buffer,
  });
  return r.json();
}

function safeAttachmentFileName(name) {
  const base = String(name || 'file').split(/[/\\]/).pop() || 'file';
  return base.replace(/[^\w.\- ()\[\]]+/g, '_').slice(0, 180) || 'file';
}

async function uploadBuffersToZoho(tokens, accountId, parts) {
  if (!parts || !parts.length) return [];
  const list = parts.slice(0, MAIL_ATTACH_MAX_FILES);
  const out = [];
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    const item = list[i] || {};
    const name = safeAttachmentFileName(item.name || item.fileName || 'file');
    const buf = item.buffer;
    if (!buf || !buf.length) continue;
    if (buf.length > MAIL_ATTACH_MAX_SINGLE) {
      throw new Error('Attachment too large (max ' + Math.floor(MAIL_ATTACH_MAX_SINGLE / (1024 * 1024)) + ' MB each): ' + name);
    }
    total += buf.length;
    if (total > MAIL_ATTACH_MAX_TOTAL) {
      throw new Error('Total attachments exceed ' + Math.floor(MAIL_ATTACH_MAX_TOTAL / (1024 * 1024)) + ' MB (Vercel request limit)');
    }
    const data = await zohoUploadAttachmentRaw(tokens, accountId, name, buf);
    const ok = data && data.status && data.status.code === 200;
    const d = data && data.data;
    if (!ok || !d) {
      const msg = (data && data.status && data.status.description) || data.errorCode || 'Upload failed';
      throw new Error(String(msg));
    }
    const meta = Array.isArray(d) ? d[0] : d;
    if (!meta.storeName || !meta.attachmentName || !meta.attachmentPath) {
      throw new Error('Unexpected upload response');
    }
    out.push({
      storeName: meta.storeName,
      attachmentName: meta.attachmentName,
      attachmentPath: meta.attachmentPath,
    });
  }
  return out;
}

async function uploadAttachmentsForZoho(tokens, accountId, rawList) {
  if (!rawList || !Array.isArray(rawList) || rawList.length === 0) return [];
  const parts = [];
  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i] || {};
    const b64 = item.contentBase64 || item.base64 || '';
    const name = item.name || item.fileName || 'file';
    if (!b64) continue;
    let buf;
    try {
      buf = Buffer.from(String(b64).replace(/\s/g, ''), 'base64');
    } catch {
      throw new Error('Invalid attachment encoding: ' + safeAttachmentFileName(name));
    }
    if (buf.length) parts.push({ name, buffer: buf });
  }
  return uploadBuffersToZoho(tokens, accountId, parts);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const sql = getDb();
  if (!sql) return res.status(500).json({ ok: false, error: 'Database not configured' });

  let body = {};
  let mailMultipartBuffers = [];
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (req.method === 'POST' && ct.includes('multipart/form-data')) {
    try {
      const parsed = await parseMultipartMail(req);
      body = parsed.fields || {};
      mailMultipartBuffers = parsed.files || [];
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message || 'Invalid multipart body' });
    }
  } else {
    body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    if (!body || typeof body !== 'object') body = {};
  }

  const q = req.query || {};
  const action = q.action || body.action || '';

  // --- OAuth: redirect admin to Zoho consent ---
  if (action === 'connect') {
    const clientId = env('ZOHO_CLIENT_ID');
    const redirectUri = env('ZOHO_REDIRECT_URI');
    if (!clientId || !redirectUri) {
      return res.status(500).json({ ok: false, error: 'ZOHO_CLIENT_ID or ZOHO_REDIRECT_URI not set' });
    }
    const url =
      ZOHO_AUTH_URL +
      '?scope=' + encodeURIComponent(SCOPES) +
      '&client_id=' + encodeURIComponent(clientId) +
      '&response_type=code' +
      '&access_type=offline' +
      '&redirect_uri=' + encodeURIComponent(redirectUri) +
      '&prompt=consent';
    return res.redirect(302, url);
  }

  // --- All other actions require auth ---
  const scraperSecret = process.env.SCRAPER_SECRET || 'Free2026';
  if (body.secret !== scraperSecret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const act = body.action || '';

  // --- Status check ---
  if (act === 'status') {
    const tokens = await loadTokens(sql);
    const connected = !!(tokens && tokens.refreshToken && tokens.accountId);
    return res.status(200).json({
      ok: true,
      connected,
      fromAddress: connected ? tokens.fromAddress : '',
    });
  }

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const MAIL_BODY_HTML_MAX = 400000;
  function sanitizeStoredMailHtml(html) {
    let s = String(html || '').slice(0, MAIL_BODY_HTML_MAX);
    s = s.replace(/<\/script/gi, '');
    s = s.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    s = s.replace(/\s(on\w+|javascript:)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return s;
  }

  // --- Sent: dashboard mail log only (no Zoho tokens required) ---
  if (act === 'sent') {
    const start = parseInt(body.start, 10) || 0;
    const limit = Math.min(parseInt(body.limit, 10) || 25, 50);
    const from = start;
    const to = start + limit - 1;
    const countRows = await sql`SELECT COUNT(*)::int AS cnt FROM mail_sent_log`;
    const total = (countRows[0] || {}).cnt || 0;
    const list = await sql`SELECT * FROM mail_sent_log ORDER BY sent_at DESC LIMIT ${limit} OFFSET ${from}`;

    const messages = list.map((r) => {
      const t = r.sent_at ? new Date(r.sent_at).getTime() : Date.now();
      return {
        messageId: r.id,
        folderId: 'dashboard',
        subject: r.subject || '(no subject)',
        toAddress: r.to_address || '',
        receivedTime: String(t),
        summary: '',
        sender: r.employee_name ? ('Sent by ' + r.employee_name) : '',
      };
    });
    const sentLog = {};
    list.forEach((r) => {
      sentLog[r.id] = { employee_id: r.employee_id, employee_name: r.employee_name || '' };
    });
    const hasMore = start + list.length < total;
    return res.status(200).json({
      ok: true,
      messages,
      sentLog,
      fromAddress: '',
      hasMore,
      total,
      source: 'dashboard',
    });
  }

  // --- Read: row from dashboard send log (no Zoho) ---
  if (act === 'read' && body.folderId === 'dashboard' && body.messageId) {
    const rows = await sql`SELECT * FROM mail_sent_log WHERE id = ${body.messageId} LIMIT 1`;
    const row = rows[0] || null;
    if (!row) {
      return res.status(200).json({ ok: false, error: 'Message not found' });
    }
    const when = row.sent_at ? new Date(row.sent_at).toLocaleString() : '';
    const bodyStored = row.body_html ? sanitizeStoredMailHtml(row.body_html) : '';
    const bodyBlock = bodyStored
      ? '<div style="margin-top:1rem;padding-top:1rem;border-top:1px solid #e2e8f0;"><p style="margin:0 0 0.5rem;font-weight:600;">Message</p><div class="mail-stored-body" style="word-break:break-word;">' +
        bodyStored +
        '</div></div>'
      : '<p style="color:#64748b;font-size:0.9em;margin-top:0.75rem;">No message body was saved for this send (older log entry).</p>';
    const inner =
      '<p><strong>Sent from team dashboard</strong></p>' +
      '<p><strong>To:</strong> ' + escHtml(row.to_address) + '</p>' +
      (row.cc_address ? '<p><strong>Cc:</strong> ' + escHtml(row.cc_address) + '</p>' : '') +
      '<p><strong>Subject:</strong> ' + escHtml(row.subject) + '</p>' +
      '<p><strong>Sent:</strong> ' + escHtml(when) + '</p>' +
      (row.employee_name ? '<p><strong>Sent by:</strong> ' + escHtml(row.employee_name) + '</p>' : '') +
      bodyBlock;
    const html = '<div style="font-family:-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Roboto,sans-serif;font-size:14px;line-height:1.6;">' + inner + '</div>';
    return res.status(200).json({
      ok: true,
      message: { htmlContent: html, content: html, summary: '' },
    });
  }

  // --- All mail actions need valid tokens ---
  const tokens = await getValidTokens(sql);
  if (!tokens || !tokens.accountId) {
    return res.status(200).json({ ok: false, error: 'Zoho Mail not connected. Admin must connect first.' });
  }

  const acctId = tokens.accountId;
  const inboxFolder = tokens.inboxFolderId || '';

  // --- Inbox ---
  if (act === 'inbox') {
    const start = parseInt(body.start, 10) || 0;
    const limit = Math.min(parseInt(body.limit, 10) || 25, 50);
    const path = '/api/accounts/' + acctId + '/messages/view?folderId=' + inboxFolder +
      '&start=' + start + '&limit=' + limit;
    const data = await zohoFetch(tokens, 'GET', path);
    if (data && data.errorCode) {
      return res.status(200).json({ ok: false, error: data.errorCode + ': ' + (data.moreInfo || '') });
    }
    const messages = (data && Array.isArray(data.data)) ? data.data : [];
    return res.status(200).json({ ok: true, messages, fromAddress: tokens.fromAddress });
  }

  // --- Read single message ---
  if (act === 'read') {
    const messageId = body.messageId;
    const folderId = body.folderId || inboxFolder;
    if (!messageId) return res.status(400).json({ ok: false, error: 'messageId required' });
    const path = '/api/accounts/' + acctId + '/folders/' + folderId + '/messages/' + messageId + '/content';
    const data = await zohoFetch(tokens, 'GET', path);
    return res.status(200).json({ ok: true, message: (data && data.data) || data });
  }

  // --- Send new email ---
  if (act === 'send') {
    const { toAddress, ccAddress, subject, content, employeeId, employeeName, portalUserId, attachments: attIn } = body;
    if (!toAddress || !subject) {
      return res.status(400).json({ ok: false, error: 'toAddress and subject required' });
    }
    let zohoAttachments = [];
    if (mailMultipartBuffers && mailMultipartBuffers.length) {
      try {
        zohoAttachments = await uploadBuffersToZoho(tokens, acctId, mailMultipartBuffers);
      } catch (e) {
        return res.status(200).json({ ok: false, error: e.message || 'Attachment upload failed' });
      }
    } else if (attIn && Array.isArray(attIn) && attIn.length) {
      try {
        zohoAttachments = await uploadAttachmentsForZoho(tokens, acctId, attIn);
      } catch (e) {
        return res.status(200).json({ ok: false, error: e.message || 'Attachment upload failed' });
      }
    }
    const payload = {
      fromAddress: tokens.fromAddress,
      toAddress,
      ccAddress: ccAddress || '',
      subject,
      content: content || '',
      askReceipt: 'no',
    };
    if (zohoAttachments.length) {
      payload.attachments = zohoAttachments;
    }
    const path = '/api/accounts/' + acctId + '/messages';
    const data = await zohoFetch(tokens, 'POST', path, payload);
    const ok = data && data.status && data.status.code === 200;
    const rosterId = employeeId ? String(employeeId).trim() : '';
    const portalId = portalUserId ? String(portalUserId).trim() : '';
    if (ok && (rosterId || portalId)) {
      const zohoMsgId = (data.data && data.data.messageId) || '';
      const rowKey = rosterId || portalId;
      const logId = zohoMsgId || (Date.now() + '-' + rowKey);
      sql`
        INSERT INTO mail_sent_log (id, zoho_message_id, employee_id, employee_name, to_address, cc_address, subject, body_html, sent_at)
        VALUES (${logId}, ${zohoMsgId||null}, ${rosterId||null}, ${employeeName||''}, ${toAddress}, ${ccAddress||''}, ${subject}, ${sanitizeStoredMailHtml(payload.content||'')}, NOW())
        ON CONFLICT (id) DO UPDATE SET employee_id = EXCLUDED.employee_id, subject = EXCLUDED.subject, sent_at = EXCLUDED.sent_at
      `.catch(() => {});
    }
    return res.status(200).json({ ok, data });
  }

  // --- Reply ---
  if (act === 'reply') {
    const { messageId, content, toAddress, ccAddress, subject, employeeId, employeeName, portalUserId, attachments: attIn } = body;
    if (!messageId || !content) {
      return res.status(400).json({ ok: false, error: 'messageId and content required' });
    }
    const folderId = body.folderId || inboxFolder;
    let zohoAttachments = [];
    if (mailMultipartBuffers && mailMultipartBuffers.length) {
      try {
        zohoAttachments = await uploadBuffersToZoho(tokens, acctId, mailMultipartBuffers);
      } catch (e) {
        return res.status(200).json({ ok: false, error: e.message || 'Attachment upload failed' });
      }
    } else if (attIn && Array.isArray(attIn) && attIn.length) {
      try {
        zohoAttachments = await uploadAttachmentsForZoho(tokens, acctId, attIn);
      } catch (e) {
        return res.status(200).json({ ok: false, error: e.message || 'Attachment upload failed' });
      }
    }
    const payload = {
      fromAddress: tokens.fromAddress,
      toAddress: toAddress || '',
      ccAddress: ccAddress || '',
      subject: subject || '',
      content,
      askReceipt: 'no',
    };
    if (zohoAttachments.length) {
      payload.attachments = zohoAttachments;
    }
    const path = '/api/accounts/' + acctId + '/messages/' + messageId;
    const data = await zohoFetch(tokens, 'PUT', path, payload);
    const ok = data && data.status && data.status.code === 200;
    const rosterId = employeeId ? String(employeeId).trim() : '';
    const portalId = portalUserId ? String(portalUserId).trim() : '';
    if (ok && (rosterId || portalId)) {
      const zohoMsgId = (data.data && data.data.messageId) || messageId;
      const rowKey = rosterId || portalId;
      const logId = zohoMsgId || (Date.now() + '-' + rowKey);
      sql`
        INSERT INTO mail_sent_log (id, zoho_message_id, employee_id, employee_name, to_address, cc_address, subject, body_html, sent_at)
        VALUES (${logId}, ${zohoMsgId||null}, ${rosterId||null}, ${employeeName||''}, ${toAddress||''}, ${ccAddress||''}, ${subject||''}, ${sanitizeStoredMailHtml(content||'')}, NOW())
        ON CONFLICT (id) DO UPDATE SET employee_id = EXCLUDED.employee_id, subject = EXCLUDED.subject, sent_at = EXCLUDED.sent_at
      `.catch(() => {});
    }
    return res.status(200).json({ ok, data });
  }

  // --- Search ---
  if (act === 'search') {
    let searchStr = (body.searchKey || '').trim();
    if (!searchStr) return res.status(400).json({ ok: false, error: 'searchKey required' });
    if (!/^(subject|from|to|cc|bcc|entire|content|has|in|tag):/.test(searchStr)) {
      searchStr = 'entire:' + searchStr;
    }
    const start = parseInt(body.start, 10) || 0;
    const limit = Math.min(parseInt(body.limit, 10) || 25, 50);
    const path = '/api/accounts/' + acctId + '/messages/search?searchKey=' +
      encodeURIComponent(searchStr) + '&start=' + start + '&limit=' + limit;
    const data = await zohoFetch(tokens, 'GET', path);
    if (data && data.errorCode) {
      return res.status(200).json({ ok: false, error: data.errorCode + ': ' + (data.moreInfo || '') });
    }
    const messages = (data && Array.isArray(data.data)) ? data.data : [];
    return res.status(200).json({ ok: true, messages });
  }

  // --- Disconnect ---
  if (act === 'disconnect') {
    await sql`DELETE FROM portal_content WHERE key = ${CONTENT_KEY}`;
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ ok: false, error: 'Unknown action: ' + act });
};
