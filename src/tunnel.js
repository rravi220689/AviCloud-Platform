const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const config = require('./config');
const db = require('./db');

let activeTunnelProcess = null;
let activeTunnelProvider = 'cloudflare';
let activeTunnelUrl = null;
let activeTunnelStatus = 'stopped';
let lastTunnelError = null;
let autoRestartEnabled = true;
let restartTimeout = null;
let onUrlChangeCallback = null;

const BIN_DIR = path.join(config.ROOT_DIR, 'bin');
const CLOUDFLARED_BIN = path.join(BIN_DIR, 'cloudflared');

function setUrlChangeCallback(fn) {
  onUrlChangeCallback = fn;
}

function ensureCloudflaredBinary() {
  if (fs.existsSync(CLOUDFLARED_BIN)) {
    try {
      const stat = fs.statSync(CLOUDFLARED_BIN);
      if (stat.size > 10 * 1024 * 1024) return CLOUDFLARED_BIN;
    } catch (_) {}
  }
  try {
    const sysPath = execSync('which cloudflared 2>/dev/null').toString().trim();
    if (sysPath && fs.existsSync(sysPath)) return sysPath;
  } catch (_) {}
  return false;
}

// -------------------------------------------------------------
// 1. Robust Background Auto-Tunnel Daemon
// -------------------------------------------------------------
function startTunnel(provider = 'cloudflare', targetPort = config.PORT, customToken = '') {
  if (restartTimeout) {
    clearTimeout(restartTimeout);
    restartTimeout = null;
  }

  if (activeTunnelProcess) {
    return {
      success: true,
      url: activeTunnelUrl,
      provider: activeTunnelProvider,
      status: activeTunnelStatus,
      message: 'Tunnel is already active.'
    };
  }

  activeTunnelStatus = 'starting';
  activeTunnelProvider = provider;
  lastTunnelError = null;

  if (provider === 'cloudflare') {
    const bin = ensureCloudflaredBinary() || CLOUDFLARED_BIN;

    try {
      const args = customToken
        ? ['tunnel', 'run', '--token', customToken]
        : ['tunnel', '--url', `http://localhost:${targetPort}`, '--no-autoupdate'];

      console.log(`[AviCloud Tunnel Daemon] Spawning: ${bin} ${args.join(' ')}`);
      activeTunnelProcess = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      const handleOutput = (data) => {
        const text = data.toString();
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match) {
          const newUrl = match[0];
          if (newUrl !== activeTunnelUrl) {
            activeTunnelUrl = newUrl;
            activeTunnelStatus = 'running';
            db.setSetting('active_tunnel_url', activeTunnelUrl);
            db.setSetting('active_tunnel_provider', 'Cloudflare Quick Tunnel');
            db.setSetting('last_tunnel_sync', new Date().toISOString());
            console.log(`[AviCloud Tunnel Daemon] 🚀 Live Public HTTPS URL: ${activeTunnelUrl}`);

            // Trigger notification webhook if configured
            notifyWebhookOnUrlChange(activeTunnelUrl);

            if (onUrlChangeCallback) {
              onUrlChangeCallback(activeTunnelUrl);
            }
          }
        }
      };

      activeTunnelProcess.stdout.on('data', handleOutput);
      activeTunnelProcess.stderr.on('data', handleOutput);

      activeTunnelProcess.on('close', (code) => {
        console.log(`[AviCloud Tunnel Daemon] Process exited (code: ${code})`);
        activeTunnelProcess = null;
        activeTunnelStatus = 'stopped';
        activeTunnelUrl = null;

        if (autoRestartEnabled) {
          console.log('[AviCloud Tunnel Daemon] 🔄 Auto-restarting tunnel in 5 seconds...');
          restartTimeout = setTimeout(() => {
            startTunnel(provider, targetPort, customToken);
          }, 5000);
        }
      });

      activeTunnelProcess.on('error', (err) => {
        console.error('[AviCloud Tunnel Daemon] Error:', err.message);
        lastTunnelError = err.message;
        activeTunnelStatus = 'error';
      });

      return { success: true, status: 'starting', provider: 'Cloudflare', message: 'Cloudflare Tunnel daemon active' };
    } catch (err) {
      activeTunnelStatus = 'error';
      lastTunnelError = err.message;
      return { success: false, status: 'error', message: err.message };
    }
  } else if (provider === 'pinggy') {
    return startPinggyTunnel(targetPort);
  } else if (provider === 'localhostrun') {
    return startLocalhostRunTunnel(targetPort);
  }

  return { success: false, message: 'Unsupported provider' };
}

function startPinggyTunnel(targetPort = config.PORT) {
  try {
    activeTunnelProvider = 'pinggy';
    activeTunnelProcess = spawn('ssh', [
      '-p', '443',
      '-R0:localhost:' + targetPort,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ServerAliveInterval=30',
      'a.pinggy.io'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const handleOutput = (data) => {
      const text = data.toString();
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.a\.pinggy\.link/);
      if (match) {
        activeTunnelUrl = match[0];
        activeTunnelStatus = 'running';
        db.setSetting('active_tunnel_url', activeTunnelUrl);
        db.setSetting('active_tunnel_provider', 'Pinggy Free Tunnel');
        notifyWebhookOnUrlChange(activeTunnelUrl);
      }
    };

    activeTunnelProcess.stdout.on('data', handleOutput);
    activeTunnelProcess.stderr.on('data', handleOutput);

    activeTunnelProcess.on('close', () => {
      activeTunnelProcess = null;
      activeTunnelStatus = 'stopped';
      activeTunnelUrl = null;
      if (autoRestartEnabled) {
        restartTimeout = setTimeout(() => startPinggyTunnel(targetPort), 5000);
      }
    });

    return { success: true, status: 'starting', provider: 'Pinggy' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function startLocalhostRunTunnel(targetPort = config.PORT) {
  try {
    activeTunnelProvider = 'localhostrun';
    activeTunnelProcess = spawn('ssh', [
      '-R', '80:localhost:' + targetPort,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ServerAliveInterval=30',
      'nokey@localhost.run'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const handleOutput = (data) => {
      const text = data.toString();
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.lhr\.life/);
      if (match) {
        activeTunnelUrl = match[0];
        activeTunnelStatus = 'running';
        db.setSetting('active_tunnel_url', activeTunnelUrl);
        db.setSetting('active_tunnel_provider', 'localhost.run Free Tunnel');
        notifyWebhookOnUrlChange(activeTunnelUrl);
      }
    };

    activeTunnelProcess.stdout.on('data', handleOutput);
    activeTunnelProcess.stderr.on('data', handleOutput);

    activeTunnelProcess.on('close', () => {
      activeTunnelProcess = null;
      activeTunnelStatus = 'stopped';
      activeTunnelUrl = null;
      if (autoRestartEnabled) {
        restartTimeout = setTimeout(() => startLocalhostRunTunnel(targetPort), 5000);
      }
    });

    return { success: true, status: 'starting', provider: 'localhost.run' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function stopTunnel() {
  autoRestartEnabled = false;
  if (restartTimeout) {
    clearTimeout(restartTimeout);
    restartTimeout = null;
  }
  if (activeTunnelProcess) {
    try {
      activeTunnelProcess.kill('SIGTERM');
      activeTunnelProcess = null;
      activeTunnelStatus = 'stopped';
      activeTunnelUrl = null;
      db.setSetting('active_tunnel_url', '');
      return { success: true, status: 'stopped', message: 'Tunnel daemon stopped' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
  activeTunnelStatus = 'stopped';
  activeTunnelUrl = null;
  return { success: true, status: 'stopped', message: 'No active tunnel running' };
}

function getTunnelStatus() {
  return {
    status: activeTunnelStatus,
    provider: activeTunnelProvider,
    url: activeTunnelUrl || db.getSetting('active_tunnel_url', null),
    error: lastTunnelError,
    autoRestart: autoRestartEnabled,
    lastSync: db.getSetting('last_tunnel_sync', null),
    cloudflaredInstalled: !!ensureCloudflaredBinary()
  };
}

function setAutoRestart(enabled) {
  autoRestartEnabled = !!enabled;
  if (autoRestartEnabled && activeTunnelStatus === 'stopped') {
    startTunnel('cloudflare');
  }
}

function notifyWebhookOnUrlChange(newUrl) {
  const webhookUrl = db.getSetting('tunnel_notification_webhook');
  if (!webhookUrl) return;

  try {
    const postData = JSON.stringify({
      event: 'tunnel_url_updated',
      public_url: newUrl,
      platform: 'AviCloud',
      timestamp: new Date().toISOString()
    });

    const client = webhookUrl.startsWith('https') ? https : http;
    const req = client.request(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 5000
    });
    req.on('error', () => {});
    req.write(postData);
    req.end();
  } catch (_) {}
}

// -------------------------------------------------------------
// 2. Multi-Provider Dynamic DNS & URL Sync Engine
// -------------------------------------------------------------
async function getPublicIP() {
  const services = [
    'https://api.ipify.org',
    'https://ifconfig.me/ip',
    'https://icanhazip.com'
  ];

  for (const s of services) {
    try {
      const ip = await new Promise((resolve, reject) => {
        https.get(s, { timeout: 3000 }, (res) => {
          let data = '';
          res.on('data', d => data += d);
          res.on('end', () => resolve(data.trim()));
        }).on('error', reject);
      });
      if (ip && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return ip;
    } catch (_) {}
  }
  return 'Unknown';
}

async function updateDynamicDNS(provider, domain, token, extraConfig = '') {
  const currentIp = await getPublicIP();

  try {
    let updateResult = null;

    if (provider === 'cloudflare_dns') {
      let configObj = {};
      try { configObj = JSON.parse(extraConfig); } catch (_) {}
      
      if (!configObj.zoneId || !configObj.recordId) {
        throw new Error('Cloudflare DNS requires Zone ID and Record ID in JSON extra configuration');
      }

      const postData = JSON.stringify({
        type: 'A',
        name: domain,
        content: currentIp,
        ttl: 120,
        proxied: true
      });

      const options = {
        hostname: 'api.cloudflare.com',
        path: `/client/v4/zones/${configObj.zoneId}/dns_records/${configObj.recordId}`,
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      updateResult = await new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', d => data += d);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve({ success: parsed.success, response: parsed.errors?.map(e => e.message).join(', ') || 'SUCCESS' });
            } catch (_) {
              resolve({ success: res.statusCode === 200, response: data });
            }
          });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
      });

    } else if (provider === 'freedns') {
      const url = `https://freedns.afraid.org/dynamic/update.php?${token}&address=${currentIp}`;
      updateResult = await simpleHttpGet(url);

    } else if (provider === 'noip') {
      const authHeader = 'Basic ' + Buffer.from(token).toString('base64');
      const url = `https://dynupdate.no-ip.com/nic/update?hostname=${domain}&myip=${currentIp}`;
      updateResult = await simpleHttpGet(url, { 'Authorization': authHeader, 'User-Agent': 'AviCloud/1.0 avinash' });

    } else if (provider === 'dynu') {
      const url = `https://api.dynu.com/nic/update?hostname=${domain}&myip=${currentIp}&password=${encodeURIComponent(token)}`;
      updateResult = await simpleHttpGet(url);

    } else if (provider === 'custom_webhook') {
      const targetUrl = (extraConfig || token).replace('{ip}', encodeURIComponent(currentIp)).replace('{domain}', encodeURIComponent(domain));
      updateResult = await simpleHttpGet(targetUrl);

    } else if (provider === 'duckdns') {
      const url = `https://www.duckdns.org/update?domains=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}&ip=${currentIp}`;
      updateResult = await simpleHttpGet(url);
    }

    const isSuccess = updateResult ? (updateResult.success !== false) : false;
    db.addOrUpdateDdnsConfig(provider, domain, token, extraConfig);
    db.updateDdnsStatus(provider, domain, isSuccess ? 'SUCCESS' : 'FAILED', currentIp);

    return {
      success: isSuccess,
      provider,
      domain,
      currentIp,
      response: updateResult ? (updateResult.response || updateResult) : 'OK',
      updatedAt: new Date().toISOString()
    };
  } catch (err) {
    db.updateDdnsStatus(provider, domain, 'ERROR', currentIp);
    return { success: false, error: err.message, currentIp };
  }
}

function simpleHttpGet(url, headers = {}) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers, timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        resolve({ success: res.statusCode >= 200 && res.statusCode < 300, response: data.trim() });
      });
    }).on('error', (err) => {
      resolve({ success: false, response: err.message });
    });
  });
}

function getNetworkInfo() {
  const os = require('os');
  const ifaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({ interface: name, ip: iface.address });
      }
    }
  }

  return {
    localIps: addresses,
    cloudPlatformPort: config.PORT,
    proxyPort: config.PROXY_PORT,
    ddnsConfigs: db.getAllDdnsConfigs()
  };
}

module.exports = {
  startTunnel,
  startPinggyTunnel,
  startLocalhostRunTunnel,
  stopTunnel,
  getTunnelStatus,
  setAutoRestart,
  setUrlChangeCallback,
  getPublicIP,
  updateDynamicDNS,
  getNetworkInfo,
  CLOUDFLARED_BIN
};
