// StreamVault IPTV App - FINAL VERSION
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
  MAX_RECENT: 20,
  DEBOUNCE_DELAY: 300
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

function debounce(func, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

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
    showToast('Wrong username or password!', 'error');
  }
}

function handleLogout() {
  sessionStorage.removeItem(CONFIG.STORAGE_KEYS.AUTH);
  state.channels = [];
  state.filteredChannels = [];
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
  if (!res.ok) throw new Error('Playlist fetch failed');
  return parseM3U(await res.text());
}

async function fetchXtream(server, user, pass) {
  const res = await fetch(`/api/xtream/streams?server=${encodeURIComponent(server)}&user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`);
  if (!res.ok) throw new Error('Xtream fetch failed');
  const data = await res.json();
  return data.map(ch => ({
    id: generateId(),
    name: ch.name || 'Unknown',
    logo: ch.stream_icon || '',
    category: ch.category_name || 'General',
    url: `${server.replace(/\/$/, '')}/live/${user}/${pass}/${ch.stream_id}.m3u8`
  }));
}

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
    showToast(e.message, 'error');
  } finally {
    showLoading(false);
  }
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
      <button class="btn-icon btn-sm delete-playlist" data-id="${p.id}">🗑</button>
    </div>
  `).join('');
  
  nav.querySelectorAll('.playlist-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-playlist')) {
        e.stopPropagation();
        deletePlaylist(el.dataset.id);
      } else {
        loadPlaylist(el.dataset.id);
      }
    });
  });
}

function deletePlaylist(id) {
  state.playlists = state.playlists.filter(p => p.id !== id);
  saveToStorage(CONFIG.STORAGE_KEYS.PLAYLISTS, state.playlists);
  renderPlaylistsNav();
  showToast('Playlist removed');
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
      <div class="channel-logo">${ch.logo ? `<img src="${escapeHtml(ch.logo)}">` : '📺'}</div>
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
    
    card.querySelector('[data-action="fav"]').onclick = (e) => {
      e.stopPropagation();
      toggleFavorite(ch.id);
    };
    card.querySelector('[data-action="copy"]').onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(ch.url);
      showToast('URL Copied');
    };
    if (card.querySelector('[data-action="del"]')) {
      card.querySelector('[data-action="del"]').onclick = (e) => {
        e.stopPropagation();
        deleteCustomChannel(ch.id);
      };
    }
    grid.appendChild(card);
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
  
  if (Hls && Hls.isSupported()) {
    if (state.hls) state.hls.destroy();
    state.hls = new Hls();
    state.hls.loadSource(ch.url);
    state.hls.attachMedia(player);
    state.hls.on(Hls.Events.MANIFEST_PARSED, () => player.play().catch(() => {}));
    state.hls.on(Hls.Events.ERROR, (e, data) => {
      if (data.fatal) showToast('Stream Offline or Error', 'error');
    });
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

function deleteCustomChannel(id) {
  state.customChannels = state.customChannels.filter(c => c.id !== id);
  saveToStorage(CONFIG.STORAGE_KEYS.CUSTOM, state.customChannels);
  state.channels = state.channels.filter(c => c.id !== id);
  renderChannels();
  showToast('Channel Deleted');
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

function showLoading(show) {
  $('loading-state')?.classList.toggle('hidden', !show);
}

function initializeApp() {
  loadFromStorage();
  $('favorites-count').textContent = state.favorites.length;
  renderPlaylistsNav();
  
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.onclick = () => {
      state.currentSection = item.dataset.section;
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      $('section-title-text').textContent = item.textContent.trim();
      renderChannels();
    };
  });
  
  $('search-input').oninput = debounce(e => {
    state.searchQuery = e.target.value;
    renderChannels();
  }, 300);
  
  $('category-filter').onchange = e => {
    state.categoryFilter = e.target.value;
    renderChannels();
  };
  
  $('add-playlist-btn').onclick = () => openModal($('playlist-modal'));
  $('save-playlist-btn').onclick = handlePlaylistSave;
  $('add-custom-btn').onclick = () => openModal($('custom-modal'));
  $('save-custom-btn').onclick = handleCustomSave;
  
  document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const isM3u = tab.dataset.tab === 'm3u';
      $('m3u-tab').classList.toggle('hidden', !isM3u);
      $('xtream-tab').classList.toggle('hidden', isM3u);
    };
  });
  
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.onclick = () => closeModal(btn.closest('.modal-overlay'));
  });
  
  $('mobile-menu-btn').onclick = () => $('sidebar').classList.toggle('open');
  $('fullscreen-btn').onclick = () => {
    const v = $('video-player');
    if (!document.fullscreenElement) v.requestFullscreen(); else document.exitFullscreen();
  };
  
  if (state.currentPlaylistId) loadPlaylist(state.currentPlaylistId);
  else renderChannels();
}

function handlePlaylistSave() {
  const tab = document.querySelector('.modal-tab.active').dataset.tab;
  if (tab === 'm3u') {
    const name = $('playlist-name').value.trim();
    const url = $('m3u-url').value.trim();
    if (!name || !url) return showToast('Fill all fields', 'error');
    addPlaylist('m3u', { name, url });
  } else {
    const name = $('xtream-name').value.trim();
    const server = $('xtream-server').value.trim();
    const user = $('xtream-user').value.trim();
    const pass = $('xtream-pass').value;
    if (!name || !server || !user || !pass) return showToast('Fill all fields', 'error');
    addPlaylist('xtream', { name, server, user, pass });
  }
  closeModal($('playlist-modal'));
}

function handleCustomSave() {
  const name = $('custom-name').value.trim();
  const url = $('custom-url').value.trim();
  if (!name || !url) return showToast('Name and URL required', 'error');
  addCustomChannel({ name, url, logo: $('custom-logo').value, category: $('custom-category').value });
  closeModal($('custom-modal'));
}

function openModal(m) { m?.classList.add('active'); }
function closeModal(m) { m?.classList.remove('active'); }

document.addEventListener('DOMContentLoaded', () => {
  $('login-form').onsubmit = handleLogin;
  $('logout-btn').onclick = handleLogout;
  checkAuth();
});
