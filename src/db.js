const Database = require('better-sqlite3');
const crypto = require('crypto');
const config = require('./config');

const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + '_avicloud_salt').digest('hex');
}

function initDatabase() {
  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Domains & Reverse Proxy Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain_name TEXT UNIQUE NOT NULL,
      target_url TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      ssl_mode TEXT DEFAULT 'auto',
      description TEXT,
      hits INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // URL Rewriting & Redirection Rules Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS url_redirects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      target_url TEXT NOT NULL,
      redirect_type TEXT DEFAULT '302',
      description TEXT,
      hits INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Multi-Provider Free Dynamic DNS Configs Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS ddns_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      domain_name TEXT NOT NULL,
      auth_token TEXT,
      extra_config TEXT,
      last_status TEXT DEFAULT 'pending',
      last_ip TEXT,
      last_updated DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 100GB Storage Public Share Links Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS share_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      file_path TEXT NOT NULL,
      is_directory INTEGER DEFAULT 0,
      name TEXT NOT NULL,
      password_hash TEXT,
      expires_at DATETIME,
      downloads_count INTEGER DEFAULT 0,
      max_downloads INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Settings Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Create default admin user if not exists
  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(config.ADMIN_USERNAME);
  if (!existingUser) {
    const defaultHash = hashPassword(config.ADMIN_DEFAULT_PASSWORD);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
      config.ADMIN_USERNAME,
      defaultHash,
      'admin'
    );
  }
}

// User Helpers
function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function verifyUserPassword(username, password) {
  const user = getUserByUsername(username);
  if (!user) return null;
  const hash = hashPassword(password);
  if (user.password_hash === hash) {
    const { password_hash, ...safeUser } = user;
    return safeUser;
  }
  return null;
}

function updatePassword(userId, newPassword) {
  const hash = hashPassword(newPassword);
  return db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
}

// Domain Helpers
function getAllDomains() {
  return db.prepare('SELECT * FROM domains ORDER BY id DESC').all();
}

function getDomainByName(domainName) {
  return db.prepare('SELECT * FROM domains WHERE LOWER(domain_name) = LOWER(?)').get(domainName);
}

function addDomain(domainName, targetUrl, description = '') {
  return db.prepare(`
    INSERT INTO domains (domain_name, target_url, description)
    VALUES (?, ?, ?)
  `).run(domainName.toLowerCase().trim(), targetUrl.trim(), description);
}

function updateDomain(id, targetUrl, isActive, description) {
  return db.prepare(`
    UPDATE domains
    SET target_url = ?, is_active = ?, description = ?
    WHERE id = ?
  `).run(targetUrl.trim(), isActive ? 1 : 0, description, id);
}

function deleteDomain(id) {
  return db.prepare('DELETE FROM domains WHERE id = ?').run(id);
}

function incrementDomainHits(domainName) {
  return db.prepare('UPDATE domains SET hits = hits + 1 WHERE LOWER(domain_name) = LOWER(?)').run(domainName);
}

// URL Rewrite & Redirection Helpers
function getAllRedirects() {
  return db.prepare('SELECT * FROM url_redirects ORDER BY id DESC').all();
}

function getRedirectBySlug(slug) {
  // Normalize slug: strip leading slashes and trailing slashes
  const cleanSlug = slug.replace(/^\/+|\/+$/g, '').toLowerCase();
  return db.prepare('SELECT * FROM url_redirects WHERE LOWER(slug) = ? OR LOWER(slug) = ?').get(cleanSlug, '/' + cleanSlug);
}

function findMatchingRewrite(requestPath) {
  const cleanPath = requestPath.replace(/^\/+|\/+$/g, '').toLowerCase();
  const allRules = getAllRedirects();

  // 1. Exact match
  for (const rule of allRules) {
    const ruleSlug = rule.slug.replace(/^\/+|\/+$/g, '').toLowerCase();
    if (ruleSlug === cleanPath) return { rule, remainingPath: '' };
  }

  // 2. Prefix match (e.g. slug is "app" and request is "app/subpath")
  for (const rule of allRules) {
    const ruleSlug = rule.slug.replace(/^\/+|\/+$/g, '').toLowerCase();
    if (cleanPath.startsWith(ruleSlug + '/')) {
      const remainingPath = cleanPath.slice(ruleSlug.length);
      return { rule, remainingPath };
    }
  }

  return null;
}

function addRedirect(slug, targetUrl, redirectType = '302', description = '') {
  const cleanSlug = slug.replace(/^\/+|\/+$/g, '').toLowerCase().trim();
  return db.prepare(`
    INSERT INTO url_redirects (slug, target_url, redirect_type, description)
    VALUES (?, ?, ?, ?)
  `).run(cleanSlug, targetUrl.trim(), redirectType, description);
}

function deleteRedirect(id) {
  return db.prepare('DELETE FROM url_redirects WHERE id = ?').run(id);
}

function incrementRedirectHits(slug) {
  const cleanSlug = slug.replace(/^\/+|\/+$/g, '').toLowerCase();
  return db.prepare('UPDATE url_redirects SET hits = hits + 1 WHERE LOWER(slug) = ?').run(cleanSlug);
}

// Dynamic DNS Config Helpers
function getAllDdnsConfigs() {
  return db.prepare('SELECT * FROM ddns_configs ORDER BY id DESC').all();
}

function addOrUpdateDdnsConfig(provider, domainName, authToken, extraConfig = '') {
  const existing = db.prepare('SELECT id FROM ddns_configs WHERE provider = ? AND domain_name = ?').get(provider, domainName);
  if (existing) {
    return db.prepare(`
      UPDATE ddns_configs
      SET auth_token = ?, extra_config = ?, last_updated = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(authToken, extraConfig, existing.id);
  }
  return db.prepare(`
    INSERT INTO ddns_configs (provider, domain_name, auth_token, extra_config)
    VALUES (?, ?, ?, ?)
  `).run(provider, domainName, authToken, extraConfig);
}

function updateDdnsStatus(provider, domainName, status, ip) {
  return db.prepare(`
    UPDATE ddns_configs
    SET last_status = ?, last_ip = ?, last_updated = CURRENT_TIMESTAMP
    WHERE provider = ? AND domain_name = ?
  `).run(status, ip, provider, domainName);
}

function deleteDdnsConfig(id) {
  return db.prepare('DELETE FROM ddns_configs WHERE id = ?').run(id);
}

// Share Link Helpers
function getAllShareLinks() {
  return db.prepare('SELECT * FROM share_links ORDER BY id DESC').all();
}

function getShareLinkByToken(token) {
  return db.prepare('SELECT * FROM share_links WHERE token = ?').get(token);
}

function createShareLink({ token, filePath, isDirectory, name, password, expiresAt, maxDownloads }) {
  const pwdHash = password ? hashPassword(password) : null;
  return db.prepare(`
    INSERT INTO share_links (token, file_path, is_directory, name, password_hash, expires_at, max_downloads)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(token, filePath, isDirectory ? 1 : 0, name, pwdHash, expiresAt || null, maxDownloads || 0);
}

function incrementShareDownloads(token) {
  return db.prepare('UPDATE share_links SET downloads_count = downloads_count + 1 WHERE token = ?').run(token);
}

function deleteShareLink(idOrToken) {
  if (typeof idOrToken === 'number' || !isNaN(idOrToken)) {
    return db.prepare('DELETE FROM share_links WHERE id = ?').run(idOrToken);
  }
  return db.prepare('DELETE FROM share_links WHERE token = ?').run(idOrToken);
}

// Settings Helpers
function getSetting(key, defaultValue = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

function setSetting(key, value) {
  return db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
}

module.exports = {
  db,
  initDatabase,
  hashPassword,
  getUserByUsername,
  verifyUserPassword,
  updatePassword,
  getAllDomains,
  getDomainByName,
  addDomain,
  updateDomain,
  deleteDomain,
  incrementDomainHits,
  getAllRedirects,
  getRedirectBySlug,
  findMatchingRewrite,
  addRedirect,
  deleteRedirect,
  incrementRedirectHits,
  getAllDdnsConfigs,
  addOrUpdateDdnsConfig,
  updateDdnsStatus,
  deleteDdnsConfig,
  getAllShareLinks,
  getShareLinkByToken,
  createShareLink,
  incrementShareDownloads,
  deleteShareLink,
  getSetting,
  setSetting
};
