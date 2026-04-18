// StreamVault IPTV - Complete Fixed Code

const CONFIG = {
  CREDENTIALS: { username: 'Pankaj34540', password: 'Subha@9938' },
  STORAGE_KEYS: {
    PLAYLISTS: 'iptv_playlists',
    FAVORITES: 'iptv_favorites',
    RECENT: 'iptv_recent',
    CUSTOM: 'iptv_custom',
    LAST_PLAYLIST: 'iptv_last_playlist',
    AUTH: 'iptv_auth'
  },
  MAX_RECENT: 20
};

const state = {
  channels: [],
  filteredChannels: [],
  favorites: [],
  recent: [],
  customChannels: [],
  playlists: [],
  currentSection: 'all',
  currentPlaylistId: null,
  currentChannel: null,
  categories: new Set(),
  hls: null,
  searchQuery: '',
  categoryFilter: ''
};

const $ = id => document.getElementById(id);

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function showToast(message, type = 'success') {
  const container = $('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function loadFromStorage() {
  try {
    state.playlists = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PLAYLISTS) || '[]');
    state.favorites = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.FAVORITES) || '[]');
    state.recent = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.RECENT) || '[]');
    state.customChannels = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.CUSTOM) || '[]');
    state.currentPlaylistId = localStorage.getItem(CONFIG.STORAGE_KEYS.LAST_PLAYLIST);
  } catch (e) { console.error('Storage error:', e); }
}

function saveToStorage(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function checkAuth() {
  if (sessionStorage.getItem(CONFIG.STORAGE_KEYS.AUTH) === 'true') {
    showApp();
  } else {
    showLogin();
  }
}

function showLogin() {
  if ($('login-page')) $('login-page').style.display = 'flex';
  if ($('app-container')) $('app-container').classList.remove('active');
}

function showApp() {
  if ($('login-page')) $('login-page').style.display = 'none';
  if ($('app-container')) $('app-container').classList.add('active');
  initializeApp();
}

function handleLogin(e) {
  e.preventDefault();
  const user = $('username')?.value.trim();
  const pass = $('password')?.value;
  if (user === CONFIG.CREDENTIALS.username && pass === CONFIG.CREDENTIALS.password) {
    sessionStorage.setItem(CONFIG.STORAGE_KEYS.AUTH, 'true');
    showApp();
    showToast('Welcome back!');
  } else {
    showToast('Wrong credentials!', 'error');
  }
}

function handleLogout() {
  sessionStorage.removeItem(CONFIG.STORAGE_KEYS.AUTH);
  state.channels = [];
  checkAuth();
  showToast('Logged out');
}

function parseM3U(content) {
  const lines = content.split('\n');
  const channels = [];
  let current = null;
  for (const line of lines) {
    const trim = line.trim();
    if (trim.startsWith('#EXTINF:')) {
      const info = trim.substring(8);
      const name = info.match(/,(.+)$/);
      const logo = info.match(/tvg-logo="([^"]*)"/);
      const group = info.match(/group-title="([^"]*)"/);
      current = {
        id: generateId(),
        name: name?.[1]?.trim() || 'Unknown',
        logo: logo?.[1] || '',
        category: group?.[1] || 'General',
        url: ''
      };
    } else if (trim && !trim.startsWith('#') && current) {
      current.url = trim;
      channels.push(current);
      current = null;
    }
  }
  return channels;
}

async function fetchM3U(url) {
  const res = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error('Failed to fetch playlist');
  return parseM3U(await res.text());
}

async function fetchXtream(server, user, pass) {
  const res = await fetch(`/api/xtream/streams?server=${encodeURIComponent(server)}&user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`);
  if (!res.ok) throw new Error('Failed to fetch Xtream');
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Bad response');
  return data.map(ch => ({
    id: generateId(),
    name: ch.name || 'Unknown',
    logo: ch.stream_icon || '',
    category: ch.category_name || 'General',
    url: `${server.replace(/\/$/, '')}/live/${user}/${pass}/${ch.stream_id}.m3u8`
  }));
}

// --- MISSING FUNCTIONS ADDED HERE ---

async function addPlaylist(type, data) {
  const playlist = {
    id: generateId(),
    type,
    name: data.name,
    addedAt: Date.now()
  };
  
  if (type === 'm3u') {
    playlist.url = data.url;
  } else {
    playlist.server = data.server;
    playlist.user = data.user;
    playlist.pass = data.pass;
  }
  
  state.playlists.push(playlist);
  saveToStorage(CONFIG.STORAGE_KEYS.PLAYLISTS, state.playlists);
  renderPlaylistsNav();
  await loadPlaylist(playlist.id);
}

function addCustomChannel(data) {
  const channel = {
    id: generateId(),
    name: data.name,
    url: data.url,
    logo: data.logo || '',
    category: data.category || 'Custom',
    isCustom: true
  };
  
  state.customChannels.push(channel);
  saveToStorage(CONFIG.STORAGE_KEYS.CUSTOM, state.customChannels);
  state.channels.push(channel);
  renderChannels();
  showToast('Channel added!');
}

// -------------------------------------

async function loadPlaylist(id) {
  const p = state.playlists.find(x => x.id === id);
  if (!p) return;
  state.currentPlaylistId = id;
  localStorage.setItem(CONFIG.STORAGE_KEYS.LAST_PLAYLIST, id);
  showLoading(true);
  try {
    let chans = p.type === 'm3u' ? await fetchM3U(p.url) : await fetchXtream(p.server, p.user, p.pass);
    state.channels = [...chans, ...state.customChannels];
    state.filteredChannels = state.channels;
    state.categories = new Set(state.channels.map(c => c.category));
    updateCategoryFilter();
    renderPlaylistsNav();
    renderChannels();
    showToast(`Loaded ${state.channels.length} channels`);
  } catch (e) {
    console.error(e);
    showToast(e.message, 'error');
  } finally {
    showLoading(false);
  }
}

function deletePlaylist(id) {
  state.playlists = state.playlists.filter(p => p.id !== id);
  saveToStorage(CONFIG.STORAGE_KEYS.PLAYLISTS, state.playlists);
  renderPlaylistsNav();
  showToast('Playlist deleted');
}

function deleteCustomChannel(id) {
  state.customChannels = state.customChannels.filter(c => c.id !== id);
  saveToStorage(CONFIG.STORAGE_KEYS.CUSTOM, state.customChannels);
  state.channels = state.channels.filter(c => c.id !== id);
  renderChannels();
  showToast('Channel deleted');
}

function showLoading(show) {
  $('loading-state')?.classList.toggle('hidden', !show);
}

function renderPlaylistsNav() {
  const nav = $('playlists-nav');
  if (!nav) return;
  nav.innerHTML = state.playlists.map(p => `
    <div class="playlist-item ${p.id === state.currentPlaylistId ? 'active' : ''}" data-id="${p.id}">
      <div class="playlist-item-info">
        <div class="playlist-item-name">${escapeHtml(p.name)}</div>
        <div class="playlist-item-type">${p.type}</div>
      </div>
      <button class="btn-icon btn-sm delete-pl-btn" data-id="${p.id}">🗑</button>
    </div>
  `).join('');
  
  nav.querySelectorAll('.playlist-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-pl-btn')) {
        e.stopPropagation();
        deletePlaylist(el.dataset.id);
      } else {
        loadPlaylist(el.dataset.id);
      }
    });
  });
}

function playChannel(ch) {
  state.currentChannel = ch;
  const player = $('video-player');
  if (!$('player-section')) return;
  $('player-section').classList.remove('hidden');
  $('player-channel-name').textContent = ch.name;
  $('player-channel-category').textContent = ch.category;
  
  document.querySelectorAll('.channel-card').forEach(c => c.classList.toggle('playing', c.dataset.id === ch.id));
  $('player-section').scrollIntoView({ behavior: 'smooth' });
  
  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    if (state.hls) state.hls.destroy();
    state.hls = new Hls();
    state.hls.loadSource(ch.url);
    state.hls.attachMedia(player);
    state.hls.on(Hls.Events.MANIFEST_PARSED, () => player.play().catch(() => {}));
    state.hls.on(Hls.Events.ERROR, () => showToast('Stream error (maybe offline)', 'error'));
  } else {
    player.src = ch.url;
    player.play().catch(() => {});
  }
  
  state.recent = [ch, ...state.recent.filter(r => r.id !== ch.id)].slice(0, 20);
  saveToStorage(CONFIG.STORAGE_KEYS.RECENT, state.recent);
}

function toggleFavorite(id) {
  state.favorites = state.favorites.includes(id) ? state.favorites.filter(x => x !== id) : [...state.favorites, id];
  saveToStorage(CONFIG.STORAGE_KEYS.FAVORITES, state.favorites);
  $('favorites-count').textContent = state.favorites.length;
  renderChannels();
}

function applyFilters() {
  let chans = state.channels;
  if (state.currentSection === 'favorites') chans = state.channels.filter(c => state.favorites.includes(c.id));
  else if (state.currentSection === 'recent') chans = state.recent;
  else if (state.currentSection === 'custom') chans = state.customChannels;
  
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    chans = chans.filter(c => c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q));
  }
  if (state.categoryFilter) {
    chans = chans.filter(c => c.category === state.categoryFilter);
  }
  state.filteredChannels = chans;
}

function updateCategoryFilter() {
  const filter = $('category-filter');
  if (!filter) return;
  filter.innerHTML = '<option value="">All Categories</option>';
  Array.from(state.categories).sort().forEach(cat => {
    filter.innerHTML += `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`;
  });
}

function renderChannels() {
  applyFilters();
  const grid = $('channel-grid');
  if (!grid) return;
  grid.innerHTML = '';
  if ($('channel-count')) $('channel-count').textContent = `${state.filteredChannels.length} channels`;
  
  if (state.filteredChannels.length === 0) {
    $('empty-state')?.classList.remove('hidden');
    return;
  }
  $('empty-state')?.classList.add('hidden');
  
  state.filteredChannels.forEach(ch => {
    const card = document.createElement('div');
    card.className = `channel-card ${state.currentChannel?.id === ch.id ? 'playing' : ''}`;
    card.dataset.id = ch.id;
    const isFav = state.favorites.includes(ch.id);
    
    card.innerHTML = `
      <div class="channel-logo">${ch.logo ? `<img src="${escapeHtml(ch.logo)}" onerror="this.style.display='none'">` : '📺'}</div>
      <div class="channel-info">
        <div class="channel-name">${escapeHtml(ch.name)}</div>
        <div class="channel-category">${escapeHtml(ch.category)}</div>
      </div>
      <div class="channel-actions">
        <button class="channel-action-btn favorite ${isFav?'active':''}" data-action="fav">♥</button>
        <button class="channel-action-btn" data-action="copy">📋</button>
        ${ch.isCustom ? `<button class="channel-action-btn" data-action="del">🗑</button>` : ''}
      </div>
    `;
    
    card.addEventListener('click', (e) => {
      if (e.target.closest('.channel-actions')) return;
      playChannel(ch);
    });
    
    card.querySelector('[data-action="fav"]').onclick = (e) => { e.stopPropagation(); toggleFavorite(ch.id); };
    card.querySelector('[data-action="copy"]').onclick = (e) => { e.stopPropagation(); navigator.clipboard.writeText(ch.url); showToast('Copied!'); };
    if (card.querySelector('[data-action="del"]')) {
      card.querySelector('[data-action="del"]').onclick = (e) => { e.stopPropagation(); deleteCustomChannel(ch.id); };
    }
    grid.appendChild(card);
  });
}

function openModal(m) { m?.classList.add('active'); }
function closeModal(m) { m?.classList.remove('active'); }

function handlePlaylistSave() {
  const isM3u = document.querySelector('.modal-tab.active').dataset.tab === 'm3u';
  
  if (isM3u) {
    const name = $('playlist-name').value.trim();
    const url = $('m3u-url').value.trim();
    if (!name || !url) {
      showToast('Please fill Name and URL', 'error');
      return;
    }
    addPlaylist('m3u', { name, url });
  } else {
    const name = $('xtream-name').value.trim();
    const server = $('xtream-server').value.trim();
    const user = $('xtream-user').value.trim();
    const pass = $('xtream-pass').value;
    if (!name || !server || !user || !pass) {
      showToast('Please fill all fields', 'error');
      return;
    }
    addPlaylist('xtream', { name, server, user, pass });
  }
  
  // Clear inputs
  $('playlist-name').value = '';
  $('m3u-url').value = '';
  $('xtream-name').value = '';
  $('xtream-server').value = '';
  $('xtream-user').value = '';
  $('xtream-pass').value = '';
  
  closeModal($('playlist-modal'));
}

function handleCustomSave() {
  const name = $('custom-name').value.trim();
  const url = $('custom-url').value.trim();
  const logo = $('custom-logo').value.trim();
  const cat = $('custom-category').value.trim();
  
  if (!name || !url) {
    showToast('Name and URL required', 'error');
    return;
  }
  
  addCustomChannel({ name, url, logo, category: cat });
  
  $('custom-name').value = '';
  $('custom-url').value = '';
  $('custom-logo').value = '';
  $('custom-category').value = '';
  
  closeModal($('custom-modal'));
}

function initializeApp() {
  loadFromStorage();
  $('favorites-count').textContent = state.favorites.length;
  renderPlaylistsNav();
  
  // Navigation
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.onclick = () => {
      state.currentSection = item.dataset.section;
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      $('section-title-text').textContent = item.textContent.trim();
      renderChannels();
    };
  });
  
  // Search
  let searchTimeout;
  $('search-input').oninput = (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = e.target.value;
      renderChannels();
    }, 300);
  };
  
  // Category Filter
  $('category-filter').onchange = (e) => {
    state.categoryFilter = e.target.value;
    renderChannels();
  };
  
  // Buttons
  $('add-playlist-btn').onclick = () => openModal($('playlist-modal'));
  $('save-playlist-btn').onclick = handlePlaylistSave;
  $('add-custom-btn').onclick = () => openModal($('custom-modal'));
  $('save-custom-btn').onclick = handleCustomSave;
  
  // Tabs
  document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const isM3u = tab.dataset.tab === 'm3u';
      $('m3u-tab').classList.toggle('hidden', !isM3u);
      $('xtream-tab').classList.toggle('hidden', isM3u);
    };
  });
  
  // Close Modals
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.onclick = () => closeModal(btn.closest('.modal-overlay'));
  });
  
  // Mobile
  $('mobile-menu-btn').onclick = () => $('sidebar').classList.toggle('open');
  
  // Fullscreen
  $('fullscreen-btn').onclick = () => {
    const v = $('video-player');
    if (!document.fullscreenElement) v.requestFullscreen();
    else document.exitFullscreen();
  };
  
  // Load saved
  if (state.currentPlaylistId) loadPlaylist(state.currentPlaylistId);
  else renderChannels();
}

// Start
document.addEventListener('DOMContentLoaded', () => {
  $('login-form').onsubmit = handleLogin;
  $('logout-btn').onclick = handleLogout;
  checkAuth();
});
