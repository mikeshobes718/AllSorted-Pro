const { getSupabaseAdmin } = require('../lib/supabase-server');

const ZOHO_AUTH_URL = 'https://accounts.zoho.com/oauth/v2/auth';
const ZOHO_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token';
const ZOHO_MAIL_BASE = 'https://mail.zoho.com';
const SCOPES = 'ZohoMail.messages.READ,ZohoMail.messages.CREATE,ZohoMail.accounts.READ,ZohoMail.folders.READ';
const CONTENT_KEY = 'zoho_mail_tokens';

function env(k) { return process.env[k] || ''; }

async function loadTokens(supabase) {
  const { data } = await supabase
    .from('portal_content')
    .select('value')
    .eq('key', CONTENT_KEY)
    .single();
  return data && data.value ? data.value : null;
}

async function saveTokens(supabase, tokens) {
  await supabase.from('portal_content').upsert(
    { key: CONTENT_KEY, value: tokens, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
}

async function refreshAccessToken(supabase, tokens) {
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
    await saveTokens(supabase, tokens);
  }
  return tokens;
}

async function getValidTokens(supabase) {
  let tokens = await loadTokens(supabase);
  if (!tokens || !tokens.refreshToken) return null;
  if (!tokens.expiresAt || Date.now() > tokens.expiresAt - 60000) {
    tokens = await refreshAccessToken(supabase, tokens);
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ ok: false, error: 'Database not configured' });

  const q = req.query || {};
  const action = q.action || (req.body && req.body.action) || '';

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
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  const scraperSecret = process.env.SCRAPER_SECRET || 'Free2026';
  if (body.secret !== scraperSecret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const act = body.action || '';

  // --- Status check ---
  if (act === 'status') {
    const tokens = await loadTokens(supabase);
    const connected = !!(tokens && tokens.refreshToken && tokens.accountId);
    return res.status(200).json({
      ok: true,
      connected,
      fromAddress: connected ? tokens.fromAddress : '',
    });
  }

  // --- All mail actions need valid tokens ---
  const tokens = await getValidTokens(supabase);
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

  // --- Sent folder ---
  if (act === 'sent') {
    const start = parseInt(body.start, 10) || 0;
    const limit = Math.min(parseInt(body.limit, 10) || 25, 50);

    let messages = [];
    let sentFolderId = tokens.sentFolderId || '';

    if (sentFolderId) {
      const path = '/api/accounts/' + acctId + '/messages/view?folderId=' + sentFolderId +
        '&start=' + start + '&limit=' + limit;
      const data = await zohoFetch(tokens, 'GET', path);
      if (data && !data.errorCode) {
        messages = (data && Array.isArray(data.data)) ? data.data : [];
      }
    }

    if (!sentFolderId || messages.length === 0) {
      try {
        const foldersData = await zohoFetch(tokens, 'GET', '/api/accounts/' + acctId + '/folders');
        const folders = (foldersData && Array.isArray(foldersData.data)) ? foldersData.data : [];
        const sentNames = ['sent', 'sentmail', 'sent mail', 'sent items', 'sentmailbox'];
        const sentFolder = folders.find(f => {
          const name = (f.folderName || '').toLowerCase().trim();
          const type = (f.folderType || '').toLowerCase().trim();
          const mode = (f.mode || '').toLowerCase().trim();
          if (sentNames.includes(name)) return true;
          if (name.startsWith('sent')) return true;
          if (type === 'sent' || type === 'sentmail') return true;
          if (mode === 'sent' || mode === 'sentmail') return true;
          return false;
        });
        if (sentFolder) {
          sentFolderId = sentFolder.folderId;
          tokens.sentFolderId = sentFolderId;
          await saveTokens(supabase, tokens);
          const path = '/api/accounts/' + acctId + '/messages/view?folderId=' + sentFolderId +
            '&start=' + start + '&limit=' + limit;
          const data = await zohoFetch(tokens, 'GET', path);
          if (data && !data.errorCode) {
            messages = (Array.isArray(data.data)) ? data.data : [];
          }
        }
      } catch (e) {}
    }

    if (!sentFolderId && messages.length === 0) {
      const searchPath = '/api/accounts/' + acctId + '/messages/search?searchKey=' +
        encodeURIComponent('in:sentitems') + '&start=' + start + '&limit=' + limit;
      try {
        const data = await zohoFetch(tokens, 'GET', searchPath);
        if (data && Array.isArray(data.data)) messages = data.data;
      } catch (e) {}
    }

    if (!sentFolderId && messages.length === 0) {
      const fromAddr = tokens.fromAddress || '';
      if (fromAddr) {
        const searchPath = '/api/accounts/' + acctId + '/messages/search?searchKey=' +
          encodeURIComponent('from:' + fromAddr) + '&start=' + start + '&limit=' + limit;
        try {
          const data = await zohoFetch(tokens, 'GET', searchPath);
          if (data && Array.isArray(data.data)) messages = data.data;
        } catch (e) {}
      }
    }

    const messageIds = messages.map(m => m.messageId).filter(Boolean);
    let sentLog = {};
    if (messageIds.length) {
      const { data: logRows } = await supabase.from('mail_sent_log').select('zoho_message_id,employee_id,employee_name').in('zoho_message_id', messageIds);
      if (logRows) logRows.forEach(r => { sentLog[r.zoho_message_id] = r; });
    }
    return res.status(200).json({ ok: true, messages, sentLog });
  }

  // --- Send new email ---
  if (act === 'send') {
    const { toAddress, ccAddress, subject, content, employeeId, employeeName } = body;
    if (!toAddress || !subject) {
      return res.status(400).json({ ok: false, error: 'toAddress and subject required' });
    }
    const payload = {
      fromAddress: tokens.fromAddress,
      toAddress,
      ccAddress: ccAddress || '',
      subject,
      content: content || '',
      askReceipt: 'no',
    };
    const path = '/api/accounts/' + acctId + '/messages';
    const data = await zohoFetch(tokens, 'POST', path, payload);
    const ok = data && data.status && data.status.code === 200;
    if (ok && employeeId) {
      const zohoMsgId = (data.data && data.data.messageId) || '';
      await supabase.from('mail_sent_log').upsert({
        id: zohoMsgId || (Date.now() + '-' + employeeId),
        zoho_message_id: zohoMsgId,
        employee_id: employeeId,
        employee_name: employeeName || '',
        to_address: toAddress,
        cc_address: ccAddress || '',
        subject: subject,
        sent_at: new Date().toISOString(),
      }, { onConflict: 'id' }).then(() => {});
    }
    return res.status(200).json({ ok, data });
  }

  // --- Reply ---
  if (act === 'reply') {
    const { messageId, content, toAddress, ccAddress, subject, employeeId, employeeName } = body;
    if (!messageId || !content) {
      return res.status(400).json({ ok: false, error: 'messageId and content required' });
    }
    const folderId = body.folderId || inboxFolder;
    const payload = {
      fromAddress: tokens.fromAddress,
      toAddress: toAddress || '',
      ccAddress: ccAddress || '',
      subject: subject || '',
      content,
      askReceipt: 'no',
    };
    const path = '/api/accounts/' + acctId + '/messages/' + messageId;
    const data = await zohoFetch(tokens, 'PUT', path, payload);
    const ok = data && data.status && data.status.code === 200;
    if (ok && employeeId) {
      const zohoMsgId = (data.data && data.data.messageId) || messageId;
      await supabase.from('mail_sent_log').upsert({
        id: zohoMsgId || (Date.now() + '-' + employeeId),
        zoho_message_id: zohoMsgId,
        employee_id: employeeId,
        employee_name: employeeName || '',
        to_address: toAddress || '',
        cc_address: ccAddress || '',
        subject: subject || '',
        sent_at: new Date().toISOString(),
      }, { onConflict: 'id' }).then(() => {});
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
    await supabase.from('portal_content').delete().eq('key', CONTENT_KEY);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ ok: false, error: 'Unknown action: ' + act });
};
