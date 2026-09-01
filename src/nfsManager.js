const { execSync, spawn } = require('child_process');
const config = require('./config');

const CONTAINER_NAME = 'avicloud-nfs';
const IMAGE_NAME = 'avicloud-nfs:latest';

function isNfsRunning() {
  try {
    const out = execSync(`docker ps -q --filter "name=^/${CONTAINER_NAME}$"`).toString().trim();
    return !!out;
  } catch (_) {
    return false;
  }
}

function startNfsServer() {
  if (isNfsRunning()) {
    return { success: true, message: 'NFS server is already running', isRunning: true };
  }

  try {
    execSync(`docker rm -f ${CONTAINER_NAME} 2>/dev/null || true`);
    execSync(`docker run -d --name ${CONTAINER_NAME} \
      --restart unless-stopped \
      -v ${config.STORAGE_DIR}:/storage \
      -p 2049:2049 -p 2049:2049/udp \
      -p 111:111 -p 111:111/udp \
      ${IMAGE_NAME}`);
    
    return {
      success: true,
      message: 'NFS server started successfully on port 2049',
      isRunning: true,
      exportPath: '/storage',
      port: 2049
    };
  } catch (err) {
    return { success: false, message: err.message, isRunning: false };
  }
}

function stopNfsServer() {
  try {
    execSync(`docker stop ${CONTAINER_NAME} 2>/dev/null && docker rm ${CONTAINER_NAME} 2>/dev/null || true`);
    return { success: true, message: 'NFS server stopped', isRunning: false };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function getNfsInfo(hostIp = '127.0.0.1') {
  const running = isNfsRunning();
  return {
    isRunning: running,
    port: 2049,
    rpcPort: 111,
    exportPath: '/storage',
    hostStorageDir: config.STORAGE_DIR,
    mountCommands: {
      linux: `sudo mkdir -p /mnt/avicloud && sudo mount -t nfs -o port=2049,mountport=2049,nfsvers=3,nolock ${hostIp}:/storage /mnt/avicloud`,
      macos: `sudo mkdir -p /Volumes/AviCloud && sudo mount_nfs -o port=2049,mountport=2049,vers=3,nolock ${hostIp}:/storage /Volumes/AviCloud`,
      windows: `mount -o anon,nolock \\\\${hostIp}\\storage Z:`
    }
  };
}

module.exports = {
  isNfsRunning,
  startNfsServer,
  stopNfsServer,
  getNfsInfo
};
