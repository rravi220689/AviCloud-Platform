const http = require('http');
const httpProxy = require('http-proxy');
const db = require('./db');
const config = require('./config');

const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
  xfwd: true,
  autoRewrite: true
});

proxy.on('error', (err, req, res) => {
  console.error('[AviCloud Reverse Proxy Error]', err.message);
  if (res && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <body style="background:#0f172a;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="text-align:center;padding:2rem;background:#1e293b;border-radius:1rem;border:1px solid #334155;">
            <h2 style="color:#f43f5e;margin-top:0;">502 - Bad Gateway</h2>
            <p style="color:#94a3b8;font-size:0.9rem;">The upstream service configured for this domain is currently unreachable.</p>
            <pre style="color:#cbd5e1;background:#0f172a;padding:0.75rem;border-radius:0.5rem;font-size:0.8rem;">${err.message}</pre>
          </div>
        </body>
      </html>
    `);
  }
});

function handleProxyRequest(req, res) {
  const hostHeader = (req.headers.host || '').split(':')[0].toLowerCase();
  
  // Look up domain in SQLite
  let domainRecord = db.getDomainByName(hostHeader);

  // If not found directly, check wildcard / sslip.io / nip.io subdomain prefix (e.g. notekeeper.165.101.251.196.sslip.io -> notekeeper)
  if (!domainRecord) {
    const subMatch = hostHeader.match(/^([a-zA-Z0-9_-]+)\./);
    if (subMatch) {
      const prefix = subMatch[1];
      domainRecord = db.getDomainByName(prefix) || db.getDomainByName(prefix + '.local');
    }
  }

  if (domainRecord && domainRecord.is_active) {
    db.incrementDomainHits(domainRecord.id);
    return proxy.web(req, res, { target: domainRecord.target_url });
  }

  // Fallback if no matching domain route
  const allDomains = db.getAllDomains();
  res.writeHead(404, { 'Content-Type': 'text/html' });
  res.end(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>AviCloud Dynamic Domain Router</title>
        <style>
          body { background: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
          .card { background: #1e293b; padding: 2rem; border-radius: 1rem; border: 1px solid #334155; max-width: 550px; width: 100%; text-align: center; }
          h2 { color: #38bdf8; margin-top: 0; }
          p { color: #94a3b8; font-size: 0.9rem; line-height: 1.5; }
          .domain-badge { background: #0f172a; color: #a78bfa; padding: 0.25rem 0.75rem; border-radius: 0.5rem; font-family: monospace; font-size: 0.9rem; border: 1px solid #334155; display: inline-block; margin: 0.5rem 0; }
          .list { text-align: left; background: #0f172a; border-radius: 0.75rem; padding: 1rem; margin-top: 1.5rem; border: 1px solid #334155; }
          .list h4 { margin: 0 0 0.5rem 0; color: #38bdf8; font-size: 0.8rem; text-transform: uppercase; }
          .list a { color: #34d399; text-decoration: none; font-family: monospace; font-size: 0.85rem; display: block; margin: 0.25rem 0; }
          .list a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>AviCloud Reverse Proxy Router</h2>
          <p>No active target configured for Host header:</p>
          <div class="domain-badge">${hostHeader || 'Unknown'}</div>
          <p>To configure this domain, open the <strong>Domain Manager</strong> in the AviCloud Dashboard.</p>

          ${allDomains.length > 0 ? `
            <div class="list">
              <h4>Active Configured Domains:</h4>
              ${allDomains.map(d => `<div><a href="http://${d.domain_name}:${config.PROXY_PORT}">${d.domain_name}</a> &rarr; <span style="color:#94a3b8;font-size:0.75rem;">${d.target_url}</span></div>`).join('')}
            </div>
          ` : ''}

          <p style="margin-top: 1.5rem;"><a href="http://localhost:${config.PORT}" style="color: #38bdf8; text-decoration: none; font-weight: bold;">&larr; Open AviCloud Dashboard</a></p>
        </div>
      </body>
    </html>
  `);
}

function startReverseProxy() {
  const proxyServer = http.createServer(handleProxyRequest);

  proxyServer.on('upgrade', (req, socket, head) => {
    const hostHeader = (req.headers.host || '').split(':')[0].toLowerCase();
    const domainRecord = db.getDomainByName(hostHeader);
    if (domainRecord && domainRecord.is_active) {
      proxy.ws(req, socket, head, { target: domainRecord.target_url });
    } else {
      socket.destroy();
    }
  });

  proxyServer.listen(config.PROXY_PORT, '0.0.0.0', () => {
    console.log(`[AviCloud Proxy] Dynamic Reverse Proxy Engine listening on port ${config.PROXY_PORT}`);
  });

  return proxyServer;
}

module.exports = {
  startReverseProxy,
  handleProxyRequest
};
