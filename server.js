const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Fetch URL utility
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const chunks = [];
    
    const req = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*'
      }
    }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        resolve(data);
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// API: Fetch M3U Playlist
app.get('/api/fetch', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter required' });
    }
    
    console.log(`[FETCH] Loading: ${url.substring(0, 50)}...`);
    const data = await fetchUrl(decodeURIComponent(url));
    res.send(data);
  } catch (error) {
    console.error('[ERROR]', error.message);
    res.status(500).json({ error: error.message || 'Failed to fetch playlist' });
  }
});

// API: Xtream Authentication & Channel Fetch
app.get('/api/xtream', async (req, res) => {
  try {
    const { server, user, pass } = req.query;
    
    if (!server || !user || !pass) {
      return res.status(400).json({ error: 'Server, username and password required' });
    }
    
    const cleanServer = server.replace(/\/$/, '');
    const apiUrl = `${cleanServer}/player_api.php?username=${user}&password=${pass}`;
    
    console.log(`[XTREAM] Connecting to: ${cleanServer}`);
    const data = await fetchUrl(apiUrl);
    const json = JSON.parse(data);
    
    if (json.user_info && json.user_info.auth === 0) {
      return res.status(401).json({ error: 'Invalid Xtream credentials' });
    }
    
    res.json(json);
  } catch (error) {
    console.error('[XTREAM ERROR]', error.message);
    res.status(500).json({ error: 'Failed to connect to Xtream server' });
  }
});

// API: Xtream Categories
app.get('/api/xtream/categories', async (req, res) => {
  try {
    const { server, user, pass } = req.query;
    const cleanServer = server.replace(/\/$/, '');
    const apiUrl = `${cleanServer}/player_api.php?username=${user}&password=${pass}&action=get_live_categories`;
    
    const data = await fetchUrl(apiUrl);
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// API: Xtream Streams
app.get('/api/xtream/streams', async (req, res) => {
  try {
    const { server, user, pass, categoryId } = req.query;
    const cleanServer = server.replace(/\/$/, '');
    let apiUrl = `${cleanServer}/player_api.php?username=${user}&password=${pass}&action=get_live_streams`;
    
    if (categoryId) {
      apiUrl += `&category_id=${categoryId}`;
    }
    
    const data = await fetchUrl(apiUrl);
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch streams' });
  }
});

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║     IPTV Server Running                  ║
║     Port: ${PORT}                           ║
║     Login: admin / admin123               ║
╚══════════════════════════════════════════╝
  `);
});
