const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');
const storage = require('./storage');
const config = require('./config');

let lastCpuInfo = null;

function getCpuUsage() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }

  if (!lastCpuInfo) {
    lastCpuInfo = { totalIdle, totalTick };
    return Math.min(100, Math.round(os.loadavg()[0] * 10));
  }

  const idleDelta = totalIdle - lastCpuInfo.totalIdle;
  const totalDelta = totalTick - lastCpuInfo.totalTick;
  lastCpuInfo = { totalIdle, totalTick };

  if (totalDelta === 0) return 0;
  const usage = Math.max(0, Math.min(100, 100 - (100 * idleDelta / totalDelta)));
  return Math.round(usage);
}

function getMemoryUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    totalBytes: total,
    usedBytes: used,
    freeBytes: free,
    usedPercentage: Math.round((used / total) * 100),
    totalFormatted: storage.formatBytes(total),
    usedFormatted: storage.formatBytes(used),
    freeFormatted: storage.formatBytes(free)
  };
}

function getHostDiskUsage() {
  try {
    const output = execSync('df -B1 / 2>/dev/null').toString();
    const lines = output.trim().split('\n');
    if (lines.length > 1) {
      const parts = lines[1].split(/\s+/);
      const total = parseInt(parts[1], 10);
      const used = parseInt(parts[2], 10);
      const avail = parseInt(parts[3], 10);
      return {
        totalBytes: total,
        usedBytes: used,
        freeBytes: avail,
        usedPercentage: Math.round((used / total) * 100),
        totalFormatted: storage.formatBytes(total),
        usedFormatted: storage.formatBytes(used),
        freeFormatted: storage.formatBytes(avail)
      };
    }
  } catch (_) {}

  return {
    totalBytes: 0,
    usedBytes: 0,
    freeBytes: 0,
    usedPercentage: 0,
    totalFormatted: 'N/A',
    usedFormatted: 'N/A',
    freeFormatted: 'N/A'
  };
}

function getSystemMetrics() {
  const storageStats = storage.getStorageStats();
  const mem = getMemoryUsage();
  const cpu = getCpuUsage();
  const hostDisk = getHostDiskUsage();

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    uptime: Math.round(os.uptime()),
    uptimeFormatted: formatUptime(os.uptime()),
    cpuPercentage: cpu,
    cpuCores: os.cpus().length,
    cpuModel: os.cpus()[0] ? os.cpus()[0].model : 'Generic CPU',
    memory: mem,
    hostDisk,
    cloudStoragePool: {
      allocatedBytes: config.MAX_STORAGE_BYTES,
      allocatedFormatted: '100 GB',
      usedBytes: storageStats.usedBytes,
      usedFormatted: storageStats.usedFormatted,
      freeBytes: storageStats.freeBytes,
      freeFormatted: storageStats.freeFormatted,
      usedPercentage: storageStats.usedPercentage
    }
  };
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

module.exports = {
  getSystemMetrics
};
