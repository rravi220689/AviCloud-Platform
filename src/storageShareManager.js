const { execSync } = require('child_process');
const config = require('./config');
const db = require('./db');
const os = require('os');

const SAMBA_CONTAINER = 'avicloud-samba';
const NFS_CONTAINER = 'avicloud-nfs';

function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// -------------------------------------------------------------
// 1. Samba (SMB with Credentials) Management
// -------------------------------------------------------------
function isSambaRunning() {
  try {
    const out = execSync(`docker inspect -f '{{.State.Running}}' ${SAMBA_CONTAINER} 2>/dev/null`).toString().trim();
    return out === 'true';
  } catch (_) {
    return false;
  }
}

function startSamba(username = 'avinash', password = 'Avinash@Cloud1989') {
  try {
    try {
      execSync(`docker rm -f ${SAMBA_CONTAINER} 2>/dev/null`);
    } catch (_) {}

    const cmd = `docker run -d --name ${SAMBA_CONTAINER} --net=host --restart unless-stopped ` +
      `-e SMB_USER="${username}" ` +
      `-e SMB_PASS="${password}" ` +
      `-v "${config.STORAGE_ROOT}:/storage" ` +
      `avicloud-samba:latest`;

    console.log(`[AviCloud Storage] Starting Authenticated Samba Server...`);
    execSync(cmd, { stdio: 'ignore' });
    return { success: true, isRunning: true, message: 'Samba (SMB) Server started successfully with credentials' };
  } catch (err) {
    return { success: false, isRunning: false, error: err.message };
  }
}

function stopSamba() {
  try {
    execSync(`docker stop ${SAMBA_CONTAINER} 2>/dev/null && docker rm ${SAMBA_CONTAINER} 2>/dev/null`);
    return { success: true, isRunning: false, message: 'Samba Server stopped' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// -------------------------------------------------------------
// 2. NFS Server Management
// -------------------------------------------------------------
function isNfsRunning() {
  try {
    const out = execSync(`docker inspect -f '{{.State.Running}}' ${NFS_CONTAINER} 2>/dev/null`).toString().trim();
    return out === 'true';
  } catch (_) {
    return false;
  }
}

function startNfs() {
  try {
    try {
      execSync(`docker rm -f ${NFS_CONTAINER} 2>/dev/null`);
    } catch (_) {}

    const cmd = `docker run -d --name ${NFS_CONTAINER} --restart unless-stopped ` +
      `-p 2049:2049/tcp -p 2049:2049/udp ` +
      `-p 111:111/tcp -p 111:111/udp ` +
      `-v "${config.STORAGE_ROOT}:/storage" ` +
      `avicloud-nfs:latest`;

    console.log(`[AviCloud Storage] Starting NFS Server on port 2049...`);
    execSync(cmd, { stdio: 'ignore' });
    return { success: true, isRunning: true, message: 'NFS Server started successfully' };
  } catch (err) {
    return { success: false, isRunning: false, error: err.message };
  }
}

function stopNfs() {
  try {
    execSync(`docker stop ${NFS_CONTAINER} 2>/dev/null && docker rm ${NFS_CONTAINER} 2>/dev/null`);
    return { success: true, isRunning: false, message: 'NFS Server stopped' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getStorageShareStatus() {
  const localIp = getLocalIp();
  const sambaRunning = isSambaRunning();
  const nfsRunning = isNfsRunning();

  return {
    success: true,
    localIp,
    samba: {
      isRunning: sambaRunning,
      ports: [139, 445],
      shareName: 'storage',
      username: 'avinash',
      password: 'Avinash@Cloud1989',
      mountCommands: {
        windows: `net use Z: \\\\${localIp}\\storage /user:avinash Avinash@Cloud1989`,
        macos: `smb://avinash:Avinash@Cloud1989@${localIp}/storage`,
        linux: `sudo mkdir -p /mnt/avicloud && sudo mount -t cifs -o username=avinash,password=Avinash@Cloud1989 //${localIp}/storage /mnt/avicloud`
      }
    },
    webdav: {
      localhostUrl: `http://localhost:${config.PORT}/webdav`,
      loopbackUrl: `http://127.0.0.1:${config.PORT}/webdav`,
      localIpUrl: `http://${localIp}:${config.PORT}/webdav`,
      duckDnsUrl: 'https://cloud.avivault.duckdns.org/webdav',
      outsideUrl: db.getSetting('active_tunnel_url') ? `${db.getSetting('active_tunnel_url')}/webdav` : null,
      username: 'avinash',
      password: 'Avinash@Cloud1989',
      mountCommands: {
        localhost: `net use Z: http://localhost:${config.PORT}/webdav /user:avinash Avinash@Cloud1989`,
        loopback: `net use Z: http://127.0.0.1:${config.PORT}/webdav /user:avinash Avinash@Cloud1989`,
        windowsLocal: `net use Z: http://${localIp}:${config.PORT}/webdav /user:avinash Avinash@Cloud1989`,
        windowsDuckDns: 'net use Z: https://cloud.avivault.duckdns.org/webdav /user:avinash Avinash@Cloud1989',
        windowsOutside: db.getSetting('active_tunnel_url') ? `net use Z: ${db.getSetting('active_tunnel_url')}/webdav /user:avinash Avinash@Cloud1989` : null,
        macosLocal: `http://localhost:${config.PORT}/webdav`,
        linuxLocal: `sudo mount -t davfs http://localhost:${config.PORT}/webdav /mnt/avicloud`
      }
    },
    nfs: {
      isRunning: nfsRunning,
      port: 2049,
      exportPath: '/storage',
      duckDnsHost: 'avivault.duckdns.org',
      mountCommands: {
        linux: `sudo mkdir -p /mnt/avicloud && sudo mount -t nfs -o port=2049,mountport=2049,nfsvers=3,nolock avivault.duckdns.org:/storage /mnt/avicloud`,
        linuxLocal: `sudo mkdir -p /mnt/avicloud && sudo mount -t nfs -o port=2049,mountport=2049,nfsvers=3,nolock ${localIp}:/storage /mnt/avicloud`,
        macos: `sudo mkdir -p /Volumes/AviCloud && sudo mount_nfs -o port=2049,mountport=2049,vers=3,nolock avivault.duckdns.org:/storage /Volumes/AviCloud`,
        windows: `mount -o anon,nolock \\\\avivault.duckdns.org\\storage Z:`
      }
    }
  };
}

module.exports = {
  startSamba,
  stopSamba,
  isSambaRunning,
  startNfs,
  stopNfs,
  isNfsRunning,
  getStorageShareStatus,
  getLocalIp
};
