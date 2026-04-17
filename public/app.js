const CONFIG = {
  CREDENTIALS: { username: 'admin', password: 'admin123' },
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
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  $('toast-container').appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function escapeHtml(text) {
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
  } catch (e) { console.error(e); }
}

function saveToStorage(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function checkAuth() {
  if (sessionStorage.getItem(CONFIG.STORAGE_KEYS.AUTH)) {
    showApp();
  } else {
    $('login-page').style.display = 'flex';
    $('app-container').classList.remove('active');
  }
}

function showApp() {
  $('login-page').style.display = 'none';
  $('app-container').classList.add('active');
  initializeApp();
}

function handleLogin(e) {
  e.preventDefault();
  const username = $('username').value.trim();
  const password = $('password').value;
  
  if (username === CONFIG.CREDENTIALS.username && password === CONFIG.CREDENTIALS.password) {
    sessionStorage.setItem(CONFIG.STORAGE_KEYS.AUTH, 'true');
    showApp();
    showToast('Welcome to StreamVault');
  } else {
    showToast('Invalid credentials', 'error');
  }
}

function handleLogout() {
  sessionStorage.removeItem(CONFIG.STORAGE_KEYS.AUTH);
  checkAuth();
  showToast('Logged out');
}

function parseM3U(content) {
  const lines = content.split('\n');
  const channels = [];
  let currentChannel = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXTINF:')) {
      const info = trimmed.substring(8);
      const tvgName = info.match(/tvg-name="([^"]*)"/);
      const tvgLogo = info.match(/tvg-logo="([^"]*)"/);
      const group = info.match(/group-title="([^"]*)"/);
      const name = info.match(/,(.+)$/);
      
      currentChannel = {
        id: generateId(),
        name: tvgName?.[1] || name?.[1]?.trim() || 'Unknown',
        logo: tvgLogo?.[1] || '',
        category: group?.[1] || 'Uncategorized',
        url: ''
      };
    } else if (trimmed && !trimmed.startsWith('#') && currentChannel) {
      currentChannel.url = trimmed;
      channels.push(currentChannel);
      currentChannel = null;
    }
  }
  return channels;
}

async function fetchM3UPlaylist(url) {
  const response = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`);
  if (!response.ok) throw new Error('Failed to fetch');
  return parseM3U(await response.text());
}

async function fetchXtreamChannels(server, user, pass) {
  const response = await fetch(`/api/xtream/streams?server=${encodeURIComponent(server)}&user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`);
  if (!response.ok) throw new Error('Failed to fetch');
  const data = await response.json();
  
  return data.map(ch => ({
    id: generateId(),
    name: ch.name || 'Unknown',
    logo: ch.stream_icon || '',
    category: ch.category_name || 'Uncategorized',
    url: `${server.replace(/\/$/, '')}/live/${user}/${pass}/${ch.stream_id}.m3u8`
  }));
}

async function addPlaylist(type, data) {
  const playlist = {
    id: generateId(),
    type,
    name: data.name,
    addedAt: Date.now(),
    ...(type === 'm3u' ? { url: data.url } : { server: data.server, user: data.user, pass: data.pass })
  };
  
  state.playlists.push(playlist);
  saveToStorage(CONFIG.STORAGE_KEYS.PLAYLISTS, state.playlists);
  renderPlaylistsNav();
  await loadPlaylist(playlist.id);
}

async function loadPlaylist(playlistId) {
  const playlist = state.playlists.find(p => p.id === playlistId);
  if (!playlist) return;
  
  state.currentPlaylistId = playlistId;
  localStorage.setItem(CONFIG.STORAGE_KEYS.LAST_PLAYLIST, playlistId);
  
  $('loading-state').classList.remove('hidden');
  $('channel-grid').innerHTML = '';
  
  try {
    let channels = [];
    if (playlist.type === 'm3u') {
      channels = await fetchM3UPlaylist(playlist.url);
    } else {
      channels = await fetchXtreamChannels(playlist.server, playlist.user, playlist.pass);
    }
    
    channels = [...channels, ...state.customChannels];
    state.channels = channels;
    state.filteredChannels = channels;
    state.categories = new Set(channels.map(c => c.category).filter(Boolean));
    
    updateCategoryFilter();
    renderPlaylistsNav();
    renderChannels();
    showToast(`Loaded ${channels.length} channels`);
  } catch (error) {
    showToast(error.message || 'Failed to load', 'error');
  } finally {
    $('loading-state').classList.add('hidden');
  }
}

function deletePlaylist(playlistId) {
  state.playlists = state.playlists.filter(p => p.id !== playlistId);
  saveToStorage(CONFIG.STORAGE_KEYS.PLAYLISTS, state.playlists);
  if (state.currentPlaylistId === playlistId) {
    state.currentPlaylistId = null;
    state.channels = [...state.customChannels];
    renderChannels();
  }
  renderPlaylistsNav();
  showToast('Playlist deleted');
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
  applyFilters();
  renderChannels();
  showToast('Channel added');
}

function deleteCustomChannel(channelId) {
  state.customChannels = state.customChannels.filter(c => c.id !== channelId);
  saveToStorage(CONFIG.STORAGE_KEYS.CUSTOM, state.customChannels);
  state.channels = state.channels.filter(c => c.id !== channelId);
  applyFilters();
  renderChannels();
  showToast('Channel deleted');
}

function toggleFavorite(channelId) {
  const index = state.favorites.indexOf(channelId);
  if (index === -1) {
    state.favorites.push(channelId);
    showToast('Added to favorites');
  } else {
    state.favorites.splice(index, 1);
    showToast('Removed from favorites');
  }
  saveToStorage(CONFIG.STORAGE_KEYS.FAVORITES, state.favorites);
  $('favorites-count').textContent = state.favorites.length;
  renderChannels();
}

function addToRecent(channel) {
  state.recent = state.recent.filter(c => c.id !== channel.id);
  state.recent.unshift(channel);
  if (state.recent.length > CONFIG.MAX_RECENT) state.recent = state.recent.slice(0, CONFIG.MAX_RECENT);
  saveToStorage(CONFIG.STORAGE_KEYS.RECENT, state.recent);
}

function playChannel(channel) {
  state.currentChannel = channel;
  $('player-section').classList.remove('hidden');
  $('player-channel-name').textContent = channel.name;
  $('player-channel-category').textContent = channel.category;
  
  document.querySelectorAll('.channel-card').forEach(card => {
    card.classList.toggle('playing', card.dataset.id === channel.id);
  });
  
  $('player-section').scrollIntoView({ behavior: 'smooth' });
  
  if (Hls.isSupported()) {
    if (state.hls) state.hls.destroy();
    state.hls = new Hls();
    state.hls.loadSource(channel.url);
    state.hls.attachMedia($('video-player'));
    state.hls.on(Hls.Events.MANIFEST_PARSED, () => $('video-player').play().catch(() => {}));
  } else if ($('video-player').canPlayType('application/vnd.apple.mpegurl')) {
    $('video-player').src = channel.url;
    $('video-player').play().catch(() => {});
  }
  
  addToRecent(channel);
}

function applyFilters() {
  let channels = state.currentSection === 'favorites' 
    ? state.channels.filter(c => state.favorites.includes(c.id))
    : state.currentSection === 'recent' 
      ? state.recent 
      : state.currentSection === 'custom'
        ? state.customChannels
        : state.channels;
  
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    channels = channels.filter(c => c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q));
  }
  
  if (state.categoryFilter) {
    channels = channels.filter(c => c.category === state.categoryFilter);
  }
  
  state.filteredChannels = channels;
}

function updateCategoryFilter() {
  const current = $('category-filter').value;
  $('category-filter').innerHTML = '<option value="">All Categories</option>';
  Array.from(state.categories).sort().forEach(cat => {
    $('category-filter').innerHTML += `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`;
  });
  if (state.categories.has(current)) $('category-filter').value = current;
}

function renderChannels() {
  applyFilters();
  $('channel-grid').innerHTML = '';
  $('channel-count').textContent = `${state.filteredChannels.length} channels`;
  
  if (state.filteredChannels.length === 0) {
    $('empty-state').classList.remove('hidden');
    return;
  }
  
  $('empty-state').classList.add('hidden');
  
  state.filteredChannels.forEach((channel, i) => {
    const card = document.createElement('div');
    card.className = 'channel-card';
    card.dataset.id = channel.id;
    if (state.currentChannel?.id === channel.id) card.classList.add('playing');
    
    const isFav = state.favorites.includes(channel.id);
    
    card.innerHTML = `
      <div class="channel-logo">
        ${channel.logo ? `<img src="${escapeHtml(channel.logo)}" alt="" onerror="this.style.display='none'">` : ''}
      </div>
      <div class="channel-name">${escapeHtml(channel.name)}</div>
      <div class="channel-category">${escapeHtml(channel.category)}</div>
      <div class="channel-actions">
        <button class="channel-action-btn favorite ${isFav ? 'active' : ''}" data-action="fav">♥</button>
        <button class="channel-action-btn" data-action="copy">📋</button>
        ${channel.isCustom ? '<button class="channel-action-btn" data-action="delete">🗑</button>' : ''}
      </div>
    `;
    
    card.addEventListener('click', e => {
      if (e.target.closest('.channel-actions')) return;
      playChannel(channel);
    });
    
    card.querySelector('[data-action="fav"]')?.addEventListener('click', e => { e.stopPropagation(); toggleFavorite(channel.id); });
    card.querySelector('[data-action="copy"]')?.addEventListener('click', e => { e.stopPropagation(); navigator.clipboard.writeText(channel.url); showToast('URL copied'); });
    card.querySelector('[data-action="delete"]')?.addEventListener('click', e => { e.stopPropagation(); deleteCustomChannel(channel.id); });
    
    $('channel-grid').appendChild(card);
  });
}

function renderPlaylistsNav() {
  $('playlists-nav').innerHTML = state.playlists.map(p => `
    <div class="playlist-item ${p.id === state.currentPlaylistId ? 'active' : ''}" data-id="${p.id}">
      <div class="playlist-item-info">
        <div class="playlist-item-name">${escapeHtml(p.name)}</div>
        <div class="playlist-item-type">${p.type.toUpperCase()}</div>
      </div>
    </div>
  `).join('');
  
  $('playlists-nav').querySelectorAll('.playlist-item').forEach(item => {
    item.addEventListener('click', () => loadPlaylist(item.dataset.id));
  });
}

function setSection(section) {
  state.currentSection = section;
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.classList.toggle('active', item.dataset.section === section);
  });
  const titles = { all: 'All Channels', favorites: 'Favorites', recent: 'Recently Played', custom: 'Custom Channels' };
  $('section-title-text').textContent = titles[section] || 'Channels';
  renderChannels();
}

function openModal(modal) { modal.classList.add('active'); }
function closeModal(modal) { modal.classList.remove('active'); }

function handlePlaylistSave() {
  const isM3u = document.querySelector('.modal-tab.active').dataset.tab === 'm3u';
  
  if (isM3u) {
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
  
  ['playlist-name', 'm3u-url', 'xtream-name', 'xtream-server', 'xtream-user', 'xtream-pass'].forEach(id => $(id).value = '');
  closeModal($('playlist-modal'));
}

function handleCustomSave() {
  const name = $('custom-name').value.trim();
  const url = $('custom-url').value.trim();
  if (!name || !url) return showToast('Name and URL required', 'error');
  addCustomChannel({ name, url, logo: $('custom-logo').value.trim(), category: $('custom-category').value.trim() });
  ['custom-name', 'custom-url', 'custom-logo', 'custom-category'].forEach(id => $(id).value = '');
  closeModal($('custom-modal'));
}

function initializeApp() {
  loadFromStorage();
  $('favorites-count').textContent = state.favorites.length;
  renderPlaylistsNav();
  
  $('login-form').addEventListener('submit', handleLogin);
  $('logout-btn').addEventListener('click', handleLogout);
  $('mobile-menu-btn').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', () => setSection(item.dataset.section));
  });
  
  $('search-input').addEventListener('input', debounce(e => { state.searchQuery = e.target.value; renderChannels(); }, CONFIG.DEBOUNCE_DELAY));
  $('category-filter').addEventListener('change', e => { state.categoryFilter = e.target.value; renderChannels(); });
  
  $('add-playlist-btn').addEventListener('click', () => openModal($('playlist-modal')));
  $('save-playlist-btn').addEventListener('click', handlePlaylistSave);
  
  document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const isM3u = tab.dataset.tab === 'm3u';
      $('m3u-tab').classList.toggle('hidden', !isM3u);
      $('xtream-tab').classList.toggle('hidden', isM3u);
    });
  });
  
  $('add-custom-btn').addEventListener('click', () => openModal($('custom-modal')));
  $('save-custom-btn').addEventListener('click', handleCustomSave);
  
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.closest('.modal-overlay')));
  });
  
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(modal); });
  });
  
  $('fullscreen-btn').addEventListener('click', () => {
    if (!document.fullscreenElement) $('video-player').requestFullscreen();
    else document.exitFullscreen();
  });
  
  if (state.currentPlaylistId) loadPlaylist(state.currentPlaylistId);
  else if (state.customChannels.length) {
    state.channels = [...state.customChannels];
    state.filteredChannels = state.channels;
    state.categories = new Set(state.channels.map(c => c.category).filter(Boolean));
    updateCategoryFilter();
    renderChannels();
  } else {
    renderChannels();
  }
}

document.addEventListener('DOMContentLoaded', checkAuth);
