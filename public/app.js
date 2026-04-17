// StreamVault IPTV App - Complete Code

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
  const loginPage = $('login-page');
  const appContainer = $('app-container');
  if (loginPage) loginPage.style.display = 'flex';
  if (appContainer) appContainer.classList.remove('active');
}

function showApp() {
  const loginPage = $('login-page');
  const appContainer = $('app-container');
  if (loginPage) loginPage.style.display = 'none';
  if (appContainer) appContainer.classList.add('active');
  initializeApp();
}

function handleLogin(e) {
  e.preventDefault();
  const username = $('username')?.value.trim() || '';
  const password = $('password')?.value || '';
  
  if (username === CONFIG.CREDENTIALS.username && password === CONFIG.CREDENTIALS.password) {
    sessionStorage.setItem(CONFIG.STORAGE_KEYS.AUTH, 'true');
    showApp();
    showToast('Welcome to StreamVault!');
  } else {
    showToast('Invalid credentials!', 'error');
  }
}

function handleLogout() {
  sessionStorage.removeItem(CONFIG.STORAGE_KEYS.AUTH);
  state.channels = [];
  state.filteredChannels = [];
  checkAuth();
  showToast('Logged out successfully');
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
  try {
    const response = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`);
    if (!response.ok) throw new Error('Failed to fetch playlist');
    const text = await response.text();
    return parseM3U(text);
  } catch (e) {
    console.error('M3U fetch error:', e);
    throw e;
  }
}

async function fetchXtreamChannels(server, user, pass) {
  try {
    const response = await fetch(`/api/xtream/streams?server=${encodeURIComponent(server)}&user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`);
    if (!response.ok) throw new Error('Failed to fetch channels');
    const data = await response.json();
    
    if (!Array.isArray(data)) throw new Error('Invalid response from server');
    
    return data.map(ch => ({
      id: generateId(),
      name: ch.name || 'Unknown',
      logo: ch.stream_icon || '',
      category: ch.category_name || 'Uncategorized',
      url: `${server.replace(/\/$/, '')}/live/${user}/${pass}/${ch.stream_id}.m3u8`
    }));
  } catch (e) {
    console.error('Xtream fetch error:', e);
    throw e;
  }
}

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

async function loadPlaylist(playlistId) {
  const playlist = state.playlists.find(p => p.id === playlistId);
  if (!playlist) return;
  
  state.currentPlaylistId = playlistId;
  localStorage.setItem(CONFIG.STORAGE_KEYS.LAST_PLAYLIST, playlistId);
  
  showLoading(true);
  
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
    showToast(`Loaded ${channels.length} channels from ${playlist.name}`);
  } catch (error) {
    console.error('Load playlist error:', error);
    showToast(error.message || 'Failed to load playlist', 'error');
  } finally {
    showLoading(false);
  }
}

function showLoading(show) {
  const loader = $('loading-state');
  if (loader) loader.classList.toggle('hidden', !show);
}

function deletePlaylist(playlistId) {
  state.playlists = state.playlists.filter(p => p.id !== playlistId);
  saveToStorage(CONFIG.STORAGE_KEYS.PLAYLISTS, state.playlists);
  
  if (state.currentPlaylistId === playlistId) {
    state.currentPlaylistId = null;
    state.channels = [...state.customChannels];
    state.filteredChannels = state.channels;
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
  showToast('Custom channel added');
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
  updateFavoritesCount();
  renderChannels();
}

function updateFavoritesCount() {
  const el = $('favorites-count');
  if (el) el.textContent = state.favorites.length;
}

function addToRecent(channel) {
  state.recent = state.recent.filter(c => c.id !== channel.id);
  state.recent.unshift(channel);
  if (state.recent.length > CONFIG.MAX_RECENT) {
    state.recent = state.recent.slice(0, CONFIG.MAX_RECENT);
  }
  saveToStorage(CONFIG.STORAGE_KEYS.RECENT, state.recent);
}

function playChannel(channel) {
  state.currentChannel = channel;
  
  const playerSection = $('player-section');
  const playerChannelName = $('player-channel-name');
  const playerChannelCategory = $('player-channel-category');
  const videoPlayer = $('video-player');
  
  if (playerSection) playerSection.classList.remove('hidden');
  if (playerChannelName) playerChannelName.textContent = channel.name;
  if (playerChannelCategory) playerChannelCategory.textContent = channel.category;
  
  document.querySelectorAll('.channel-card').forEach(card => {
    card.classList.toggle('playing', card.dataset.id === channel.id);
  });
  
  if (playerSection) {
    playerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  
  if (videoPlayer) {
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      if (state.hls) state.hls.destroy();
      state.hls = new Hls();
      state.hls.loadSource(channel.url);
      state.hls.attachMedia(videoPlayer);
      state.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoPlayer.play().catch(() => {});
      });
      state.hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.error('HLS Error:', data);
          showToast('Stream playback error', 'error');
        }
      });
    } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
      videoPlayer.src = channel.url;
      videoPlayer.play().catch(() => {});
    }
  }
  
  addToRecent(channel);
}

function applyFilters() {
  let channels = [];
  
  if (state.currentSection === 'favorites') {
    channels = state.channels.filter(c => state.favorites.includes(c.id));
  } else if (state.currentSection === 'recent') {
    channels = state.recent;
  } else if (state.currentSection === 'custom') {
    channels = state.customChannels;
  } else {
    channels = state.channels;
  }
  
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    channels = channels.filter(c => 
      (c.name && c.name.toLowerCase().includes(q)) || 
      (c.category && c.category.toLowerCase().includes(q))
    );
  }
  
  if (state.categoryFilter) {
    channels = channels.filter(c => c.category === state.categoryFilter);
  }
  
  state.filteredChannels = channels;
}

function updateCategoryFilter() {
  const filter = $('category-filter');
  if (!filter) return;
  
  const current = filter.value;
  filter.innerHTML = '<option value="">All Categories</option>';
  
  Array.from(state.categories).sort().forEach(cat => {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = cat;
    filter.appendChild(option);
  });
  
  if (state.categories.has(current)) filter.value = current;
}

function renderChannels() {
  applyFilters();
  
  const grid = $('channel-grid');
  const emptyState = $('empty-state');
  const channelCount = $('channel-count');
  
  if (!grid) return;
  
  grid.innerHTML = '';
  
  if (channelCount) {
    channelCount.textContent = `${state.filteredChannels.length} channels`;
  }
  
  if (state.filteredChannels.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }
  
  if (emptyState) emptyState.classList.add('hidden');
  
  state.filteredChannels.forEach(channel => {
    const card = createChannelCard(channel);
    grid.appendChild(card);
  });
}

function createChannelCard(channel) {
  const card = document.createElement('div');
  card.className = 'channel-card';
  card.dataset.id = channel.id;
  
  if (state.currentChannel && state.currentChannel.id === channel.id) {
    card.classList.add('playing');
  }
  
  const isFav = state.favorites.includes(channel.id);
  
  card.innerHTML = `
    <div class="channel-logo">
      ${channel.logo ? `<img src="${escapeHtml(channel.logo)}" alt="" onerror="this.style.display='none'">` : ''}
    </div>
    <div class="channel-info">
      <div class="channel-name">${escapeHtml(channel.name)}</div>
      <div class="channel-category">${escapeHtml(channel.category)}</div>
    </div>
    <div class="channel-actions">
      <button class="channel-action-btn favorite ${isFav ? 'active' : ''}" data-action="fav" title="Favorite">♥</button>
      <button class="channel-action-btn" data-action="copy" title="Copy URL">📋</button>
      ${channel.isCustom ? '<button class="channel-action-btn" data-action="delete" title="Delete">🗑</button>' : ''}
    </div>
  `;
  
  card.addEventListener('click', (e) => {
    if (e.target.closest('.channel-actions')) return;
    playChannel(channel);
  });
  
  const favBtn = card.querySelector('[data-action="fav"]');
  if (favBtn) {
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(channel.id);
    });
  }
  
  const copyBtn = card.querySelector('[data-action="copy"]');
  if (copyBtn) {
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(channel.url).then(() => {
        showToast('URL copied to clipboard');
      }).catch(() => {
        showToast('Failed to copy', 'error');
      });
    });
  }
  
  const deleteBtn = card.querySelector('[data-action="delete"]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCustomChannel(channel.id);
    });
  }
  
  return card;
}

function renderPlaylistsNav() {
  const container = $('playlists-nav');
  if (!container) return;
  
  container.innerHTML = state.playlists.map(p => `
    <div class="playlist-item ${p.id === state.currentPlaylistId ? 'active' : ''}" data-id="${p.id}">
      <div class="playlist-item-info">
        <div class="playlist-item-name">${escapeHtml(p.name)}</div>
        <div class="playlist-item-type">${p.type.toUpperCase()}</div>
      </div>
    </div>
  `).join('');
  
  container.querySelectorAll('.playlist-item').forEach(item => {
    item.addEventListener('click', () => loadPlaylist(item.dataset.id));
  });
}

function setSection(section) {
  state.currentSection = section;
  
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.classList.toggle('active', item.dataset.section === section);
  });
  
  const titles = {
    all: 'All Channels',
    favorites: 'Favorites',
    recent: 'Recently Played',
    custom: 'Custom Channels'
  };
  
  const titleEl = $('section-title-text');
  if (titleEl) titleEl.textContent = titles[section] || 'Channels';
  
  renderChannels();
}

function openModal(modal) {
  if (modal) modal.classList.add('active');
}

function closeModal(modal) {
  if (modal) modal.classList.remove('active');
}

function handlePlaylistSave() {
  const activeTab = document.querySelector('.modal-tab.active');
  const isM3u = activeTab && activeTab.dataset.tab === 'm3u';
  
  if (isM3u) {
    const name = $('playlist-name')?.value.trim();
    const url = $('m3u-url')?.value.trim();
    
    if (!name || !url) {
      showToast('Please fill all fields', 'error');
      return;
    }
    
    addPlaylist('m3u', { name, url });
    
    if ($('playlist-name')) $('playlist-name').value = '';
    if ($('m3u-url')) $('m3u-url').value = '';
  } else {
    const name = $('xtream-name')?.value.trim();
    const server = $('xtream-server')?.value.trim();
    const user = $('xtream-user')?.value.trim();
    const pass = $('xtream-pass')?.value;
    
    if (!name || !server || !user || !pass) {
      showToast('Please fill all fields', 'error');
      return;
    }
    
    addPlaylist('xtream', { name, server, user, pass });
    
    if ($('xtream-name')) $('xtream-name').value = '';
    if ($('xtream-server')) $('xtream-server').value = '';
    if ($('xtream-user')) $('xtream-user').value = '';
    if ($('xtream-pass')) $('xtream-pass').value = '';
  }
  
  closeModal($('playlist-modal'));
}

function handleCustomSave() {
  const name = $('custom-name')?.value.trim();
  const url = $('custom-url')?.value.trim();
  const logo = $('custom-logo')?.value.trim();
  const category = $('custom-category')?.value.trim();
  
  if (!name || !url) {
    showToast('Name and URL are required', 'error');
    return;
  }
  
  addCustomChannel({ name, url, logo, category });
  
  if ($('custom-name')) $('custom-name').value = '';
  if ($('custom-url')) $('custom-url').value = '';
  if ($('custom-logo')) $('custom-logo').value = '';
  if ($('custom-category')) $('custom-category').value = '';
  
  closeModal($('custom-modal'));
}

function initializeApp() {
  loadFromStorage();
  updateFavoritesCount();
  renderPlaylistsNav();
  
  // Navigation
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', () => setSection(item.dataset.section));
  });
  
  // Search
  const searchInput = $('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', debounce((e) => {
      state.searchQuery = e.target.value;
      renderChannels();
    }, CONFIG.DEBOUNCE_DELAY));
  }
  
  // Category filter
  const categoryFilter = $('category-filter');
  if (categoryFilter) {
    categoryFilter.addEventListener('change', (e) => {
      state.categoryFilter = e.target.value;
      renderChannels();
    });
  }
  
  // Modals
  const addPlaylistBtn = $('add-playlist-btn');
  if (addPlaylistBtn) {
    addPlaylistBtn.addEventListener('click', () => openModal($('playlist-modal')));
  }
  
  const savePlaylistBtn = $('save-playlist-btn');
  if (savePlaylistBtn) {
    savePlaylistBtn.addEventListener('click', handlePlaylistSave);
  }
  
  const addCustomBtn = $('add-custom-btn');
  if (addCustomBtn) {
    addCustomBtn.addEventListener('click', () => openModal($('custom-modal')));
  }
  
  const saveCustomBtn = $('save-custom-btn');
  if (saveCustomBtn) {
    saveCustomBtn.addEventListener('click', handleCustomSave);
  }
  
  // Modal tabs
  document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      const isM3u = tab.dataset.tab === 'm3u';
      const m3uTab = $('m3u-tab');
      const xtreamTab = $('xtream-tab');
      
      if (m3uTab) m3uTab.classList.toggle('hidden', !isM3u);
      if (xtreamTab) xtreamTab.classList.toggle('hidden', isM3u);
    });
  });
  
  // Close modals
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-overlay');
      closeModal(modal);
    });
  });
  
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal);
    });
  });
  
  // Mobile menu
  const mobileMenuBtn = $('mobile-menu-btn');
  const sidebar = $('sidebar');
  if (mobileMenuBtn && sidebar) {
    mobileMenuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }
  
  // Fullscreen
  const fullscreenBtn = $('fullscreen-btn');
  const videoPlayer = $('video-player');
  if (fullscreenBtn && videoPlayer) {
    fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        videoPlayer.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen();
      }
    });
  }
  
  // Load saved playlist or show custom channels
  if (state.currentPlaylistId) {
    loadPlaylist(state.currentPlaylistId);
  } else if (state.customChannels.length > 0) {
    state.channels = [...state.customChannels];
    state.filteredChannels = state.channels;
    state.categories = new Set(state.channels.map(c => c.category).filter(Boolean));
    updateCategoryFilter();
    renderChannels();
  } else {
    renderChannels();
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Login form
  const loginForm = $('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }
  
  // Logout button
  const logoutBtn = $('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }
  
  // Check auth status
  checkAuth();
});
