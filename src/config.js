const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const STORAGE_DIR = path.join(ROOT_DIR, 'storage_data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

module.exports = {
  PORT: parseInt(process.env.PORT || '9000', 10),
  PROXY_PORT: parseInt(process.env.PROXY_PORT || '9080', 10),
  ROOT_DIR,
  DATA_DIR,
  STORAGE_DIR,
  DB_PATH: path.join(DATA_DIR, 'avicloud.db'),
  MAX_STORAGE_BYTES: 100 * 1024 * 1024 * 1024, // 100 GB in bytes
  JWT_SECRET: process.env.JWT_SECRET || 'avicloud_super_secret_session_key_2026',
  ADMIN_USERNAME: process.env.ADMIN_USER || 'avinash',
  ADMIN_DEFAULT_PASSWORD: process.env.ADMIN_PASSWORD || 'Avinash@Cloud1989'
};
