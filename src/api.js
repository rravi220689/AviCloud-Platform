const express = require('express');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');

const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const storage = require('./storage');
const tunnel = require('./tunnel');
const docker = require('./docker');
const system = require('./system');
const multipart = require('./multipart');
const databaseManager = require('./databaseManager');
const nfsManager = require('./nfsManager');

const router = express.Router();

// Authentication Middleware
function authRequired(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.query.token;

  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication token required' });
  }

  const user = auth.verifyToken(token);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session token' });
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

  const user = db.verifyUserPassword(username, password);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Invalid username or password' });
  }

  const token = auth.signToken({ id: user.id, username: user.username, role: user.role });

  res.json({
    success: true,
    token,
    user: { id: user.id, username: user.username, role: user.role }
  });
});

router.get('/auth/me', authRequired, (req, res) => {
  res.json({ success: true, user: req.user });
});

router.post('/auth/change-password', authRequired, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ success: false, error: 'New password must be at least 6 characters' });
  }

  const user = db.verifyUserPassword(req.user.username, oldPassword);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Incorrect current password' });
  }

  db.updatePassword(req.user.id, newPassword);
  res.json({ success: true, message: 'Password updated successfully' });
});

// -------------------------------------------------------------
// 2. Storage Endpoints (100GB Cloud Drive)
// -------------------------------------------------------------
router.get('/storage/files', authRequired, (req, res) => {
  try {
    const subPath = req.query.path || '';
    const result = storage.listFiles(subPath);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/storage/stats', authRequired, (req, res) => {
  res.json({ success: true, stats: storage.getStorageStats() });
});

router.post('/storage/upload', authRequired, async (req, res) => {
  try {
    const subPath = req.query.path || '';
    const destDir = storage.resolveSafePath(subPath);
    const files = await multipart.parseMultipart(req, destDir);
    res.json({
      success: true,
      message: `Successfully uploaded ${files.length} file(s)`,
      files,
      stats: storage.getStorageStats()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/storage/folder', authRequired, (req, res) => {
  try {
    const { path: relPath, name } = req.body;
    const result = storage.createFolder(relPath || '', name);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/storage/item', authRequired, (req, res) => {
  try {
    const { path: relPath } = req.body;
    const result = storage.deleteItem(relPath);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/storage/rename', authRequired, (req, res) => {
  try {
    const { path: relPath, newName } = req.body;
    const result = storage.renameItem(relPath, newName);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/storage/text', authRequired, (req, res) => {
  try {
    const { path: relPath } = req.query;
    const content = storage.readTextFile(relPath);
    res.json({ success: true, content });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/storage/text', authRequired, (req, res) => {
  try {
    const { path: relPath, content } = req.body;
    const result = storage.saveTextFile(relPath, content);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/storage/download', (req, res) => {
  try {
    const relPath = req.query.path || '';
    const token = req.query.token;

    if (!token) {
      const authHeader = req.headers.authorization || '';
      const jwtToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!jwtToken || !auth.verifyToken(jwtToken)) {
        return res.status(401).send('Unauthorized');
      }
    } else {
      if (!auth.verifyToken(token)) {
        return res.status(401).send('Unauthorized');
      }
    }

    const fullPath = storage.resolveSafePath(relPath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).send('File not found');
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const zipName = (path.basename(fullPath) || 'cloud_files') + '.zip';
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
      const zipProc = spawn('zip', ['-r', '-', '.'], { cwd: fullPath });
      zipProc.stdout.pipe(res);
    } else {
      const range = req.headers.range;
      const mimeType = mime.lookup(fullPath) || 'application/octet-stream';
      const fileSize = stat.size;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(fullPath, { start, end });
        const head = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': mimeType,
        };
        res.writeHead(206, head);
        file.pipe(res);
      } else {
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', fileSize);
        res.setHeader('Content-Disposition', req.query.inline === '1' ? 'inline' : `attachment; filename="${path.basename(fullPath)}"`);
        fs.createReadStream(fullPath).pipe(res);
      }
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// -------------------------------------------------------------
// 3. NFS Network File Share API
// -------------------------------------------------------------
router.get('/nfs/status', authRequired, (req, res) => {
  const host = req.headers.host ? req.headers.host.split(':')[0] : '127.0.0.1';
  res.json({ success: true, ...nfsManager.getNfsInfo(host) });
});

router.post('/nfs/start', authRequired, (req, res) => {
  const result = nfsManager.startNfsServer();
  res.json(result);
});

router.post('/nfs/stop', authRequired, (req, res) => {
  const result = nfsManager.stopNfsServer();
  res.json(result);
});

// -------------------------------------------------------------
// 4. Public Share Links Management
// -------------------------------------------------------------
router.get('/shares', authRequired, (req, res) => {
  const shares = db.getAllShareLinks();
  res.json({ success: true, shares });
});

router.post('/shares/create', authRequired, (req, res) => {
  try {
    const { path: relPath, password, expiresDays, maxDownloads } = req.body;
    const fullPath = storage.resolveSafePath(relPath);
    if (!fs.existsSync(fullPath)) throw new Error('File or folder not found');

    const stat = fs.statSync(fullPath);
    const token = uuidv4().replace(/-/g, '').slice(0, 16);
    let expiresAt = null;

    if (expiresDays && parseInt(expiresDays, 10) > 0) {
      const exp = new Date();
      exp.setDate(exp.getDate() + parseInt(expiresDays, 10));
      expiresAt = exp.toISOString();
    }

    db.createShareLink({
      token,
      filePath: relPath,
      isDirectory: stat.isDirectory(),
      name: path.basename(fullPath) || 'Storage Root',
      password: password || null,
      expiresAt,
      maxDownloads: parseInt(maxDownloads || '0', 10)
    });

    res.json({
      success: true,
      token,
      shareUrl: `/s/${token}`,
      message: 'Share link created successfully'
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/shares/:id', authRequired, (req, res) => {
  try {
    db.deleteShareLink(req.params.id);
    res.json({ success: true, message: 'Share link revoked' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 5. Domains & Dynamic Reverse Proxy API
// -------------------------------------------------------------
router.get('/domains', authRequired, (req, res) => {
  const domains = db.getAllDomains();
  res.json({ success: true, domains });
});

router.post('/domains', authRequired, (req, res) => {
  try {
    const { domain_name, target_url, description } = req.body;
    if (!domain_name || !target_url) {
      return res.status(400).json({ success: false, error: 'Domain name and target URL are required' });
    }

    const cleanDomain = domain_name.toLowerCase().trim().replace(/^https?:\/\//, '');
    db.addDomain(cleanDomain, target_url, description || '');
    res.json({ success: true, message: `Domain ${cleanDomain} created and mapped to ${target_url}` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/domains/:id', authRequired, (req, res) => {
  try {
    const { target_url, is_active, description } = req.body;
    db.updateDomain(req.params.id, target_url, is_active, description || '');
    res.json({ success: true, message: 'Domain updated successfully' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/domains/:id', authRequired, (req, res) => {
  try {
    db.deleteDomain(req.params.id);
    res.json({ success: true, message: 'Domain deleted' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 6. Universal URL Rewriting & Redirection Rules
// -------------------------------------------------------------
router.get('/redirects', authRequired, (req, res) => {
  const redirects = db.getAllRedirects();
  res.json({ success: true, redirects });
});

router.post('/redirects', authRequired, (req, res) => {
  try {
    const { slug, target_url, redirect_type, description } = req.body;
    if (!slug || !target_url) {
      return res.status(400).json({ success: false, error: 'Slug and target URL are required' });
    }
    const cleanSlug = slug.toLowerCase().trim().replace(/^\/+|\/+$/g, '');
    db.addRedirect(cleanSlug, target_url, redirect_type || '302', description || '');
    res.json({ success: true, message: `Rewrite rule /${cleanSlug} created -> ${target_url}` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/redirects/:id', authRequired, (req, res) => {
  try {
    db.deleteRedirect(req.params.id);
    res.json({ success: true, message: 'Rewrite rule deleted' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 7. Database Cloud Hub Endpoints
// -------------------------------------------------------------
router.get('/databases', authRequired, async (req, res) => {
  try {
    const databases = await databaseManager.getDatabasesWithStatus();
    res.json({ success: true, databases });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/databases/query', authRequired, async (req, res) => {
  try {
    const { dbId, query } = req.body;
    if (!dbId || !query) return res.status(400).json({ success: false, error: 'Database ID and Query required' });
    const result = await databaseManager.executeQuery(dbId, query);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/databases/backup', authRequired, async (req, res) => {
  try {
    const { dbId } = req.body;
    if (!dbId) return res.status(400).json({ success: false, error: 'Database ID required' });
    const result = await databaseManager.backupDatabaseToStorage(dbId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 8. Outside Network & Remote Access API (Multi-Provider)
// -------------------------------------------------------------
router.get('/network/info', authRequired, async (req, res) => {
  const publicIp = await tunnel.getPublicIP();
  res.json({ success: true, publicIp, ...tunnel.getNetworkInfo() });
});

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

router.get('/network/ddns', authRequired, (req, res) => {
  const configs = db.getAllDdnsConfigs();
  res.json({ success: true, configs });
});

router.post('/network/ddns/sync', authRequired, async (req, res) => {
  const { provider, domain, token, extraConfig } = req.body;
  if (!provider || !domain) {
    return res.status(400).json({ success: false, error: 'Provider and domain required' });
  }
  const result = await tunnel.updateDynamicDNS(provider, domain, token || '', extraConfig || '');
  res.json(result);
});

router.delete('/network/ddns/:id', authRequired, (req, res) => {
  db.deleteDdnsConfig(req.params.id);
  res.json({ success: true, message: 'DDNS config removed' });
});

// -------------------------------------------------------------
// 9. Cloud App Store & Docker API
// -------------------------------------------------------------
router.get('/apps/templates', authRequired, (req, res) => {
  res.json({
    success: true,
    dockerAvailable: docker.isDockerAvailable(),
    templates: docker.APP_TEMPLATES
  });
});

router.get('/apps/containers', authRequired, async (req, res) => {
  const containers = await docker.listAviCloudContainers();
  res.json({ success: true, containers });
});

router.post('/apps/deploy', authRequired, async (req, res) => {
  try {
    const { templateId, customPort } = req.body;
    const result = await docker.deployApp(templateId, customPort);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/apps/control', authRequired, async (req, res) => {
  try {
    const { containerName, action } = req.body;
    const result = await docker.controlContainer(containerName, action);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/apps/logs/:name', authRequired, async (req, res) => {
  try {
    const logs = await docker.getContainerLogs(req.params.name);
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 10. System Metrics API
// -------------------------------------------------------------
router.get('/system/metrics', authRequired, (req, res) => {
  res.json({ success: true, metrics: system.getSystemMetrics() });
});

module.exports = router;
