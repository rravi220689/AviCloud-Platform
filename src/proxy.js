const http = require('http');
const httpProxy = require('http-proxy');
const db = require('./db');
const config = require('./config');

const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
  xfwd: true
});

proxy.on('error', (err, req, res) => {
  console.error(`[AviCloud Proxy Error] ${req.url}:`, err.message);
  if (res && !res.headersSent && res.writeHead) {
    res.writeHead(502, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head><title>502 Bad Gateway - AviCloud</title><style>body{font-family:sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}.card{background:#1e293b;padding:2rem;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);text-align:center;max-width:500px;}h1{color:#ef4444;margin-bottom:0.5rem;}p{color:#94a3b8;}</style></head>
      <body>
        <div class="card">
          <h1>502 - Bad Gateway</h1>
          <p>AviCloud Reverse Proxy could not connect to the upstream application service.</p>
          <p style="font-size:0.85rem;color:#64748b;margin-top:1rem;">Target service may be offline or starting up.</p>
        </div>
      </body>
      </html>
    `);
  }
});

function resolveRoute(req) {
  const rawHost = req.headers['x-forwarded-host'] || req.headers['x-original-host'] || req.headers.host || '';
  const host = rawHost.split(',')[0].trim().split(':')[0].toLowerCase();
  
  if (!host) return null;

  // Check database for active domains
  const domainRecord = db.getDomainByName(host);
  if (domainRecord && domainRecord.is_active) {
    return domainRecord;
  }

  return null;
}

function handleProxyRequest(req, res, targetUrl) {
  proxy.web(req, res, { target: targetUrl });
}

function handleProxyUpgrade(req, socket, head, targetUrl) {
  proxy.ws(req, socket, head, { target: targetUrl });
}

// Create dedicated dynamic proxy server
function startProxyServer() {
  const proxyServer = http.createServer((req, res) => {
    const route = resolveRoute(req);
    if (route) {
      db.incrementDomainHits(route.domain_name);
      return handleProxyRequest(req, res, route.target_url);
    }

    // Default fallback page if unmapped domain
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head><title>Unconfigured Domain - AviCloud</title><style>body{font-family:sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}.card{background:#1e293b;padding:2.5rem;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.5);text-align:center;max-width:520px;}h1{color:#38bdf8;margin-bottom:0.5rem;}p{color:#94a3b8;line-height:1.6;}</style></head>
      <body>
        <div class="card">
          <h1>🌐 AviCloud Domain Router</h1>
          <p>The domain <strong>${req.headers.host || 'Unknown'}</strong> is connected to AviCloud but has not been mapped to any application service yet.</p>
          <p>Log in to your <strong>AviCloud Dashboard</strong> on port ${config.PORT} to route this domain to any internal port or container.</p>
        </div>
      </body>
      </html>
    `);
  });

  proxyServer.on('upgrade', (req, socket, head) => {
    const route = resolveRoute(req);
    if (route) {
      return handleProxyUpgrade(req, socket, head, route.target_url);
    }
    socket.destroy();
  });

  proxyServer.listen(config.PROXY_PORT, () => {
    console.log(`[AviCloud Proxy] Dynamic Reverse Proxy Engine listening on port ${config.PROXY_PORT}`);
  });

  return proxyServer;
}

module.exports = {
  proxy,
  resolveRoute,
  handleProxyRequest,
  handleProxyUpgrade,
  startProxyServer
};
