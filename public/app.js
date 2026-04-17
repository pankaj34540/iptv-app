// Wait for DOM to load
document.addEventListener('DOMContentLoaded', function() {
  console.log('App initialized!');
  
  // Config
  var CONFIG = {
    CREDENTIALS: { username: 'admin', password: 'admin123' },
    STORAGE_KEYS: {
      PLAYLISTS: 'iptv_playlists',
      FAVORITES: 'iptv_favorites',
      RECENT: 'iptv_recent',
      CUSTOM: 'iptv_custom',
      AUTH: 'iptv_auth'
    }
  };
  
  // Get elements
  var loginPage = document.getElementById('login-page');
  var appContainer = document.getElementById('app-container');
  var loginForm = document.getElementById('login-form');
  var usernameInput = document.getElementById('username');
  var passwordInput = document.getElementById('password');
  
  // Check auth
  function checkAuth() {
    var isAuth = sessionStorage.getItem(CONFIG.STORAGE_KEYS.AUTH);
    if (isAuth === 'true') {
      showApp();
    } else {
      showLogin();
    }
  }
  
  function showLogin() {
    loginPage.style.display = 'flex';
    appContainer.classList.remove('active');
  }
  
  function showApp() {
    loginPage.style.display = 'none';
    appContainer.classList.add('active');
  }
  
  // Handle login
  function handleLogin(e) {
    e.preventDefault();
    var username = usernameInput.value.trim();
    var password = passwordInput.value;
    
    console.log('Login attempt:', username);
    
    if (username === CONFIG.CREDENTIALS.username && password === CONFIG.CREDENTIALS.password) {
      sessionStorage.setItem(CONFIG.STORAGE_KEYS.AUTH, 'true');
      showApp();
      alert('Login successful! Welcome to StreamVault');
    } else {
      alert('Invalid username or password!\n\nUsername: admin\nPassword: admin123');
    }
  }
  
  // Attach event listener
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
    console.log('Login form listener attached');
  } else {
    console.error('Login form not found!');
  }
  
  // Logout
  var logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function() {
      sessionStorage.removeItem(CONFIG.STORAGE_KEYS.AUTH);
      checkAuth();
    });
  }
  
  // Initialize
  checkAuth();
});
