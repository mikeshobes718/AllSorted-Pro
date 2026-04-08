const { getSupabaseAdmin } = require('../lib/supabase-server');

const ZOHO_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token';
const ZOHO_MAIL_BASE = 'https://mail.zoho.com';
const CONTENT_KEY = 'zoho_mail_tokens';

function env(k) { return process.env[k] || ''; }

module.exports = async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('Missing authorization code from Zoho. Please try connecting again.');
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).send('Database not configured');

  const redirectUri = env('ZOHO_REDIRECT_URI');

  try {
    const tokenRes = await fetch(ZOHO_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: env('ZOHO_CLIENT_ID'),
        client_secret: env('ZOHO_CLIENT_SECRET'),
        redirect_uri: redirectUri,
        code,
      }),
    });
    const td = await tokenRes.json();
    if (!td.access_token) {
      return res.status(400).json({ ok: false, error: 'Token exchange failed', detail: td });
    }

    const accRes = await fetch(ZOHO_MAIL_BASE + '/api/accounts', {
      headers: { Authorization: 'Zoho-oauthtoken ' + td.access_token },
    });
    const accData = await accRes.json();
    const account = accData && accData.data && accData.data[0];
    const accountId = account ? account.accountId : null;
    const fromAddress = account ? (account.primaryEmailAddress || account.incomingUserName) : '';
    let inboxFolderId = '';

    if (account) {
      const folderRes = await fetch(
        ZOHO_MAIL_BASE + '/api/accounts/' + accountId + '/folders',
        { headers: { Authorization: 'Zoho-oauthtoken ' + td.access_token } }
      );
      const folderData = await folderRes.json();
      if (folderData && folderData.data) {
        const inbox = folderData.data.find(function (f) {
          return (f.folderName || '').toLowerCase() === 'inbox';
        });
        if (inbox) inboxFolderId = inbox.folderId;
      }
    }

    const tokens = {
      accessToken: td.access_token,
      refreshToken: td.refresh_token,
      expiresAt: Date.now() + ((td.expires_in || 3600) * 1000),
      accountId: accountId || '',
      fromAddress: fromAddress || '',
      inboxFolderId: inboxFolderId,
    };
    await supabase.from('portal_content').upsert(
      { key: CONTENT_KEY, value: tokens, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );

    return res.redirect(302, '/caller-dashboard.html#mail-connected');
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'OAuth callback failed: ' + e.message });
  }
};
