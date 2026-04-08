(function (global) {
  var USERS_KEY = 'cb_users';
  var SESSION_KEY = 'cb_session';

  /* ── localStorage helpers (cache only — server is source of truth) ── */
  function getUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); } catch (e) { return []; }
  }

  function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g, '');
  }

  function authSecret() {
    try { return localStorage.getItem('cb_scraper_secret') || 'Free2026'; } catch (e) { return 'Free2026'; }
  }

  /* ── Server API call ── */
  function authApi(payload) {
    return fetch('/api/portal-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: 'Network error — check your connection' }; });
  }

  /* ── Employee ID helpers ── */
  function pickNewEmployeeId(existingUsers) {
    var taken = {};
    (existingUsers || []).forEach(function (u) {
      if (!u) return;
      var n = parseInt(String(u.employeeId), 10);
      if (n >= 100 && n <= 999) taken[n] = true;
    });
    var newId, tries = 0;
    do { newId = 100 + Math.floor(Math.random() * 900); tries++; } while (taken[newId] && tries < 500);
    return newId;
  }

  function ensureEmployeeIds() {
    var users = getUsers();
    var taken = {};
    var changed = false;
    users.forEach(function (u) {
      if (!u) return;
      var n = parseInt(String(u.employeeId), 10);
      if (n < 100 || n > 999) return;
      if (taken[n] === undefined) { taken[n] = u.id; }
      else if (taken[n] !== u.id) { u.employeeId = undefined; changed = true; }
    });
    taken = {};
    users.forEach(function (u) { if (!u) return; var n = parseInt(String(u.employeeId), 10); if (n >= 100 && n <= 999) taken[n] = true; });
    users.forEach(function (u) {
      if (!u) return;
      var n = parseInt(String(u.employeeId), 10);
      if (n >= 100 && n <= 999) return;
      u.employeeId = pickNewEmployeeId(users);
      taken[u.employeeId] = true;
      changed = true;
    });
    if (changed) saveUsers(users);
  }

  /* ── Admin / employment helpers ── */
  var PROMOTE_TO_ADMIN_EMAILS = ['hello@allsortedpro.com'];

  function ensurePromotedAdmins() {
    var users = getUsers();
    if (!users.length) return;
    var changed = false;
    PROMOTE_TO_ADMIN_EMAILS.forEach(function (email) {
      var e = normalizeEmail(email);
      var u = users.find(function (x) { return x.email === e; });
      if (u && u.role !== 'admin') { u.role = 'admin'; changed = true; }
    });
    if (changed) saveUsers(users);
  }

  function getAdminNotifyEmails() {
    var seen = {};
    var out = [];
    function add(raw) {
      var e = normalizeEmail(raw);
      if (!e || e.indexOf('@') === -1 || seen[e]) return;
      seen[e] = true;
      out.push(e);
    }
    getUsers().forEach(function (u) { if (u && u.role === 'admin' && u.email) add(u.email); });
    PROMOTE_TO_ADMIN_EMAILS.forEach(add);
    return out;
  }

  function normalizeEmploymentStatus(v) {
    var allowed = ['active', 'inactive', 'training', 'interviewing', 'on_leave'];
    var s = String(v || 'active').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (s === 'onleave' || s === 'leave') s = 'on_leave';
    if (s === 'interview') s = 'interviewing';
    if (allowed.indexOf(s) !== -1) return s;
    return 'active';
  }

  function ensureEmploymentStatuses() {
    var users = getUsers();
    var changed = false;
    users.forEach(function (u) {
      if (!u) return;
      if (u.employmentStatus == null || String(u.employmentStatus).trim() === '') {
        u.employmentStatus = 'active'; changed = true;
      } else {
        var n = normalizeEmploymentStatus(u.employmentStatus);
        if (n !== u.employmentStatus) { u.employmentStatus = n; changed = true; }
      }
    });
    if (changed) saveUsers(users);
  }

  /* ── Seed (backwards compat — only adds default admin to localStorage if empty) ── */
  function seedUsersIfNeeded() {
    ensurePromotedAdmins();
    ensureEmployeeIds();
    ensureEmploymentStatuses();
  }

  /* ── Cache a server user profile into localStorage ── */
  function cacheUserLocally(serverUser, password) {
    var users = getUsers();
    var e = normalizeEmail(serverUser.email);
    var existing = users.find(function (u) { return u.email === e; });
    if (existing) {
      existing.name = serverUser.name || existing.name;
      existing.role = serverUser.role || existing.role;
      existing.employeeId = serverUser.employeeId != null ? serverUser.employeeId : existing.employeeId;
      existing.employmentStatus = serverUser.employmentStatus || existing.employmentStatus;
      if (password) existing.password = password;
      existing.lastLoginAt = new Date().toISOString();
    } else {
      users.push({
        id: serverUser.id || 'u_' + Date.now().toString(36),
        email: e,
        password: password || '',
        name: serverUser.name || '',
        role: serverUser.role || 'caller',
        employeeId: serverUser.employeeId,
        employmentStatus: serverUser.employmentStatus || 'active',
        createdAt: serverUser.createdAt || new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      });
    }
    saveUsers(users);
    ensureEmployeeIds();
    ensurePromotedAdmins();
    var cached = getUsers().find(function (u) { return u.email === e; });
    return cached || null;
  }

  /* ══════════════════════════════════════════════════════
     LOGIN — server is the authority. Always.
     ══════════════════════════════════════════════════════ */
  async function loginUser(email, password) {
    var e = normalizeEmail(email);
    if (!e || !password) return { ok: false, error: 'Email and password are required' };

    var srv = await authApi({ action: 'login', email: e, password: password });

    if (!srv.ok) return { ok: false, error: srv.error || 'Invalid email or password' };

    var cached = cacheUserLocally(srv.user, password);
    if (cached) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: cached.id }));
      try { sessionStorage.setItem('cb_session_started', new Date().toISOString()); } catch (x) {}
    }
    return { ok: true, user: cached || srv.user };
  }

  /* ══════════════════════════════════════════════════════
     REGISTER — server is the authority. Always.
     ══════════════════════════════════════════════════════ */
  async function registerUser(email, password, name) {
    var e = normalizeEmail(email);
    if (!e || !password) return { ok: false, error: 'Email and password are required' };
    var displayName = String(name || '').trim();
    if (!displayName || displayName.split(/\s+/).filter(Boolean).length < 2)
      return { ok: false, error: 'Enter both first and last name' };

    var srv = await authApi({ action: 'register', email: e, password: password, name: displayName });

    if (!srv.ok) return { ok: false, error: srv.error || 'Registration failed' };

    var cached = cacheUserLocally(srv.user, password);
    return { ok: true, user: cached || srv.user };
  }

  /* ══════════════════════════════════════════════════════
     RESET PASSWORD — server is the authority. Always.
     ══════════════════════════════════════════════════════ */
  async function resetPassword(email, newPassword) {
    var e = normalizeEmail(email);
    if (!e || !newPassword) return { ok: false, error: 'Email and new password are required' };
    if (String(newPassword).length < 4) return { ok: false, error: 'Password must be at least 4 characters' };

    var srv = await authApi({ action: 'reset_password', email: e, password: newPassword });

    if (!srv.ok) return { ok: false, error: srv.error || 'Could not reset password' };

    var users = getUsers();
    var u = users.find(function (x) { return x.email === e; });
    if (u) { u.password = newPassword; saveUsers(users); }

    return { ok: true };
  }

  /* ── Session / current user (from localStorage cache) ── */
  function logout() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('cb_profile');
    localStorage.removeItem('cb_display_name');
  }

  function getCurrentUser() {
    var s;
    try { s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
    if (!s || !s.userId) return null;
    return getUsers().find(function (u) { return u.id === s.userId; }) || null;
  }

  /* ── Password helpers ── */
  function getPasswordStrength(password) {
    var p = String(password || '');
    if (!p.length) return { score: 0, label: '', pct: 0 };
    var s = 0;
    if (p.length >= 8) s += 1;
    if (p.length >= 12) s += 1;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s += 1;
    else if (/[a-zA-Z]/.test(p)) s += 0.5;
    if (/\d/.test(p)) s += 1;
    if (/[^a-zA-Z0-9]/.test(p)) s += 1;
    var score = Math.min(4, Math.floor(s));
    if (p.length < 4) score = 0;
    else if (score === 0) score = 1;
    var labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];
    var pct = score === 0 && p.length ? 25 : score * 25;
    return { score: score, label: p.length < 4 ? 'Too short' : labels[score], pct: pct };
  }

  function updateCurrentUserDisplayName(name) {
    var cur = getCurrentUser();
    if (!cur) return { ok: false, error: 'Not signed in' };
    var users = getUsers();
    var u = users.find(function (x) { return x.id === cur.id; });
    if (!u) return { ok: false, error: 'User not found' };
    u.name = String(name || '').trim();
    saveUsers(users);
    authApi({ action: 'update_user', secret: authSecret(), email: u.email, changes: { name: u.name } });
    return { ok: true };
  }

  function changePasswordForCurrentUser(currentPassword, newPassword) {
    if (!newPassword || String(newPassword).length < 4) return { ok: false, error: 'New password must be at least 4 characters' };
    var cur = getCurrentUser();
    if (!cur) return { ok: false, error: 'Not signed in' };
    var users = getUsers();
    var u = users.find(function (x) { return x.id === cur.id; });
    if (!u) return { ok: false, error: 'User not found' };
    if (u.password !== currentPassword) return { ok: false, error: 'Current password is incorrect' };
    u.password = newPassword;
    saveUsers(users);
    authApi({ action: 'change_password', email: u.email, currentPassword: currentPassword, newPassword: newPassword });
    return { ok: true };
  }

  /* ── Admin operations (server + localStorage cache) ── */
  function updateUserRole(userId, newRole) {
    if (newRole !== 'caller' && newRole !== 'admin') return { ok: false, error: 'Invalid role' };
    var cur = getCurrentUser();
    if (!cur || cur.role !== 'admin') return { ok: false, error: 'Admin only' };
    var users = getUsers();
    var admins = users.filter(function (u) { return u.role === 'admin'; });
    if (userId === cur.id && newRole === 'caller' && admins.length === 1) return { ok: false, error: 'There must be at least one admin' };
    var u = users.find(function (x) { return x.id === userId; });
    if (!u) return { ok: false, error: 'User not found' };
    u.role = newRole;
    saveUsers(users);
    authApi({ action: 'update_user', secret: authSecret(), email: u.email, changes: { role: newRole } });
    return { ok: true };
  }

  function updateUserEmploymentStatus(userId, status) {
    var cur = getCurrentUser();
    if (!cur || cur.role !== 'admin') return { ok: false, error: 'Admin only' };
    var norm = normalizeEmploymentStatus(status);
    var users = getUsers();
    var u = users.find(function (x) { return x.id === userId; });
    if (!u) return { ok: false, error: 'User not found' };
    u.employmentStatus = norm;
    saveUsers(users);
    authApi({ action: 'update_user', secret: authSecret(), email: u.email, changes: { employmentStatus: norm } });
    return { ok: true, user: u };
  }

  function deleteUserAsAdmin(userId) {
    var cur = getCurrentUser();
    if (!cur || cur.role !== 'admin') return { ok: false, error: 'Admin only' };
    var users = getUsers();
    var target = users.find(function (x) { return x.id === userId; });
    if (!target) return { ok: false, error: 'User not found' };
    var admins = users.filter(function (u) { return u.role === 'admin'; });
    if (target.role === 'admin' && admins.length <= 1) return { ok: false, error: 'Cannot remove the only admin' };
    saveUsers(users.filter(function (u) { return u.id !== userId; }));
    authApi({ action: 'delete_user', secret: authSecret(), email: target.email });
    var loggedOut = cur.id === userId;
    if (loggedOut) logout();
    return { ok: true, loggedOut: loggedOut };
  }

  /* ── Sync server users into localStorage (for admin panel display) ── */
  async function refreshUsersFromServer() {
    var srv = await authApi({ action: 'list_users', secret: authSecret() });
    if (!srv.ok || !Array.isArray(srv.users)) return;
    var localUsers = getUsers();
    var localMap = {};
    localUsers.forEach(function (u) { if (u && u.email) localMap[u.email] = u; });
    srv.users.forEach(function (su) {
      var e = normalizeEmail(su.email);
      var lu = localMap[e];
      if (lu) {
        lu.name = su.name || lu.name;
        lu.role = su.role || lu.role;
        lu.employeeId = su.employeeId != null ? su.employeeId : lu.employeeId;
        lu.employmentStatus = su.employmentStatus || lu.employmentStatus;
        lu.id = su.id || lu.id;
      } else {
        localUsers.push({
          id: su.id, email: e, password: '', name: su.name || '',
          role: su.role || 'caller', employeeId: su.employeeId,
          employmentStatus: su.employmentStatus || 'active',
          createdAt: su.createdAt || new Date().toISOString(),
        });
      }
    });
    saveUsers(localUsers);
    ensureEmployeeIds();
    ensurePromotedAdmins();
  }

  /* ── Migration: push localStorage users to server (one-time bootstrap) ── */
  async function migrateLocalUsersToServer() {
    var users = getUsers();
    var list = users.filter(function (u) { return u && u.email && u.password; }).map(function (u) {
      return { id: u.id, email: u.email, password: u.password, name: u.name, role: u.role, employeeId: u.employeeId, employmentStatus: u.employmentStatus, createdAt: u.createdAt };
    });
    if (!list.length) return { ok: true, migrated: 0, skipped: 0 };
    return authApi({ action: 'migrate', secret: authSecret(), users: list });
  }

  /* ── Presence (unchanged) ── */
  var PORTAL_PRESENCE_DEFAULT_SECRET = 'Free2026';

  function mergeCurrentUserEmploymentFromServerRoster() {
    var u = getCurrentUser();
    if (!u || !u.email) return Promise.resolve(false);
    return fetch('/api/portal-presence', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: true, secret: PORTAL_PRESENCE_DEFAULT_SECRET }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok || !Array.isArray(data.roster)) return false;
        var em = normalizeEmail(u.email);
        var row = null;
        for (var i = 0; i < data.roster.length; i++) {
          if (data.roster[i] && data.roster[i].email && normalizeEmail(data.roster[i].email) === em) { row = data.roster[i]; break; }
        }
        if (!row || row.employmentStatus == null) return false;
        var norm = normalizeEmploymentStatus(row.employmentStatus);
        var users = getUsers();
        var cur = users.find(function (x) { return x.id === u.id; });
        if (!cur || cur.employmentStatus === norm) return false;
        cur.employmentStatus = norm;
        saveUsers(users);
        return true;
      })
      .catch(function () { return false; });
  }

  function syncPortalRosterToServer(user) {
    if (!user || !user.email) return Promise.resolve(false);
    var sess = '';
    try { sess = sessionStorage.getItem('cb_session_started') || ''; } catch (e) {}
    if (!sess) { sess = new Date().toISOString(); try { sessionStorage.setItem('cb_session_started', sess); } catch (e2) {} }
    return fetch('/api/portal-presence', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: PORTAL_PRESENCE_DEFAULT_SECRET, userId: user.id,
        sessionStartedAt: sess, lastLoginAt: user.lastLoginAt || '',
        roster: { email: user.email, name: user.name || '', role: user.role || 'caller', employeeId: user.employeeId, createdAt: user.createdAt || '', employmentStatus: normalizeEmploymentStatus(user.employmentStatus || 'active') },
      }),
      keepalive: true,
    }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }

  async function checkPortalAccessOrRedirect() {
    var u = getCurrentUser();
    if (!u || !u.email || u.role === 'admin') return true;
    try {
      var r = await fetch('/api/portal-access', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: authSecret(), email: u.email }),
      });
      var d = await r.json().catch(function () { return {}; });
      if (!d || d.ok !== true) return true;
      if (d.configured === false) return true;
      if (d.status === 'pending') { window.location.replace('account-pending.html'); return false; }
      if (d.status === 'denied') { window.location.replace('account-denied.html'); return false; }
      return true;
    } catch (e) { return true; }
  }

  /* ── Exports ── */
  global.seedUsersIfNeeded = seedUsersIfNeeded;
  global.getAdminNotifyEmails = getAdminNotifyEmails;
  global.ensureEmployeeIds = ensureEmployeeIds;
  global.normalizeEmploymentStatus = normalizeEmploymentStatus;
  global.updateUserEmploymentStatus = updateUserEmploymentStatus;
  global.getUsers = getUsers;
  global.saveUsers = saveUsers;
  global.registerUser = registerUser;
  global.loginUser = loginUser;
  global.logout = logout;
  global.getCurrentUser = getCurrentUser;
  global.updateUserRole = updateUserRole;
  global.deleteUserAsAdmin = deleteUserAsAdmin;
  global.resetPassword = resetPassword;
  global.getPasswordStrength = getPasswordStrength;
  global.updateCurrentUserDisplayName = updateCurrentUserDisplayName;
  global.changePasswordForCurrentUser = changePasswordForCurrentUser;
  global.syncPortalRosterToServer = syncPortalRosterToServer;
  global.mergeCurrentUserEmploymentFromServerRoster = mergeCurrentUserEmploymentFromServerRoster;
  global.checkPortalAccessOrRedirect = checkPortalAccessOrRedirect;
  global.migrateLocalUsersToServer = migrateLocalUsersToServer;
  global.refreshUsersFromServer = refreshUsersFromServer;
  global.normalizePortalEmail = normalizeEmail;
})(typeof window !== 'undefined' ? window : this);
