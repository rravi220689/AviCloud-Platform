const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const httpProxy = require('http-proxy');
const { WebSocketServer } = require('ws');
const config = require('./src/config');
const db = require('./src/db');
const storage = require('./src/storage');
const system = require('./src/system');
const tunnel = require('./src/tunnel');
const storageShareManager = require('./src/storageShareManager');
const webdav = require('./src/webdav');
const apiRoutes = require('./src/api');
const { startReverseProxy } = require('./src/proxy');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Create internal proxy instance for URL rewrites and domain virtual hosts
const rewriterProxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
  xfwd: true,
  autoRewrite: true
});

rewriterProxy.on('error', (err, req, res) => {
  console.error('[AviCloud Proxy Error]', err.message);
  if (res && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/html' });
    res.end(`
      <html><body style="background:#0f172a;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center;padding:2rem;background:#1e293b;border-radius:1rem;border:1px solid #334155;">
          <h2 style="color:#f43f5e;margin-top:0;">Target Service Unavailable</h2>
          <p style="color:#94a3b8;font-size:0.9rem;">The destination port or server is not reachable right now.</p>
          <pre style="color:#cbd5e1;background:#0f172a;padding:0.75rem;border-radius:0.5rem;font-size:0.8rem;">${err.message}</pre>
          <a href="/" style="display:inline-block;margin-top:1rem;color:#38bdf8;text-decoration:none;font-weight:bold;">&larr; Back to AviCloud</a>
        </div>
      </body></html>
    `);
  }
});

// -------------------------------------------------------------
// 1. WebDAV Authenticated Network Cloud Drive (/webdav)
// (Must be mounted before body parsers to allow streaming PUT uploads)
// -------------------------------------------------------------
app.all('/webdav*', webdav.authBasic, webdav.handleWebDAV);

// Middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// -------------------------------------------------------------
// 2. Custom Domain Virtual Host Routing on Port 9000
// -------------------------------------------------------------
app.use((req, res, next) => {
  const hostHeader = (req.headers.host || '').split(':')[0].toLowerCase();
  
  // If host is a custom domain registered in AviCloud (and not localhost / bare IP unless routed)
  if (hostHeader && hostHeader !== 'localhost' && hostHeader !== '127.0.0.1') {
    const domainRecord = db.getDomainByName(hostHeader);
    if (domainRecord && domainRecord.is_active) {
      db.incrementDomainHits(domainRecord.id);
      return rewriterProxy.web(req, res, { target: domainRecord.target_url });
    }
  }
  next();
});

// -------------------------------------------------------------
// 3. Universal URL Rewriter & Top-Level Vanity Path Interceptor
// -------------------------------------------------------------
const RESERVED_PREFIXES = ['/api', '/s', '/ws', '/webdav', '/outside', '/style.css', '/app.js', '/favicon.ico'];

app.use((req, res, next) => {
  const reqPath = req.path;
  if (RESERVED_PREFIXES.some(p => reqPath === p || reqPath.startsWith(p + '/'))) {
    return next();
  }

  const match = db.findMatchingRewrite(reqPath);
  if (match) {
    db.incrementRedirectHits(match.id);

    if (match.redirect_type === 'proxy') {
      const targetBase = match.target_url.replace(/\/+$/, '');
      const subPath = reqPath.slice(match.matchedPrefix.length);
      const targetFullPath = targetBase + (subPath.startsWith('/') ? subPath : (subPath ? '/' + subPath : ''));

      req.url = subPath || '/';
      return rewriterProxy.web(req, res, { target: targetBase });
    } else if (match.redirect_type === '301') {
      return res.redirect(301, match.target_url);
    } else if (match.redirect_type === '302') {
      return res.redirect(302, match.target_url);
    } else if (match.redirect_type === 'iframe') {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>${match.description || match.slug}</title><style>body,html,iframe{margin:0;padding:0;height:100%;width:100%;overflow:hidden;border:none;}</style></head>
        <body><iframe src="${match.target_url}"></iframe></body>
        </html>
      `);
    }
  }

  next();
});

// Static Assets
app.use(express.static(path.join(__dirname, 'public')));

// Public File Share Route (/s/:token)
app.get('/s/:token', (req, res) => {
  const { token } = req.params;
  const share = db.getShareByToken(token);

  if (!share) {
    return res.status(404).send(`
      <html><body style="background:#0f172a;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center;padding:2rem;background:#1e293b;border-radius:1rem;border:1px solid #334155;">
          <h2 style="color:#f43f5e;margin-top:0;">404 - Share Link Not Found</h2>
          <p style="color:#94a3b8;font-size:0.9rem;">This link does not exist or has expired.</p>
        </div>
      </body></html>
    `);
  }

  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return res.status(410).send(`
      <html><body style="background:#0f172a;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center;padding:2rem;background:#1e293b;border-radius:1rem;border:1px solid #334155;">
          <h2 style="color:#fbbf24;margin-top:0;">Share Link Expired</h2>
          <p style="color:#94a3b8;font-size:0.9rem;">This download link has passed its expiration date.</p>
        </div>
      </body></html>
    `);
  }

  const cleanRelPath = share.file_path.replace(/^\/+/, '');
  const fullPath = path.join(config.STORAGE_ROOT, cleanRelPath);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).send('File not found on storage pool');
  }

  const stat = fs.statSync(fullPath);
  const fileName = path.basename(fullPath);
  const sizeFormatted = storage.formatBytes(stat.size);

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>AviCloud Public Share — ${fileName}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body class="bg-slate-950 text-slate-100 flex items-center justify-center min-h-screen p-4">
      <div class="max-w-md w-full p-8 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-2xl backdrop-blur text-center">
        <div class="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center mx-auto mb-4 text-3xl">
          <i class="fa-solid fa-cloud-arrow-down"></i>
        </div>
        <h2 class="text-xl font-bold text-white truncate mb-1" title="${fileName}">${fileName}</h2>
        <p class="text-xs text-slate-400 mb-6 font-mono">${stat.isDirectory() ? 'Folder / Archive' : sizeFormatted}</p>

        <form method="POST" action="/s/${token}/download" class="space-y-4">
          ${share.password_hash ? `
            <div class="text-left">
              <label class="block text-xs font-semibold uppercase text-slate-400 mb-1">Password Protected</label>
              <input type="password" name="password" required placeholder="Enter share password" class="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-100 text-xs focus:outline-none focus:border-cyan-500">
            </div>
          ` : ''}

          <button type="submit" class="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold rounded-xl text-sm shadow-lg shadow-cyan-500/20 transition flex items-center justify-center gap-2">
            <i class="fa-solid fa-download"></i> Download File
          </button>
        </form>

        <div class="mt-6 pt-4 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
          <span>AviCloud Storage Pool</span>
          <span>Downloads: ${share.downloads_count}</span>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.post('/s/:token/download', (req, res) => {
  const { token } = req.params;
  const { password } = req.body;
  const share = db.getShareByToken(token);

  if (!share) return res.status(404).send('Share link not found');

  if (share.password_hash) {
    if (!password || !db.verifyPassword(password, share.password_hash)) {
      return res.status(401).send('Incorrect password for share link');
    }
  }

  db.incrementShareDownload(token);
  const cleanRelPath = share.file_path.replace(/^\/+/, '');
  const fullPath = path.join(config.STORAGE_ROOT, cleanRelPath);

  if (!fs.existsSync(fullPath)) return res.status(404).send('File not found');

  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    storage.streamZipFolder(fullPath, res);
  } else {
    res.download(fullPath);
  }
});

// Quick Outside Route (/outside) -> Redirects to live public tunnel
app.get('/outside', (req, res) => {
  const liveUrl = tunnel.getTunnelStatus().url;
  if (liveUrl) {
    res.redirect(302, liveUrl);
  } else {
    res.send(`<html><body style="background:#0f172a;color:#f8fafc;font-family:sans-serif;padding:2rem;text-align:center;"><h2>Starting outside tunnel...</h2><script>setTimeout(()=>window.location.reload(), 3000);</script></body></html>`);
  }
});

// API Routes
app.use('/api', apiRoutes);

// Fallback to Dashboard
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// -------------------------------------------------------------
// Real-time Telemetry & WebSockets
// -------------------------------------------------------------
function broadcastTelemetry() {
  if (wss.clients.size === 0) return;

  const metrics = system.getSystemMetrics();
  const tunnelStatus = tunnel.getTunnelStatus();
  const payload = JSON.stringify({
    type: 'telemetry',
    metrics,
    tunnel: tunnelStatus,
    timestamp: new Date().toISOString()
  });

  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(payload);
  });
}

setInterval(broadcastTelemetry, 2500);

// Notify WebSocket clients when Tunnel URL changes
tunnel.setUrlChangeCallback((newUrl) => {
  console.log(`[AviCloud Broadcast] Cloudflare Tunnel Updated -> ${newUrl}`);
  broadcastTelemetry();
});

// -------------------------------------------------------------
// Start Server & Subsystems
// -------------------------------------------------------------
server.listen(config.PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log('🚀 AviCloud Platform is running!');
  console.log(`📊 Web Dashboard: http://localhost:${config.PORT}`);
  console.log(`💾 100 GB Cloud Storage: ${config.STORAGE_ROOT}`);
  console.log('====================================================');

  // Launch 24/7 background Cloudflare tunnel
  console.log('[AviCloud Startup] Launching 24/7 background Cloudflare tunnel...');
  tunnel.startTunnel('cloudflare', config.PORT);

  // Initialize Authenticated Samba & NFS Storage Servers
  console.log('[AviCloud Startup] Initializing Samba (SMB) and NFS Servers...');
  storageShareManager.startSamba('avinash', 'Avinash@Cloud1989');
  storageShareManager.startNfs();

  // Launch Dynamic Reverse Proxy on Port 9080
  startReverseProxy();
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('AviCloud shutting down...');
  tunnel.stopTunnel();
  server.close(() => process.exit(0));
});
