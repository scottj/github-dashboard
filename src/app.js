(() => {
  'use strict';

  // ── Config ──
  const CONFIG = {
    WORKER_URL: '',       // Set to Cloudflare Worker URL to enable Device Flow
    CLIENT_ID: '',        // GitHub App client ID (for Device Flow)
    SCOPES: 'repo notifications read:user',
    POLL_INTERVAL: 5000,
    REFRESH_INTERVAL: 300000, // 5 min
  };

  const SECTIONS = [
    { id: 'prs-review',    title: 'PRs Requesting My Review',  type: 'search', query: q => `type:pr state:open review-requested:${q}` },
    { id: 'issues-assigned', title: 'Issues Assigned to Me',   type: 'search', query: q => `type:issue state:open assignee:${q}` },
    { id: 'prs-authored',  title: 'PRs Authored by Me',       type: 'search', query: q => `type:pr state:open author:${q}` },
    { id: 'issues-authored', title: 'Issues Authored by Me',   type: 'search', query: q => `type:issue state:open author:${q}` },
    { id: 'notifications',   title: 'Notifications',           type: 'notifications' },
  ];
  const SECTIONS_MAP = new Map(SECTIONS.map(s => [s.id, s]));

  // ── Auth ──
  const isClassicToken = t => t.startsWith('ghp_') || t.startsWith('gho_');
  const getToken = () => localStorage.getItem('gh-token') || sessionStorage.getItem('gh-token');
  const setToken = t => {
    if (isClassicToken(t)) { sessionStorage.setItem('gh-token', t); localStorage.removeItem('gh-token'); }
    else { localStorage.setItem('gh-token', t); sessionStorage.removeItem('gh-token'); }
  };
  const clearToken = () => {
    localStorage.removeItem('gh-token'); localStorage.removeItem('gh-user');
    sessionStorage.removeItem('gh-token'); sessionStorage.removeItem('gh-user');
  };

  // ── API ──
  let rateLimitRemaining = null;
  let rateLimitReset = null;
  const etagCache = {};

  async function apiFetch(path, opts = {}) {
    const token = getToken();
    if (!token) throw new Error('No token');
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...opts.headers,
    };
    const cached = etagCache[path];
    if (cached && !opts.method) {
      headers['If-None-Match'] = cached.etag;
    }
    const res = await fetch('https://api.github.com' + path, { ...opts, headers });

    const rl = res.headers.get('X-RateLimit-Remaining');
    const rr = res.headers.get('X-RateLimit-Reset');
    if (rl !== null) rateLimitRemaining = parseInt(rl, 10);
    if (rr !== null) rateLimitReset = parseInt(rr, 10);
    updateRateLimitBanner();

    if (res.status === 304 && cached) {
      return cached.data;
    }
    if (res.status === 401) {
      clearToken();
      showScreen('auth', 'Session expired. Please sign in again.');
      throw new Error('Unauthorized');
    }
    if (res.status === 403 && rateLimitRemaining === 0) {
      throw new Error('Rate limited');
    }
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();
    const etag = res.headers.get('ETag');
    if (etag && !opts.method) {
      etagCache[path] = { etag, data };
    }
    return data;
  }

  function updateRateLimitBanner() {
    const banner = document.getElementById('rate-limit-banner');
    if (rateLimitRemaining !== null && rateLimitRemaining < 10) {
      const resetDate = new Date(rateLimitReset * 1000);
      banner.textContent = `API rate limit low (${rateLimitRemaining} remaining). Resets at ${resetDate.toLocaleTimeString()}.`;
      banner.classList.add('visible');
    } else {
      banner.classList.remove('visible');
    }
  }

  async function fetchCurrentUser() {
    const cached = sessionStorage.getItem('gh-user');
    if (cached) return JSON.parse(cached);
    const user = await apiFetch('/user');
    sessionStorage.setItem('gh-user', JSON.stringify({ login: user.login, avatar_url: user.avatar_url, name: user.name }));
    return user;
  }

  async function searchIssues(query) {
    const data = await apiFetch(`/search/issues?q=${encodeURIComponent(query)}&per_page=50&sort=updated&order=desc`);
    return data.items || [];
  }

  async function fetchNotifications() {
    try {
      return await apiFetch('/notifications?per_page=50');
    } catch (err) {
      if (err.message.includes('403') || err.message.includes('404')) {
        throw new Error('Notifications require a classic token with the "notifications" scope. Fine-grained tokens do not support this API.');
      }
      throw err;
    }
  }

  async function markNotificationRead(threadId) {
    await apiFetch(`/notifications/threads/${threadId}`, { method: 'PATCH' });
  }

  // ── Time helper ──
  function timeAgo(dateStr) {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  }

  // ── Text color for label contrast ──
  function contrastColor(hexBg) {
    const r = parseInt(hexBg.substr(0, 2), 16);
    const g = parseInt(hexBg.substr(2, 2), 16);
    const b = parseInt(hexBg.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#000' : '#fff';
  }

  // ── Preferences ──
  const DEFAULT_PREFS = Object.fromEntries(SECTIONS.map(s => [s.id, true]));

  function loadPrefs() {
    try {
      const stored = localStorage.getItem('gh-dash-prefs');
      if (stored) return { ...DEFAULT_PREFS, ...JSON.parse(stored) };
    } catch {}
    return { ...DEFAULT_PREFS };
  }

  function savePrefs(prefs) {
    localStorage.setItem('gh-dash-prefs', JSON.stringify(prefs));
  }

  // ── Rendering ──
  function renderItems(items) {
    if (!items.length) return '<div class="empty-state">Nothing here!</div>';
    const ul = document.createElement('ul');
    ul.className = 'item-list';
    for (const item of items) {
      const repo = item.repository_url ? item.repository_url.replace('https://api.github.com/repos/', '') : '';
      const li = document.createElement('li');

      const img = document.createElement('img');
      img.className = 'item-avatar';
      img.src = item.user?.avatar_url || '';
      img.alt = '';
      img.loading = 'lazy';

      const content = document.createElement('div');
      content.className = 'item-content';

      const repoDiv = document.createElement('div');
      repoDiv.className = 'item-repo';
      repoDiv.textContent = repo;

      const titleDiv = document.createElement('div');
      titleDiv.className = 'item-title';
      const titleLink = document.createElement('a');
      titleLink.href = item.html_url;
      titleLink.target = '_blank';
      titleLink.rel = 'noopener';
      titleLink.textContent = item.title;
      titleDiv.appendChild(titleLink);

      const metaDiv = document.createElement('div');
      metaDiv.className = 'item-meta';
      for (const l of (item.labels || [])) {
        const pill = document.createElement('span');
        pill.className = 'label-pill';
        pill.style.background = `#${l.color}`;
        pill.style.color = contrastColor(l.color);
        pill.textContent = l.name;
        metaDiv.appendChild(pill);
      }
      const timeSpan = document.createElement('span');
      timeSpan.className = 'item-time';
      timeSpan.textContent = timeAgo(item.updated_at);
      metaDiv.appendChild(timeSpan);

      content.appendChild(repoDiv);
      content.appendChild(titleDiv);
      content.appendChild(metaDiv);
      li.appendChild(img);
      li.appendChild(content);
      ul.appendChild(li);
    }
    return ul;
  }

  function renderNotifications(items) {
    if (!items.length) return '<div class="empty-state">No notifications!</div>';
    const grouped = {};
    for (const n of items) {
      const repo = n.repository?.full_name || 'Unknown';
      if (!grouped[repo]) grouped[repo] = [];
      grouped[repo].push(n);
    }
    const frag = document.createDocumentFragment();
    for (const [repo, notifs] of Object.entries(grouped)) {
      const header = document.createElement('div');
      header.className = 'notif-group-header';
      header.textContent = repo;
      frag.appendChild(header);
      for (const n of notifs) {
        const row = document.createElement('div');
        row.className = 'notif-item' + (n.unread ? ' notif-unread' : '');

        const dot = document.createElement('span');
        dot.className = 'notif-dot' + (n.unread ? '' : ' read');
        row.appendChild(dot);

        const title = document.createElement('span');
        title.className = 'notification-title';
        title.textContent = n.subject?.title || '';
        row.appendChild(title);

        const time = document.createElement('span');
        time.className = 'item-time';
        time.textContent = timeAgo(n.updated_at);
        row.appendChild(time);

        if (n.unread) {
          const btn = document.createElement('button');
          btn.textContent = 'Mark read';
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            try {
              await markNotificationRead(n.id);
              row.classList.remove('notif-unread');
              dot.classList.add('read');
              btn.remove();
            } catch { btn.disabled = false; }
          });
          row.appendChild(btn);
        }

        frag.appendChild(row);
      }
    }
    return frag;
  }

  const _escapeDiv = document.createElement('div');
  function escapeHtml(str) {
    _escapeDiv.textContent = str;
    return _escapeDiv.innerHTML;
  }

  // ── Section management ──
  const sectionData = {};
  const supportsNotifications = () => { const t = getToken(); return t && isClassicToken(t); };
  const visibleSections = () => supportsNotifications() ? SECTIONS : SECTIONS.filter(s => s.type !== 'notifications');

  function buildSections() {
    const grid = document.getElementById('sections-grid');
    const settingsBar = document.getElementById('settings-bar');
    const prefs = loadPrefs();

    grid.innerHTML = '';
    settingsBar.innerHTML = '';

    for (const sec of visibleSections()) {
      // Toggle
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = prefs[sec.id];
      cb.addEventListener('change', () => {
        const p = loadPrefs();
        p[sec.id] = cb.checked;
        savePrefs(p);
        const card = document.getElementById(`section-${sec.id}`);
        card.classList.toggle('hidden', !cb.checked);
        if (cb.checked && !sectionData[sec.id]) refreshSection(sec.id);
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(sec.title));
      settingsBar.appendChild(label);

      // Card
      const card = document.createElement('div');
      card.className = `section-card section-${sec.id}${prefs[sec.id] ? '' : ' hidden'}`;
      card.id = `section-${sec.id}`;

      const cardHeader = document.createElement('div');
      cardHeader.className = 'section-card-header';

      const h2 = document.createElement('h2');
      h2.textContent = sec.title + ' ';
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.id = `badge-${sec.id}`;
      badge.textContent = '0';
      h2.appendChild(badge);
      cardHeader.appendChild(h2);

      const refreshBtn = document.createElement('button');
      refreshBtn.textContent = 'Refresh';
      refreshBtn.addEventListener('click', () => refreshSection(sec.id));
      cardHeader.appendChild(refreshBtn);

      const cardBody = document.createElement('div');
      cardBody.className = 'section-card-body';
      cardBody.id = `body-${sec.id}`;
      cardBody.innerHTML = '<div class="spinner"></div>';

      const cardFooter = document.createElement('div');
      cardFooter.className = 'section-card-footer';
      cardFooter.id = `footer-${sec.id}`;

      card.appendChild(cardHeader);
      card.appendChild(cardBody);
      card.appendChild(cardFooter);
      grid.appendChild(card);
    }
  }

  async function refreshSection(sectionId, user) {
    const sec = SECTIONS_MAP.get(sectionId);
    if (!sec) return;
    const body = document.getElementById(`body-${sectionId}`);
    const badge = document.getElementById(`badge-${sectionId}`);
    const footer = document.getElementById(`footer-${sectionId}`);
    body.innerHTML = '<div class="spinner"></div>';

    try {
      let items, rendered, count;
      if (sec.type === 'search') {
        if (!user) user = await fetchCurrentUser();
        items = await searchIssues(sec.query(user.login));
        rendered = renderItems(items);
        count = items.length;
      } else {
        items = await fetchNotifications();
        rendered = renderNotifications(items);
        count = items.filter(n => n.unread).length;
      }
      body.innerHTML = '';
      if (typeof rendered === 'string') {
        body.innerHTML = rendered;
      } else {
        body.appendChild(rendered);
      }
      sectionData[sectionId] = items;
      badge.textContent = count;
      badge.classList.toggle('visible', count > 0);
      footer.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    } catch (err) {
      if (err.message === 'Unauthorized') return;
      body.innerHTML = '';
      const errorDiv = document.createElement('div');
      errorDiv.className = 'error-state';
      errorDiv.textContent = err.message;
      const br = document.createElement('br');
      errorDiv.appendChild(br);
      const retryBtn = document.createElement('button');
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => refreshSection(sectionId));
      errorDiv.appendChild(retryBtn);
      body.appendChild(errorDiv);
    }
  }

  let refreshInFlight = false;
  async function refreshAll() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const prefs = loadPrefs();
      const user = await fetchCurrentUser();
      const promises = visibleSections().filter(s => prefs[s.id]).map(s => refreshSection(s.id, user));
      await Promise.allSettled(promises);
    } finally {
      refreshInFlight = false;
    }
  }

  // ── Screen management ──
  function showScreen(screen, errorMsg) {
    document.getElementById('auth-screen').classList.toggle('active', screen === 'auth');
    document.getElementById('dashboard').classList.toggle('active', screen === 'dashboard');
    if (errorMsg) {
      const el = document.getElementById('auth-error');
      el.textContent = errorMsg;
      el.classList.add('visible');
    }
  }

  // ── PAT Auth ──
  function initPATAuth() {
    const input = document.getElementById('pat-input');
    const btn = document.getElementById('pat-submit');
    const error = document.getElementById('auth-error');

    btn.addEventListener('click', async () => {
      const token = input.value.trim();
      if (!token) { error.textContent = 'Please enter a token.'; error.classList.add('visible'); return; }
      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;
      error.classList.remove('visible');
      setToken(token);
      try {
        const user = await fetchCurrentUser();
        sessionStorage.removeItem('gh-user'); // clear cache to re-fetch
        await initDashboard();
      } catch (err) {
        clearToken();
        error.textContent = 'Invalid token. Please check and try again.';
        error.classList.add('visible');
      } finally {
        btn.removeAttribute('aria-busy');
        btn.disabled = false;
      }
    });

    input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
  }

  // ── Device Flow Auth ──
  function initDeviceFlow() {
    if (!CONFIG.WORKER_URL || !CONFIG.CLIENT_ID) return;
    document.getElementById('device-flow-section').style.display = '';

    const btn = document.getElementById('device-flow-btn');
    const info = document.getElementById('device-flow-info');
    const codeEl = document.getElementById('user-code');

    btn.addEventListener('click', async () => {
      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;
      try {
        const res = await fetch(`${CONFIG.WORKER_URL}/login/device/code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: CONFIG.CLIENT_ID, scope: CONFIG.SCOPES }),
        });
        const data = await res.json();
        codeEl.textContent = data.user_code;
        info.classList.add('active');
        window.open(`https://github.com/login/device`, '_blank');
        pollDeviceFlow(data.device_code, data.interval || 5);
      } catch (err) {
        const error = document.getElementById('auth-error');
        error.textContent = 'Device flow failed. Try using a Personal Access Token.';
        error.classList.add('visible');
        btn.removeAttribute('aria-busy');
        btn.disabled = false;
      }
    });
  }

  async function pollDeviceFlow(deviceCode, interval) {
    const poll = async () => {
      try {
        const res = await fetch(`${CONFIG.WORKER_URL}/login/oauth/access_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: CONFIG.CLIENT_ID,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        });
        const data = await res.json();
        if (data.access_token) {
          setToken(data.access_token);
          await initDashboard();
          return;
        }
        if (data.error === 'slow_down') {
          interval = (data.interval || interval + 5);
        } else if (data.error === 'expired_token' || data.error === 'access_denied') {
          document.getElementById('auth-error').textContent =
            data.error === 'expired_token' ? 'Code expired. Please try again.' : 'Access denied.';
          document.getElementById('auth-error').classList.add('visible');
          document.getElementById('device-flow-info').classList.remove('active');
          document.getElementById('device-flow-btn').removeAttribute('aria-busy');
          document.getElementById('device-flow-btn').disabled = false;
          return;
        }
        // authorization_pending — keep polling
        setTimeout(poll, interval * 1000);
      } catch {
        setTimeout(poll, interval * 1000);
      }
    };
    setTimeout(poll, interval * 1000);
  }

  // ── Dashboard init ──
  async function initDashboard() {
    const user = await fetchCurrentUser();
    document.getElementById('user-avatar').src = user.avatar_url;
    document.getElementById('user-name').textContent = user.name || user.login;
    showScreen('dashboard');
    buildSections();
    refreshAll();
  }

  // ── Sign out ──
  document.getElementById('sign-out-btn').addEventListener('click', () => {
    clearToken();
    showScreen('auth');
    document.getElementById('pat-input').value = '';
    document.getElementById('auth-error').classList.remove('visible');
  });

  // ── Refresh all button ──
  document.getElementById('refresh-all-btn').addEventListener('click', () => refreshAll());

  // ── Auto-refresh ──
  setInterval(() => {
    if (getToken()) refreshAll();
  }, CONFIG.REFRESH_INTERVAL);

  // ── Init ──
  initPATAuth();
  initDeviceFlow();
  if (getToken()) {
    initDashboard().catch(() => showScreen('auth', 'Session expired. Please sign in again.'));
  } else {
    showScreen('auth');
  }
})();
