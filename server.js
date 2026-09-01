const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { WebSocketServer } = require('ws');
const mime = require('mime-types');

const config = require('./src/config');
const db = require('./src/db');
const apiRoutes = require('./src/api');
const proxy = require('./src/proxy');
const storage = require('./src/storage');
const system = require('./src/system');
const tunnel = require('./src/tunnel');

// Initialize database
db.initDatabase();

const app = express();

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Fast Shortcut: /outside redirects directly to the current live Cloudflare URL
app.get('/outside', (req, res) => {
  const tunnelStatus = tunnel.getTunnelStatus();
  if (tunnelStatus.url) {
    return res.redirect(302, tunnelStatus.url);
  }
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Tunnel Connecting - AviCloud</title><style>body{font-family:sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;} .card{background:#1e293b;padding:2rem;border-radius:12px;text-align:center;}</style></head>
    <body>
      <div class="card">
        <h2>⚡ Connecting Cloudflare Tunnel...</h2>
        <p>Your outside network URL is initializing. Please refresh in a few seconds.</p>
      </div>
    </body>
    </html>
  `);
});

// Universal URL Redirection Route: /r/:slug
app.get('/r/:slug', (req, res) => {
  const rule = db.getRedirectBySlug(req.params.slug);
  if (!rule) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Redirect Not Found - AviCloud</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}.card{background:#1e293b;padding:2.5rem;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.5);text-align:center;max-width:450px;}h1{color:#ef4444;margin-bottom:0.5rem;}p{color:#94a3b8;}</style></head>
      <body>
        <div class="card">
          <h1>Redirection Rule Not Found</h1>
          <p>No destination configured for slug "<strong>${req.params.slug}</strong>".</p>
        </div>
      </body>
      </html>
    `);
  }

  db.incrementRedirectHits(rule.slug);

  if (rule.redirect_type === 'proxy') {
    return proxy.handleProxyRequest(req, res, rule.target_url);
  } else if (rule.redirect_type === 'iframe') {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>${rule.description || 'AviCloud Embedded Frame'}</title><style>body,html{margin:0;padding:0;height:100%;overflow:hidden;}iframe{border:none;width:100%;height:100%;}</style></head>
      <body><iframe src="${rule.target_url}"></iframe></body>
      </html>
    `);
  } else {
    const statusCode = parseInt(rule.redirect_type || '302', 10);
    return res.redirect(statusCode, rule.target_url);
  }
});

// Serve static frontend dashboard
app.use(express.static(path.join(__dirname, 'public')));

// Public File Share Route: /s/:token
app.get('/s/:token', (req, res) => {
  const share = db.getShareLinkByToken(req.params.token);
  if (!share) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Link Expired or Not Found - AviCloud</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}.card{background:#1e293b;padding:2.5rem;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.5);text-align:center;max-width:450px;}h1{color:#ef4444;margin-bottom:0.5rem;}p{color:#94a3b8;}</style></head>
      <body>
        <div class="card">
          <h1>Link Unavailable</h1>
          <p>This share link does not exist or has been removed by the owner.</p>
        </div>
      </body>
      </html>
    `);
  }

  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return res.status(410).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Link Expired - AviCloud</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}.card{background:#1e293b;padding:2.5rem;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.5);text-align:center;max-width:450px;}h1{color:#f59e0b;margin-bottom:0.5rem;}p{color:#94a3b8;}</style></head>
      <body>
        <div class="card">
          <h1>Share Link Expired</h1>
          <p>The time limit for this shared file has expired.</p>
        </div>
      </body>
      </html>
    `);
  }

  if (share.max_downloads > 0 && share.downloads_count >= share.max_downloads) {
    return res.status(410).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Download Limit Exceeded - AviCloud</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}.card{background:#1e293b;padding:2.5rem;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.5);text-align:center;max-width:450px;}h1{color:#f59e0b;margin-bottom:0.5rem;}p{color:#94a3b8;}</style></head>
      <body>
        <div class="card">
          <h1>Download Limit Reached</h1>
          <p>This file has reached its maximum allowed downloads limit.</p>
        </div>
      </body>
      </html>
    `);
  }

  res.sendFile(path.join(__dirname, 'public', 'share.html'));
});

// Share Info API
app.get('/api/public/share/:token', (req, res) => {
  const share = db.getShareLinkByToken(req.params.token);
  if (!share) return res.status(404).json({ success: false, error: 'Share not found' });

  try {
    const fullPath = storage.resolveSafePath(share.file_path);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, error: 'Shared content has been deleted' });
    }

    const stat = fs.statSync(fullPath);
    res.json({
      success: true,
      name: share.name,
      isDirectory: !!share.is_directory,
      size: stat.size,
      sizeFormatted: share.is_directory ? '--' : storage.formatBytes(stat.size),
      hasPassword: !!share.password_hash,
      downloadsCount: share.downloads_count,
      maxDownloads: share.max_downloads,
      expiresAt: share.expires_at
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Public Share Download
app.get('/s/:token/download', (req, res) => {
  const share = db.getShareLinkByToken(req.params.token);
  if (!share) return res.status(404).send('Share link not found');

  if (share.password_hash) {
    const providedPwd = req.query.pwd || '';
    const hash = db.hashPassword(providedPwd);
    if (hash !== share.password_hash) {
      return res.status(401).send('Password required or incorrect');
    }
  }

  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return res.status(410).send('Share link expired');
  }
  if (share.max_downloads > 0 && share.downloads_count >= share.max_downloads) {
    return res.status(410).send('Download limit exceeded');
  }

  try {
    const fullPath = storage.resolveSafePath(share.file_path);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).send('File not found on storage disk');
    }

    db.incrementShareDownloads(share.token);

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const { spawn } = require('child_process');
      const zipName = `${share.name}.zip`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

      const zipProc = spawn('zip', ['-r', '-', '.'], { cwd: fullPath });
      zipProc.stdout.pipe(res);
    } else {
      const mimeType = mime.lookup(fullPath) || 'application/octet-stream';
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(fullPath)}"`);
      fs.createReadStream(fullPath).pipe(res);
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Mount Main API Routes
app.use('/api', apiRoutes);

// Fallback to Dashboard SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Create Main HTTP Server
const server = http.createServer(app);

// Attach WebSocket Server for Real-Time Telemetry & Logs
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcastTelemetry() {
  const metrics = system.getSystemMetrics();
  const tunnelStatus = tunnel.getTunnelStatus();
  const payload = JSON.stringify({ type: 'telemetry', metrics, tunnel: tunnelStatus });

  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      try { client.send(payload); } catch (_) {}
    }
  });
}

wss.on('connection', (ws) => {
  // Send immediate state
  try {
    const metrics = system.getSystemMetrics();
    const tunnelStatus = tunnel.getTunnelStatus();
    ws.send(JSON.stringify({ type: 'telemetry', metrics, tunnel: tunnelStatus }));
  } catch (_) {}
});

// Regular 2-second heartbeat
setInterval(broadcastTelemetry, 2000);

// Notify WebSocket immediately when Cloudflare tunnel generates a new URL
tunnel.setUrlChangeCallback((newUrl) => {
  console.log(`[AviCloud Broadcast] Cloudflare Tunnel Updated -> ${newUrl}`);
  broadcastTelemetry();
});

// Start Servers
server.listen(config.PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 AviCloud Platform is running!`);
  console.log(`📊 Web Dashboard: http://localhost:${config.PORT}`);
  console.log(`💾 100 GB Cloud Storage: ${config.STORAGE_DIR}`);
  console.log(`====================================================`);

  // Automatically start Cloudflare tunnel in the background
  console.log('[AviCloud Startup] Launching 24/7 background Cloudflare tunnel...');
  tunnel.startTunnel('cloudflare', config.PORT);
});

// Start Dynamic Reverse Proxy on dedicated port
proxy.startProxyServer();

process.on('SIGTERM', () => {
  console.log('AviCloud shutting down...');
  tunnel.stopTunnel();
  server.close();
  process.exit(0);
});
