const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');

function authBasic(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="AviCloud Storage"');
    return res.status(401).send('Authentication required');
  }

  const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
  const user = credentials[0];
  const pass = credentials[1];

  const dbUser = db.getUserByUsername(user);
  if (!dbUser || !db.verifyPassword(pass, dbUser.password_hash)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="AviCloud Storage"');
    return res.status(401).send('Invalid credentials');
  }

  req.user = dbUser;
  next();
}

function handleWebDAV(req, res) {
  const method = req.method;
  const relPath = decodeURIComponent(req.path.replace(/^\/webdav/, '') || '/');
  const targetPath = path.join(config.STORAGE_ROOT, relPath);

  // Security check to avoid path traversal outside storage root
  if (!targetPath.startsWith(config.STORAGE_ROOT)) {
    return res.status(403).send('Forbidden');
  }

  if (method === 'OPTIONS') {
    res.setHeader('DAV', '1, 2');
    res.setHeader('Allow', 'OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, MKCOL, COPY, MOVE');
    res.setHeader('MS-Author-Via', 'DAV');
    return res.status(200).end();
  }

  if (method === 'PROPFIND') {
    if (!fs.existsSync(targetPath)) {
      return res.status(404).send('Not found');
    }

    const stat = fs.statSync(targetPath);
    const depth = req.headers.depth || '1';

    let xml = `<?xml version="1.0" encoding="utf-8" ?>\n<D:multistatus xmlns:D="DAV:">\n`;

    const appendNode = (p, s) => {
      const isDir = s.isDirectory();
      const href = '/webdav' + (p === config.STORAGE_ROOT ? '/' : p.replace(config.STORAGE_ROOT, ''));
      const lastMod = s.mtime.toUTCString();
      const size = s.size;

      xml += `  <D:response>\n`;
      xml += `    <D:href>${href}${isDir && !href.endsWith('/') ? '/' : ''}</D:href>\n`;
      xml += `    <D:propstat>\n`;
      xml += `      <D:prop>\n`;
      xml += `        <D:displayname>${path.basename(p) || 'storage'}</D:displayname>\n`;
      xml += `        <D:getlastmodified>${lastMod}</D:getlastmodified>\n`;
      if (isDir) {
        xml += `        <D:resourcetype><D:collection/></D:resourcetype>\n`;
      } else {
        xml += `        <D:resourcetype/>\n`;
        xml += `        <D:getcontentlength>${size}</D:getcontentlength>\n`;
      }
      xml += `      </D:prop>\n`;
      xml += `      <D:status>HTTP/1.1 200 OK</D:status>\n`;
      xml += `    </D:propstat>\n`;
      xml += `  </D:response>\n`;
    };

    appendNode(targetPath, stat);

    if (stat.isDirectory() && depth !== '0') {
      try {
        const files = fs.readdirSync(targetPath);
        files.forEach(f => {
          const subPath = path.join(targetPath, f);
          try {
            const subStat = fs.statSync(subPath);
            appendNode(subPath, subStat);
          } catch (_) {}
        });
      } catch (_) {}
    }

    xml += `</D:multistatus>`;
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    return res.status(207).send(xml);
  }

  if (method === 'GET' || method === 'HEAD') {
    if (!fs.existsSync(targetPath)) return res.status(404).send('Not Found');
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      return res.status(200).send('<html><body><h1>Directory: /webdav' + relPath + '</h1></body></html>');
    }
    return res.sendFile(targetPath);
  }

  if (method === 'PUT') {
    try {
      const parent = path.dirname(targetPath);
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });

      if (req.body && (Buffer.isBuffer(req.body) || typeof req.body === 'string')) {
        fs.writeFileSync(targetPath, req.body);
        return res.status(201).end();
      }

      const ws = fs.createWriteStream(targetPath);
      req.pipe(ws);
      ws.on('finish', () => res.status(201).end());
      ws.on('error', (err) => res.status(500).send(err.message));
    } catch (err) {
      res.status(500).send(err.message);
    }
    return;
  }

  if (method === 'MKCOL') {
    try {
      fs.mkdirSync(targetPath, { recursive: true });
      return res.status(201).end();
    } catch (err) {
      return res.status(500).send(err.message);
    }
  }

  if (method === 'DELETE') {
    try {
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
      return res.status(204).end();
    } catch (err) {
      return res.status(500).send(err.message);
    }
  }

  if (method === 'PROPPATCH') {
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    return res.status(207).send(`<?xml version="1.0" encoding="utf-8" ?><D:multistatus xmlns:D="DAV:"><D:response><D:href>${req.path}</D:href><D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`);
  }

  if (method === 'LOCK') {
    const lockToken = 'urn:uuid:' + Math.random().toString(36).substring(2) + '-' + Date.now();
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    res.setHeader('Lock-Token', `<${lockToken}>`);
    return res.status(200).send(`<?xml version="1.0" encoding="utf-8" ?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>Infinity</D:depth><D:owner><D:href>avinash</D:href></D:owner><D:timeout>Second-3600</D:timeout><D:locktoken><D:href>${lockToken}</D:href></D:locktoken><D:lockroot><D:href>${req.path}</D:href></D:lockroot></D:activelock></D:lockdiscovery></D:prop>`);
  }

  if (method === 'UNLOCK') {
    return res.status(204).end();
  }

  if (method === 'COPY' || method === 'MOVE') {
    const destHeader = req.headers.destination;
    if (!destHeader) return res.status(400).send('Destination header missing');
    try {
      const destUrl = new URL(destHeader, `http://${req.headers.host}`);
      const destRelPath = decodeURIComponent(destUrl.pathname.replace(/^\/webdav/, '') || '/');
      const destTargetPath = path.join(config.STORAGE_ROOT, destRelPath);
      const parent = path.dirname(destTargetPath);
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });

      if (method === 'MOVE') {
        fs.renameSync(targetPath, destTargetPath);
      } else {
        fs.cpSync(targetPath, destTargetPath, { recursive: true });
      }
      return res.status(201).end();
    } catch (err) {
      return res.status(500).send(err.message);
    }
  }

  res.status(405).send('Method Not Allowed');
}

module.exports = {
  authBasic,
  handleWebDAV
};
