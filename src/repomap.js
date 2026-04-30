(() => {
  'use strict';

  // ── Config ──
  const CONFIG = {
    WORKER_URL: '',
    CLIENT_ID: '',
    SCOPES: 'read:user',
    POLL_INTERVAL: 5000,
    REFRESH_INTERVAL: 300000,
  };

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

  // ── Repo fetching ──
  async function fetchAllRepos() {
    let repos = [];
    let page = 1;
    while (true) {
      const path = `/user/repos?per_page=100&type=owner&sort=updated&page=${page}`;
      const batch = await apiFetch(path);
      if (!Array.isArray(batch) || batch.length === 0) break;
      repos = repos.concat(batch);
      updateRepoCount(repos.length, true);
      if (batch.length < 100) break;
      page++;
    }
    return repos;
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

  // ── Color scale ──
  const COLD_LIGHT = [240, 241, 244];
  const HOT_LIGHT  = [59, 130, 246];
  const COLD_DARK  = [28, 36, 48];
  const HOT_DARK   = [88, 166, 255];

  let isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    isDark = e.matches;
    if (allRepos.length) renderTreemap();
  });

  function lerpColor(t) {
    const cold = isDark ? COLD_DARK : COLD_LIGHT;
    const hot  = isDark ? HOT_DARK  : HOT_LIGHT;
    return [0, 1, 2].map(i => Math.round(cold[i] + (hot[i] - cold[i]) * t));
  }

  function rgbStr(rgb) { return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`; }

  function tileTextColor(rgb) {
    const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    return lum > 0.45 ? '#111827' : '#e6edf3';
  }

  function activityNorm(pushedAt) {
    const days = (Date.now() - new Date(pushedAt)) / 86400000;
    return Math.max(0, 1 - Math.log1p(days) / Math.log1p(365));
  }

  function sizeNorm(size, allSizes) {
    if (allSizes.length <= 1) return 0.5;
    const smaller = allSizes.filter(s => s < size).length;
    return smaller / (allSizes.length - 1);
  }

  // ── Language color map ──
  const LANG_COLORS = {
    'JavaScript': '#f1e05a',
    'TypeScript': '#3178c6',
    'Python': '#3572a5',
    'Java': '#b07219',
    'Go': '#00add8',
    'Rust': '#dea584',
    'C#': '#178600',
    'C++': '#f34b7d',
    'C': '#555555',
    'Ruby': '#701516',
    'PHP': '#4f5d95',
    'Swift': '#f05138',
    'Kotlin': '#a97bff',
    'Shell': '#89e051',
    'HTML': '#e34c26',
    'CSS': '#563d7c',
    'Vue': '#41b883',
    'Dart': '#00b4ab',
    'R': '#198ce7',
    'Scala': '#c22d40',
    'Elixir': '#6e4a7e',
    'Haskell': '#5e5086',
    'Lua': '#000080',
    'MATLAB': '#e16737',
  };

  // ── Treemap layout (binary divide-and-conquer) ──
  function layoutTreemap(items, x, y, w, h) {
    if (!items.length) return [];
    if (items.length === 1) return [{ x, y, w, h, repo: items[0] }];

    const total = items.reduce((s, i) => s + i._layoutVal, 0);
    let half = 0;
    let splitIdx = items.length - 1;
    for (let i = 0; i < items.length - 1; i++) {
      half += items[i]._layoutVal;
      if (half >= total / 2) {
        splitIdx = i + 1;
        break;
      }
    }

    const leftItems = items.slice(0, splitIdx);
    const rightItems = items.slice(splitIdx);
    const leftFrac = leftItems.reduce((s, i) => s + i._layoutVal, 0) / total;

    if (w >= h) {
      const lw = Math.round(w * leftFrac);
      return [
        ...layoutTreemap(leftItems, x, y, lw, h),
        ...layoutTreemap(rightItems, x + lw, y, w - lw, h),
      ];
    } else {
      const lh = Math.round(h * leftFrac);
      return [
        ...layoutTreemap(leftItems, x, y, w, lh),
        ...layoutTreemap(rightItems, x, y + lh, w, h - lh),
      ];
    }
  }

  // ── Format size ──
  function formatSize(kb) {
    if (kb === 0) return '0 KB';
    if (kb < 1024) return `${kb} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
  }

  // ── Prefs ──
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem('gh-repomap-prefs')) || {}; } catch { return {}; }
  }
  function savePrefs(p) { localStorage.setItem('gh-repomap-prefs', JSON.stringify(p)); }

  // ── State ──
  let allRepos = [];
  let currentMetric = localStorage.getItem('gh-repomap-metric') || 'activity';

  function getFilteredRepos() {
    const prefs = loadPrefs();
    return allRepos.filter(r => {
      if (r.archived && !prefs.includeArchived) return false;
      if (r.fork && !prefs.includeForks) return false;
      return true;
    });
  }

  // ── Render treemap ──
  function renderTreemap() {
    const container = document.getElementById('repomap-treemap');
    const repos = getFilteredRepos();

    if (!repos.length) {
      container.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No repos to display.';
      container.appendChild(empty);
      updateRepoCount(allRepos.length, false);
      return;
    }

    const W = container.clientWidth;
    const H = container.clientHeight;
    if (W < 2 || H < 2) return;

    const items = repos.map(r => ({ ...r, _layoutVal: Math.max(r.size, 1) }));
    items.sort((a, b) => b._layoutVal - a._layoutVal);

    const allSizes = repos.map(r => r.size);
    const tiles = layoutTreemap(items, 0, 0, W, H);

    const frag = document.createDocumentFragment();
    for (const tile of tiles) {
      if (tile.w < 2 || tile.h < 2) continue;
      const repo = tile.repo;

      const norm = currentMetric === 'activity'
        ? activityNorm(repo.pushed_at)
        : sizeNorm(repo.size, allSizes);

      const rgb = lerpColor(norm);
      const bg = rgbStr(rgb);
      const fg = tileTextColor(rgb);

      const el = document.createElement('div');
      el.className = 'repomap-tile';
      el.style.left   = tile.x + 'px';
      el.style.top    = tile.y + 'px';
      el.style.width  = tile.w + 'px';
      el.style.height = tile.h + 'px';
      el.style.background = bg;
      el.style.color = fg;

      if (tile.w > 44 && tile.h > 22) {
        const name = document.createElement('span');
        name.className = 'tile-name';
        name.textContent = repo.name;
        el.appendChild(name);
      }

      if (tile.w > 60 && tile.h > 38) {
        const metric = document.createElement('span');
        metric.className = 'tile-metric';
        if (currentMetric === 'activity') {
          const days = Math.floor((Date.now() - new Date(repo.pushed_at)) / 86400000);
          metric.textContent = days === 0 ? 'today' : `${days}d ago`;
        } else {
          metric.textContent = formatSize(repo.size);
        }
        el.appendChild(metric);
      }


      el.addEventListener('mouseenter', showTooltip.bind(null, repo));
      el.addEventListener('mousemove', moveTooltip);
      el.addEventListener('mouseleave', hideTooltip);
      el.addEventListener('click', () => window.open(repo.html_url, '_blank', 'noopener'));

      frag.appendChild(el);
    }

    container.innerHTML = '';
    container.appendChild(frag);
    updateRepoCount(allRepos.length, false);
  }

  // ── Tooltip ──
  function showTooltip(repo, e) {
    const tooltip = document.getElementById('repomap-tooltip');
    tooltip.innerHTML = '';

    const titleRow = document.createElement('div');
    titleRow.className = 'tooltip-title';

    const nameEl = document.createElement('span');
    nameEl.className = 'tooltip-name';
    nameEl.textContent = repo.full_name;
    titleRow.appendChild(nameEl);

    if (repo.private) {
      const badge = document.createElement('span');
      badge.className = 'tooltip-badge';
      badge.textContent = 'private';
      titleRow.appendChild(badge);
    }
    if (repo.archived) {
      const badge = document.createElement('span');
      badge.className = 'tooltip-badge tooltip-badge-muted';
      badge.textContent = 'archived';
      titleRow.appendChild(badge);
    }
    if (repo.fork) {
      const badge = document.createElement('span');
      badge.className = 'tooltip-badge tooltip-badge-muted';
      badge.textContent = 'fork';
      titleRow.appendChild(badge);
    }
    tooltip.appendChild(titleRow);

    if (repo.description) {
      const desc = document.createElement('p');
      desc.className = 'tooltip-desc';
      desc.textContent = repo.description;
      tooltip.appendChild(desc);
    }

    const meta = document.createElement('div');
    meta.className = 'tooltip-meta';

    const metaItems = [
      ['Pushed', `${timeAgo(repo.pushed_at)} · ${new Date(repo.pushed_at).toLocaleDateString()}`],
      ['Size', formatSize(repo.size)],
    ];
    for (const [key, val] of metaItems) {
      const p = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = key + ': ';
      p.appendChild(strong);
      p.appendChild(document.createTextNode(val));
      meta.appendChild(p);
    }

    if (repo.language) {
      const p = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = 'Language: ';
      p.appendChild(strong);
      if (LANG_COLORS[repo.language]) {
        const dot = document.createElement('span');
        dot.className = 'tile-lang-dot';
        dot.style.cssText = `background:${LANG_COLORS[repo.language]};position:static;display:inline-block;vertical-align:middle;margin-right:4px`;
        p.appendChild(dot);
      }
      p.appendChild(document.createTextNode(repo.language));
      meta.appendChild(p);
    }
    tooltip.appendChild(meta);

    tooltip.hidden = false;
    moveTooltip(e);
  }

  function moveTooltip(e) {
    const tooltip = document.getElementById('repomap-tooltip');
    if (tooltip.hidden) return;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    let x = e.clientX + 16;
    let y = e.clientY + 16;
    if (x + tw > window.innerWidth - 8) x = e.clientX - tw - 16;
    if (y + th > window.innerHeight - 8) y = e.clientY - th - 16;
    tooltip.style.left = x + 'px';
    tooltip.style.top  = y + 'px';
  }

  function hideTooltip() {
    document.getElementById('repomap-tooltip').hidden = true;
  }

  // ── Settings bar ──
  function buildSettingsBar() {
    const bar = document.getElementById('settings-bar');
    const prefs = loadPrefs();
    bar.innerHTML = '';

    // Metric toggle
    const toggleGroup = document.createElement('div');
    toggleGroup.className = 'metric-toggle';

    for (const [metric, label] of [['activity', 'Activity'], ['size', 'Size']]) {
      const btn = document.createElement('button');
      btn.className = 'metric-btn' + (currentMetric === metric ? ' active' : '');
      btn.textContent = label;
      btn.dataset.metric = metric;
      btn.addEventListener('click', () => {
        if (currentMetric === metric) return;
        currentMetric = metric;
        localStorage.setItem('gh-repomap-metric', metric);
        toggleGroup.querySelectorAll('.metric-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.metric === metric);
        });
        renderTreemap();
      });
      toggleGroup.appendChild(btn);
    }
    bar.appendChild(toggleGroup);

    // Filter checkboxes
    const filters = document.createElement('div');
    filters.className = 'repomap-filters';

    for (const [key, label] of [['includeArchived', 'Archived'], ['includeForks', 'Forks']]) {
      const lbl = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!prefs[key];
      cb.addEventListener('change', () => {
        const p = loadPrefs();
        p[key] = cb.checked;
        savePrefs(p);
        renderTreemap();
      });
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(' ' + label));
      filters.appendChild(lbl);
    }
    bar.appendChild(filters);
  }

  // ── Repo count ──
  function updateRepoCount(total, loading) {
    const el = document.getElementById('repo-count');
    if (!el) return;
    if (loading) {
      el.textContent = `Loading… (${total} repos so far)`;
    } else {
      const shown = getFilteredRepos().length;
      el.textContent = shown === total ? `${total} repos` : `${shown} of ${total} repos`;
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
        sessionStorage.removeItem('gh-user');
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
        window.open('https://github.com/login/device', '_blank');
        pollDeviceFlow(data.device_code, data.interval || 5);
      } catch {
        const err = document.getElementById('auth-error');
        err.textContent = 'Device flow failed. Try using a Personal Access Token.';
        err.classList.add('visible');
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
          interval = data.interval || interval + 5;
        } else if (data.error === 'expired_token' || data.error === 'access_denied') {
          document.getElementById('auth-error').textContent =
            data.error === 'expired_token' ? 'Code expired. Please try again.' : 'Access denied.';
          document.getElementById('auth-error').classList.add('visible');
          document.getElementById('device-flow-info').classList.remove('active');
          document.getElementById('device-flow-btn').removeAttribute('aria-busy');
          document.getElementById('device-flow-btn').disabled = false;
          return;
        }
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

    buildSettingsBar();

    const container = document.getElementById('repomap-treemap');
    container.innerHTML = '';
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    container.appendChild(spinner);
    document.getElementById('repo-count').textContent = 'Loading repos…';

    try {
      allRepos = await fetchAllRepos();
      renderTreemap();
    } catch (err) {
      if (err.message === 'Unauthorized') return;
      container.innerHTML = '';
      const errorDiv = document.createElement('div');
      errorDiv.className = 'error-state';
      errorDiv.textContent = err.message;
      const retryBtn = document.createElement('button');
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', initDashboard);
      errorDiv.appendChild(retryBtn);
      container.appendChild(errorDiv);
    }
  }

  // ── Resize handler ──
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (allRepos.length) renderTreemap(); }, 150);
  });

  // ── Sign out ──
  document.getElementById('sign-out-btn').addEventListener('click', () => {
    clearToken();
    allRepos = [];
    showScreen('auth');
    document.getElementById('pat-input').value = '';
    document.getElementById('auth-error').classList.remove('visible');
  });

  // ── Refresh button ──
  document.getElementById('refresh-all-btn').addEventListener('click', async () => {
    if (!getToken()) return;
    const container = document.getElementById('repomap-treemap');
    container.innerHTML = '';
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    container.appendChild(spinner);
    document.getElementById('repo-count').textContent = 'Loading repos…';
    try {
      allRepos = await fetchAllRepos();
      renderTreemap();
    } catch (err) {
      if (err.message !== 'Unauthorized') {
        container.innerHTML = '';
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-state';
        errorDiv.textContent = err.message;
        container.appendChild(errorDiv);
      }
    }
  });

  // ── Auto-refresh ──
  setInterval(async () => {
    if (!getToken() || !allRepos.length) return;
    try {
      const repos = await fetchAllRepos();
      allRepos = repos;
      renderTreemap();
    } catch { /* silent */ }
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
