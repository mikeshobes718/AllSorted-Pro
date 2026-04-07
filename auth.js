(function (global) {
  var USERS_KEY = 'cb_users';
  var SESSION_KEY = 'cb_session';

  function getUsers() {
    try {
      return JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function pickNewEmployeeId(existingUsers) {
    var taken = {};
    (existingUsers || []).forEach(function (u) {
      if (!u) return;
      var n = parseInt(String(u.employeeId), 10);
      if (n >= 100 && n <= 999) taken[n] = true;
    });
    var newId;
    var tries = 0;
    do {
      newId = 100 + Math.floor(Math.random() * 900);
      tries++;
    } while (taken[newId] && tries < 500);
    if (taken[newId]) {
      for (newId = 100; newId <= 999; newId++) {
        if (!taken[newId]) break;
      }
    }
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
      if (taken[n] === undefined) {
        taken[n] = u.id;
      } else if (taken[n] !== u.id) {
        u.employeeId = undefined;
        changed = true;
      }
    });
    taken = {};
    users.forEach(function (u) {
      if (!u) return;
      var n = parseInt(String(u.employeeId), 10);
      if (n >= 100 && n <= 999) taken[n] = true;
    });
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

  var PROMOTE_TO_ADMIN_EMAILS = ['mikeybobby718@godfare.com'];

  function ensurePromotedAdmins() {
    var users = getUsers();
    if (!users.length) return;
    var changed = false;
    PROMOTE_TO_ADMIN_EMAILS.forEach(function (email) {
      var e = normalizeEmail(email);
      var u = users.find(function (x) {
        return x.email === e;
      });
      if (u && u.role !== 'admin') {
        u.role = 'admin';
        changed = true;
      }
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
    getUsers().forEach(function (u) {
      if (u && u.role === 'admin' && u.email) add(u.email);
    });
    PROMOTE_TO_ADMIN_EMAILS.forEach(add);
    return out;
  }

  function seedUsersIfNeeded() {
    var users = getUsers();
    if (!users.length) {
      users.push({
        id: 'u_seed_' + Date.now(),
        email: 'admin@allsortedpro.com',
        password: 'AllSorted2026!',
        name: 'Admin',
        role: 'admin',
        createdAt: new Date().toISOString()
      });
      saveUsers(users);
    }
    ensurePromotedAdmins();
    ensureEmployeeIds();
  }

  function registerUser(email, password, name) {
    seedUsersIfNeeded();
    var e = normalizeEmail(email);
    if (!e || !password) return { ok: false, error: 'Email and password are required' };
    var displayName = String(name || '').trim();
    if (!displayName) {
      return { ok: false, error: 'First name and last name are required' };
    }
    var nameParts = displayName.split(/\s+/).filter(Boolean);
    if (nameParts.length < 2) {
      return { ok: false, error: 'Enter both first and last name' };
    }
    var users = getUsers();
    if (users.some(function (u) { return u.email === e; })) {
      return { ok: false, error: 'An account with this email already exists' };
    }
    var newUser = {
      id: 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9),
      email: e,
      password: password,
      name: displayName,
      role: 'caller',
      employeeId: pickNewEmployeeId(users),
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    saveUsers(users);
    ensurePromotedAdmins();
    return { ok: true, user: newUser };
  }

  function loginUser(email, password) {
    seedUsersIfNeeded();
    var e = normalizeEmail(email);
    var users = getUsers();
    var u = users.find(function (x) { return x.email === e && x.password === password; });
    if (!u) return { ok: false, error: 'Invalid email or password' };
    var nowIso = new Date().toISOString();
    u.lastLoginAt = nowIso;
    saveUsers(users);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: u.id }));
    try {
      sessionStorage.setItem('cb_session_started', nowIso);
    } catch (e) {}
    return { ok: true, user: u };
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('cb_profile');
    localStorage.removeItem('cb_display_name');
  }

  function getSessionRaw() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch (e) {
      return null;
    }
  }

  function getCurrentUser() {
    var s = getSessionRaw();
    if (!s || !s.userId) return null;
    var users = getUsers();
    return users.find(function (u) { return u.id === s.userId; }) || null;
  }

  function resetPassword(email, newPassword) {
    seedUsersIfNeeded();
    var e = normalizeEmail(email);
    if (!e || !newPassword) return { ok: false, error: 'Email and new password are required' };
    if (String(newPassword).length < 4) {
      return { ok: false, error: 'Password must be at least 4 characters' };
    }
    var users = getUsers();
    var u = users.find(function (x) {
      return x.email === e;
    });
    if (!u) return { ok: false, error: 'No account found with this email' };
    u.password = newPassword;
    saveUsers(users);
    return { ok: true };
  }

  function getPasswordStrength(password) {
    var p = String(password || '');
    if (!p.length) {
      return { score: 0, label: '', pct: 0 };
    }
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
    var u = users.find(function (x) {
      return x.id === cur.id;
    });
    if (!u) return { ok: false, error: 'User not found' };
    u.name = String(name || '').trim();
    saveUsers(users);
    return { ok: true };
  }

  function changePasswordForCurrentUser(currentPassword, newPassword) {
    if (!newPassword || String(newPassword).length < 4) {
      return { ok: false, error: 'New password must be at least 4 characters' };
    }
    var cur = getCurrentUser();
    if (!cur) return { ok: false, error: 'Not signed in' };
    var users = getUsers();
    var u = users.find(function (x) {
      return x.id === cur.id;
    });
    if (!u) return { ok: false, error: 'User not found' };
    if (u.password !== currentPassword) {
      return { ok: false, error: 'Current password is incorrect' };
    }
    u.password = newPassword;
    saveUsers(users);
    return { ok: true };
  }

  function updateUserRole(userId, newRole) {
    if (newRole !== 'caller' && newRole !== 'admin') return { ok: false, error: 'Invalid role' };
    var cur = getCurrentUser();
    if (!cur || cur.role !== 'admin') return { ok: false, error: 'Admin only' };
    var users = getUsers();
    var admins = users.filter(function (u) { return u.role === 'admin'; });
    if (userId === cur.id && newRole === 'caller' && admins.length === 1) {
      return { ok: false, error: 'There must be at least one admin' };
    }
    var u = users.find(function (x) { return x.id === userId; });
    if (!u) return { ok: false, error: 'User not found' };
    u.role = newRole;
    saveUsers(users);
    return { ok: true };
  }

  var PORTAL_PRESENCE_DEFAULT_SECRET = 'Free2026';

  function syncPortalRosterToServer(user) {
    if (!user || !user.email) return Promise.resolve(false);
    var sess = '';
    try {
      sess = sessionStorage.getItem('cb_session_started') || '';
    } catch (e) {}
    if (!sess) {
      sess = new Date().toISOString();
      try {
        sessionStorage.setItem('cb_session_started', sess);
      } catch (e2) {}
    }
    var payload = JSON.stringify({
      secret: PORTAL_PRESENCE_DEFAULT_SECRET,
      userId: user.id,
      sessionStartedAt: sess,
      lastLoginAt: user.lastLoginAt || '',
      roster: {
        email: user.email,
        name: user.name || '',
        role: user.role || 'caller',
        employeeId: user.employeeId,
        createdAt: user.createdAt || '',
      },
    });
    return fetch('/api/portal-presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    })
      .then(function (r) {
        return r.ok;
      })
      .catch(function () {
        return false;
      });
  }

  async function checkPortalAccessOrRedirect() {
    var u = getCurrentUser();
    if (!u || !u.email || u.role === 'admin') return true;
    var secret = localStorage.getItem('cb_scraper_secret') || 'Free2026';
    try {
      var r = await fetch('/api/portal-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: secret, email: u.email }),
      });
      var d = await r.json().catch(function () {
        return {};
      });
      if (!d || d.ok !== true) return true;
      if (d.configured === false) return true;
      if (d.status === 'pending') {
        window.location.replace('account-pending.html');
        return false;
      }
      if (d.status === 'denied') {
        window.location.replace('account-denied.html');
        return false;
      }
      return true;
    } catch (e) {
      return true;
    }
  }

  function deleteUserAsAdmin(userId) {
    var cur = getCurrentUser();
    if (!cur || cur.role !== 'admin') return { ok: false, error: 'Admin only' };
    var users = getUsers();
    var target = users.find(function (x) { return x.id === userId; });
    if (!target) return { ok: false, error: 'User not found' };
    var admins = users.filter(function (u) { return u.role === 'admin'; });
    if (target.role === 'admin' && admins.length <= 1) {
      return { ok: false, error: 'Cannot remove the only admin' };
    }
    var next = users.filter(function (u) { return u.id !== userId; });
    saveUsers(next);
    var loggedOut = cur.id === userId;
    if (loggedOut) logout();
    return { ok: true, loggedOut: loggedOut };
  }

  global.seedUsersIfNeeded = seedUsersIfNeeded;
  global.getAdminNotifyEmails = getAdminNotifyEmails;
  global.ensureEmployeeIds = ensureEmployeeIds;
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
  global.checkPortalAccessOrRedirect = checkPortalAccessOrRedirect;
})(typeof window !== 'undefined' ? window : this);
