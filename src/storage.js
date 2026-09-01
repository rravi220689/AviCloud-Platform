const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const db = require('./db');

function resolveSafePath(relativePath = '') {
  const normalized = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
  const absolutePath = path.resolve(config.STORAGE_DIR, normalized);
  if (!absolutePath.startsWith(config.STORAGE_DIR)) {
    throw new Error('Access denied: Path is outside cloud storage root');
  }
  return absolutePath;
}

function getDirectorySize(dirPath) {
  let totalSize = 0;
  if (!fs.existsSync(dirPath)) return 0;

  function traverse(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      try {
        if (entry.isDirectory()) {
          traverse(fullPath);
        } else if (entry.isFile()) {
          const stat = fs.statSync(fullPath);
          totalSize += stat.size;
        }
      } catch (err) {
        // ignore unreadable files
      }
    }
  }

  traverse(dirPath);
  return totalSize;
}

function getStorageStats() {
  const usedBytes = getDirectorySize(config.STORAGE_DIR);
  const maxBytes = config.MAX_STORAGE_BYTES;
  const freeBytes = Math.max(0, maxBytes - usedBytes);
  const usedPercentage = Math.min(100, Number(((usedBytes / maxBytes) * 100).toFixed(2)));

  return {
    usedBytes,
    maxBytes,
    freeBytes,
    usedPercentage,
    usedFormatted: formatBytes(usedBytes),
    maxFormatted: formatBytes(maxBytes),
    freeFormatted: formatBytes(freeBytes)
  };
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function getFileType(fileName, isDir) {
  if (isDir) return 'folder';
  const ext = path.extname(fileName).toLowerCase();
  const mimeType = mime.lookup(fileName) || '';

  if (['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.ico'].includes(ext)) return 'image';
  if (['.mp4', '.mkv', '.webm', '.avi', '.mov'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'].includes(ext)) return 'audio';
  if (['.pdf'].includes(ext)) return 'pdf';
  if (['.zip', '.tar', '.gz', '.7z', '.rar'].includes(ext)) return 'archive';
  if (['.js', '.ts', '.py', '.html', '.css', '.json', '.sh', '.md', '.txt', '.yaml', '.yml', '.sql', '.xml'].includes(ext)) return 'code';
  return 'file';
}

function listFiles(relativeDir = '') {
  const targetDir = resolveSafePath(relativeDir);
  if (!fs.existsSync(targetDir)) {
    throw new Error('Directory does not exist');
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    const fullPath = path.join(targetDir, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      const isDir = entry.isDirectory();
      const itemRelPath = path.relative(config.STORAGE_DIR, fullPath).replace(/\\/g, '/');
      const fileType = getFileType(entry.name, isDir);

      items.push({
        name: entry.name,
        path: itemRelPath,
        isDirectory: isDir,
        size: isDir ? 0 : stat.size,
        sizeFormatted: isDir ? '--' : formatBytes(stat.size),
        type: fileType,
        mimeType: isDir ? 'directory' : (mime.lookup(entry.name) || 'application/octet-stream'),
        modified: stat.mtime
      });
    } catch (e) {
      // skip unreadable
    }
  }

  // Sort directories first, then alphabetical
  items.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  return {
    currentPath: relativeDir.replace(/\\/g, '/'),
    items,
    stats: getStorageStats()
  };
}

function createFolder(relativeDir, folderName) {
  const cleanName = folderName.replace(/[\/\\:*?"<>|]/g, '_').trim();
  if (!cleanName) throw new Error('Invalid folder name');
  const targetDir = resolveSafePath(path.join(relativeDir, cleanName));
  if (fs.existsSync(targetDir)) throw new Error('Folder already exists');
  fs.mkdirSync(targetDir, { recursive: true });
  return { success: true, path: path.relative(config.STORAGE_DIR, targetDir).replace(/\\/g, '/') };
}

function deleteItem(relativePath) {
  const targetPath = resolveSafePath(relativePath);
  if (!fs.existsSync(targetPath)) throw new Error('Item does not exist');
  
  if (targetPath === config.STORAGE_DIR) {
    throw new Error('Cannot delete root storage directory');
  }

  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(targetPath);
  }
  return { success: true };
}

function renameItem(relativePath, newName) {
  const cleanName = newName.replace(/[\/\\:*?"<>|]/g, '_').trim();
  if (!cleanName) throw new Error('Invalid name');
  
  const targetPath = resolveSafePath(relativePath);
  if (!fs.existsSync(targetPath)) throw new Error('Item does not exist');
  if (targetPath === config.STORAGE_DIR) throw new Error('Cannot rename root');

  const parentDir = path.dirname(targetPath);
  const newFullPath = path.join(parentDir, cleanName);
  if (fs.existsSync(newFullPath)) throw new Error('Item with new name already exists');

  fs.renameSync(targetPath, newFullPath);
  return { success: true, newPath: path.relative(config.STORAGE_DIR, newFullPath).replace(/\\/g, '/') };
}

function readTextFile(relativePath) {
  const targetPath = resolveSafePath(relativePath);
  if (!fs.existsSync(targetPath)) throw new Error('File does not exist');
  const stat = fs.statSync(targetPath);
  if (stat.size > 10 * 1024 * 1024) throw new Error('File is too large for web editor (Max 10MB)');
  return fs.readFileSync(targetPath, 'utf8');
}

function saveTextFile(relativePath, content) {
  const targetPath = resolveSafePath(relativePath);
  const currentStats = getStorageStats();
  const currentSize = fs.existsSync(targetPath) ? fs.statSync(targetPath).size : 0;
  const newSize = Buffer.byteLength(content, 'utf8');
  
  if (currentStats.usedBytes - currentSize + newSize > config.MAX_STORAGE_BYTES) {
    throw new Error('Storage quota exceeded (100 GB limit)');
  }

  fs.writeFileSync(targetPath, content, 'utf8');
  return { success: true };
}

module.exports = {
  resolveSafePath,
  getStorageStats,
  listFiles,
  createFolder,
  deleteItem,
  renameItem,
  readTextFile,
  saveTextFile,
  formatBytes
};
