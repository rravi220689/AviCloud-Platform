const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const config = require('./config');
const db = require('./db');
const storage = require('./storage');
const database = require('./databaseManager');
const tunnel = require('./tunnel');
const storageShareManager = require('./storageShareManager');
const { getDockerContainers, deployContainerTemplate, controlContainer, APP_TEMPLATES } = require('./docker');

// Setup multer for 100GB Cloud Drive uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const targetDir = req.uploadTargetDir || config.STORAGE_ROOT;
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      cb(null, targetDir);
    },
    filename: (req, file, cb) => {
      // Decode UTF-8 filenames properly
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      cb(null, originalName);
    }
  }),
  limits: {
    fileSize: 100 * 1024 * 1024 * 1024 // 100 GB Max File Size
  }
});

// -------------------------------------------------------------
// Authentication Middleware
// -------------------------------------------------------------
function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized. Please login.' });
  }

  const token = authHeader.split(' ')[1];
  const user = db.getUserByToken(token);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session.' });
  }

  req.user = user;
  next();
}

// -------------------------------------------------------------
// 1. Auth Endpoints
// -------------------------------------------------------------
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password required' });
  }

  const user = db.getUserByUsername(username);
  if (!user || !db.verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ success: false, error: 'Invalid username or password' });
  }

  const token = db.createSession(user.id);
  res.json({
    success: true,
    token,
    user: { id: user.id, username: user.username, role: user.role }
  });
});

router.get('/auth/me', authRequired, (req, res) => {
  res.json({
    success: true,
    user: { id: req.user.id, username: req.user.username, role: req.user.role }
  });
});

router.post('/auth/password', authRequired, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ success: false, error: 'New password must be at least 6 characters' });
  }

  const user = db.getUserById(req.user.id);
  if (!db.verifyPassword(currentPassword, user.password_hash)) {
    return res.status(400).json({ success: false, error: 'Current password is incorrect' });
  }

  db.updatePassword(req.user.id, newPassword);
  res.json({ success: true, message: 'Password updated successfully' });
});

// -------------------------------------------------------------
// 2. 100 GB Cloud Storage Drive Endpoints
// -------------------------------------------------------------
router.get('/storage/files', authRequired, (req, res) => {
  const reqPath = req.query.path || '';
  try {
    const list = storage.listFiles(reqPath);
    res.json({ success: true, ...list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/storage/upload', authRequired, (req, res, next) => {
  const reqPath = req.query.path || '';
  req.uploadTargetDir = path.join(config.STORAGE_ROOT, reqPath);
  next();
}, upload.array('files', 100), (req, res) => {
  res.json({
    success: true,
    message: `Uploaded ${req.files ? req.files.length : 0} files successfully`,
    files: (req.files || []).map(f => ({ name: f.filename, size: f.size }))
  });
});

router.post('/storage/folder', authRequired, (req, res) => {
  const { path: parentPath, name } = req.body;
  const result = storage.createFolder(parentPath || '', name);
  if (result.success) res.json(result);
  else res.status(400).json(result);
});

router.delete('/storage/item', authRequired, (req, res) => {
  const { path: targetPath } = req.body;
  const result = storage.deleteItem(targetPath || '');
  if (result.success) res.json(result);
  else res.status(400).json(result);
});

router.get('/storage/download', (req, res) => {
  const token = req.query.token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (!token || !db.getUserByToken(token)) {
    return res.status(401).send('Unauthorized');
  }

  const reqPath = req.query.path || '';
  const isInline = req.query.inline === '1';
  storage.streamFile(reqPath, req, res, isInline);
});

router.get('/storage/text', authRequired, (req, res) => {
  const reqPath = req.query.path || '';
  const result = storage.readFileText(reqPath);
  if (result.success) res.json(result);
  else res.status(400).json(result);
});

router.post('/storage/text', authRequired, (req, res) => {
  const { path: targetPath, content } = req.body;
  const result = storage.writeFileText(targetPath, content);
  if (result.success) res.json(result);
  else res.status(400).json(result);
});

// -------------------------------------------------------------
// 3. Authenticated Network Storage (Samba SMB + WebDAV + NFS)
// -------------------------------------------------------------
router.get('/storage-shares/status', authRequired, (req, res) => {
  res.json(storageShareManager.getStorageShareStatus());
});

router.post('/storage-shares/samba/:action', authRequired, (req, res) => {
  const action = req.params.action;
  if (action === 'start') {
    const result = storageShareManager.startSamba('avinash', 'Avinash@Cloud1989');
    res.json(result);
  } else {
    const result = storageShareManager.stopSamba();
    res.json(result);
  }
});

router.post('/storage-shares/nfs/:action', authRequired, (req, res) => {
  const action = req.params.action;
  if (action === 'start') {
    const result = storageShareManager.startNfs();
    res.json(result);
  } else {
    const result = storageShareManager.stopNfs();
    res.json(result);
  }
});

// Backwards compatibility for existing NFS routes
router.get('/nfs/status', authRequired, (req, res) => {
  const status = storageShareManager.getStorageShareStatus();
  res.json({ success: true, isRunning: status.nfs.isRunning, port: 2049, exportPath: '/storage', mountCommands: status.nfs.mountCommands });
});

router.post('/nfs/:action', authRequired, (req, res) => {
  const action = req.params.action;
  if (action === 'start') {
    res.json(storageShareManager.startNfs());
  } else {
    res.json(storageShareManager.stopNfs());
  }
});

// -------------------------------------------------------------
// 4. Public File Shares
// -------------------------------------------------------------
router.post('/shares/create', authRequired, (req, res) => {
  const { path: filePath, password, expiresDays } = req.body;
  const result = storage.createShare(filePath, password, expiresDays, req.user.id);
  if (result.success) res.json(result);
  else res.status(400).json(result);
});

router.get('/shares', authRequired, (req, res) => {
  const shares = db.getActiveShares();
  res.json({ success: true, shares });
});

router.delete('/shares/:id', authRequired, (req, res) => {
  db.deleteShare(parseInt(req.params.id, 10));
  res.json({ success: true, message: 'Share link revoked' });
});

// -------------------------------------------------------------
// 5. Database Hub (All 5 Connected Databases)
// -------------------------------------------------------------
router.get('/databases', authRequired, async (req, res) => {
  const list = await database.getAllDatabasesWithStatus();
  res.json({ success: true, databases: list });
});

router.post('/databases/query', authRequired, async (req, res) => {
  const { dbId, query } = req.body;
  if (!dbId || !query) {
    return res.status(400).json({ success: false, error: 'Database ID and Query required' });
  }

  const result = await database.executeQuery(dbId, query);
  res.json(result);
});

router.post('/databases/backup', authRequired, async (req, res) => {
  const { dbId } = req.body;
  const result = await database.backupDatabaseToStorage(dbId);
  res.json(result);
});

// -------------------------------------------------------------
// 6. Domain Manager & Discovered Local Services
// -------------------------------------------------------------
router.get('/domains', authRequired, (req, res) => {
  const domains = db.getAllDomains();
  const localIp = storageShareManager.getLocalIp();
  const liveTunnel = tunnel.getTunnelStatus().url;

  const augmented = domains.map(d => {
    const slug = d.domain_name.replace(/\.local$/, '').replace(/[^a-z0-9_-]+/gi, '-');
    return {
      ...d,
      localDirectUrl: `http://${d.domain_name}:${config.PROXY_PORT}`,
      sslipUrl: `http://${slug}.${localIp}.sslip.io:${config.PROXY_PORT}`,
      outsideUrl: liveTunnel ? `${liveTunnel}/${slug}` : null
    };
  });

  res.json({ success: true, domains: augmented, localIp, liveTunnel });
});

router.get('/domains/discovered-services', authRequired, (req, res) => {
  const localIp = storageShareManager.getLocalIp();
  const services = [
    { name: 'AviCloud Personal Platform', slug: 'cloud', port: 9000, url: 'http://127.0.0.1:9000', desc: 'Main Operating Dashboard & Storage' },
    { name: 'NoteKeeper ASP.NET App', slug: 'notekeeper', port: 4004, url: 'http://127.0.0.1:4004', desc: 'Active Application Container' },
    { name: 'PersonalNotes App', slug: 'personalnotes', port: 4005, url: 'http://127.0.0.1:4005', desc: 'Active Application Container' },
    { name: 'NoteKeeper API Backend', slug: 'notekeeper-api', port: 4000, url: 'http://127.0.0.1:4000', desc: 'REST API Service' },
    { name: 'NoteKeeper Web Frontend', slug: 'notekeeper-web', port: 4001, url: 'http://127.0.0.1:4001', desc: 'Web Client Frontend' },
    { name: 'IP Notifier Service', slug: 'ipnotifier', port: 4002, url: 'http://127.0.0.1:4002', desc: 'Background Daemon Service' },
    { name: 'Khatabook Service', slug: 'khatabook', port: 4003, url: 'http://127.0.0.1:4003', desc: 'Business Accounting App' },
    { name: 'Jenkins CI/CD Automation', slug: 'jenkins', port: 8080, url: 'http://127.0.0.1:8080', desc: 'Continuous Integration Server' },
    { name: 'LocalDeploy App Platform', slug: 'localdeploy', port: 3000, url: 'http://127.0.0.1:3000', desc: 'Deployment Orchestrator' }
  ];
  res.json({ success: true, localIp, services });
});

router.post('/domains', authRequired, (req, res) => {
  const { domain_name, target_url, ssl_mode, description, createOutsideRewrite } = req.body;
  if (!domain_name || !target_url) {
    return res.status(400).json({ success: false, error: 'Domain name and target URL required' });
  }

  const cleanDomain = domain_name.trim().toLowerCase();
  const cleanTarget = target_url.trim();

  try {
    const info = db.createDomain(cleanDomain, cleanTarget, ssl_mode || 'auto', description || '');
    const slug = cleanDomain.replace(/\.local$/, '').replace(/[^a-z0-9_-]+/g, '-');

    if (createOutsideRewrite !== false && slug) {
      try {
        db.createRedirect(slug, cleanTarget, 'proxy', `Outside Link for ${cleanDomain}`);
      } catch (_) {}
    }

    res.json({
      success: true,
      id: info.lastInsertRowid,
      domain: cleanDomain,
      message: `Domain ${cleanDomain} created -> ${cleanTarget}`
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/domains/test', authRequired, async (req, res) => {
  const { target_url } = req.body;
  if (!target_url) return res.status(400).json({ success: false, error: 'Target URL required' });

  try {
    const client = target_url.startsWith('https') ? https : http;
    const startTime = Date.now();
    const reqTest = client.get(target_url, { timeout: 3000 }, (resp) => {
      res.json({
        success: true,
        status: resp.statusCode,
        statusText: resp.statusMessage,
        latencyMs: Date.now() - startTime
      });
    });
    reqTest.on('error', (err) => {
      res.json({ success: false, error: err.message });
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.delete('/domains/:id', authRequired, (req, res) => {
  db.deleteDomain(parseInt(req.params.id, 10));
  res.json({ success: true, message: 'Domain route removed' });
});

// -------------------------------------------------------------
// 7. Universal URL Rewriter & Vanity Slugs
// -------------------------------------------------------------
router.get('/redirects', authRequired, (req, res) => {
  const list = db.getAllRedirects();
  res.json({ success: true, redirects: list });
});

router.post('/redirects', authRequired, (req, res) => {
  const { slug, target_url, redirect_type, description } = req.body;
  if (!slug || !target_url) {
    return res.status(400).json({ success: false, error: 'Slug and target URL are required' });
  }

  const cleanSlug = slug.replace(/^\/+/, '');
  const result = db.createRedirect(cleanSlug, target_url, redirect_type || 'proxy', description || '');
  res.json(result);
});

router.delete('/redirects/:id', authRequired, (req, res) => {
  db.deleteRedirect(parseInt(req.params.id, 10));
  res.json({ success: true, message: 'URL rewrite rule removed' });
});

// -------------------------------------------------------------
// 8. Public URL, Remote Tunnels & Dynamic DNS
// -------------------------------------------------------------
router.get('/tunnel/status', authRequired, (req, res) => {
  res.json({ success: true, ...tunnel.getTunnelStatus() });
});

router.post('/network/public-url', authRequired, (req, res) => {
  const { customUrl } = req.body;
  const result = tunnel.setCustomPublicUrl(customUrl);
  res.json(result);
});

router.get('/network/public-url', authRequired, (req, res) => {
  res.json({
    success: true,
    effectiveUrl: tunnel.getEffectivePublicUrl(),
    customUrl: db.getSetting('custom_public_url', null),
    tunnelUrl: db.getSetting('active_tunnel_url', null)
  });
});

router.post('/tunnel/start', authRequired, (req, res) => {
  const provider = req.body.provider || 'cloudflare';
  const targetPort = req.body.port || config.PORT;
  const token = req.body.token || '';
  const result = tunnel.startTunnel(provider, targetPort, token);
  res.json(result);
});

router.post('/tunnel/stop', authRequired, (req, res) => {
  const result = tunnel.stopTunnel();
  res.json(result);
});

router.get('/network/info', authRequired, async (req, res) => {
  const net = tunnel.getNetworkInfo();
  const publicIp = await tunnel.getPublicIP();
  res.json({ success: true, ...net, publicIp });
});

router.get('/network/ddns', authRequired, (req, res) => {
  const configs = db.getAllDdnsConfigs();
  res.json({ success: true, configs });
});

router.post('/network/ddns/sync', authRequired, async (req, res) => {
  const { provider, domain, token, extraConfig } = req.body;
  const result = await tunnel.updateDynamicDNS(provider, domain, token, extraConfig);
  res.json(result);
});

router.delete('/network/ddns/:id', authRequired, (req, res) => {
  db.deleteDdnsConfig(parseInt(req.params.id, 10));
  res.json({ success: true, message: 'DDNS configuration removed' });
});

// -------------------------------------------------------------
// 9. Docker Apps & Containers
// -------------------------------------------------------------
router.get('/apps/templates', authRequired, (req, res) => {
  res.json({ success: true, templates: APP_TEMPLATES });
});

router.get('/apps/containers', authRequired, async (req, res) => {
  const containers = await getDockerContainers();
  res.json({ success: true, containers });
});

router.post('/apps/deploy', authRequired, async (req, res) => {
  const { templateId, customEnv } = req.body;
  const result = await deployContainerTemplate(templateId, customEnv);
  res.json(result);
});

router.post('/apps/control', authRequired, async (req, res) => {
  const { containerName, action } = req.body;
  const result = await controlContainer(containerName, action);
  res.json(result);
});

module.exports = router;
