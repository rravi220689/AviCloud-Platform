const { exec, execSync } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const APP_TEMPLATES = [
  {
    id: 'nextcloud',
    name: 'Nextcloud Hub',
    category: 'Storage & Productivity',
    description: 'Enterprise-grade self-hosted collaboration platform with files, calendar, office, and contacts.',
    image: 'nextcloud:apache',
    defaultPort: 9200,
    containerPort: 80,
    icon: 'cloud',
    env: ['NEXTCLOUD_ADMIN_USER=admin', 'NEXTCLOUD_ADMIN_PASSWORD=adminpassword'],
    volumes: ['/home/avinash/cloud-platform/data/apps/nextcloud:/var/www/html']
  },
  {
    id: 'vaultwarden',
    name: 'Vaultwarden',
    category: 'Security',
    description: 'Lightweight, ultra-fast Bitwarden-compatible password and secrets manager.',
    image: 'vaultwarden/server:latest',
    defaultPort: 9201,
    containerPort: 80,
    icon: 'lock',
    env: ['SIGNUPS_ALLOWED=true'],
    volumes: ['/home/avinash/cloud-platform/data/apps/vaultwarden:/data']
  },
  {
    id: 'filebrowser',
    name: 'FileBrowser Pro',
    category: 'Storage & Media',
    description: 'Fast, modern web file explorer with media playback, user accounts, and direct link sharing.',
    image: 'filebrowser/filebrowser:latest',
    defaultPort: 9202,
    containerPort: 80,
    icon: 'folder',
    env: [],
    volumes: [
      '/home/avinash/cloud-platform/storage_data:/srv',
      '/home/avinash/cloud-platform/data/apps/filebrowser:/etc/filebrowser'
    ]
  },
  {
    id: 'uptime-kuma',
    name: 'Uptime Kuma',
    category: 'Monitoring',
    description: 'Self-hosted monitoring tool with fancy status pages and alerting for all your cloud services.',
    image: 'louislam/uptime-kuma:1',
    defaultPort: 9203,
    containerPort: 3001,
    icon: 'activity',
    env: [],
    volumes: ['/home/avinash/cloud-platform/data/apps/uptime-kuma:/app/data']
  },
  {
    id: 'redis',
    name: 'Redis Cloud Cache',
    category: 'Database & In-Memory',
    description: 'High-performance in-memory key-value data store and caching layer.',
    image: 'redis:alpine',
    defaultPort: 9204,
    containerPort: 6379,
    icon: 'database',
    env: [],
    volumes: ['/home/avinash/cloud-platform/data/apps/redis:/data']
  },
  {
    id: 'portainer',
    name: 'Portainer CE',
    category: 'Container Management',
    description: 'Powerful web GUI for building, managing, and inspecting Docker containers and stacks.',
    image: 'portainer/portainer-ce:latest',
    defaultPort: 9205,
    containerPort: 9000,
    icon: 'server',
    env: [],
    volumes: ['/var/run/docker.sock:/var/run/docker.sock', '/home/avinash/cloud-platform/data/apps/portainer:/data']
  }
];

function isDockerAvailable() {
  try {
    execSync('docker --version', { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

async function listAviCloudContainers() {
  if (!isDockerAvailable()) return [];
  try {
    const { stdout } = await execPromise('docker ps -a --filter "name=avicloud-" --format "{{json .}}"');
    const lines = stdout.trim().split('\n').filter(Boolean);
    return lines.map(line => {
      try {
        const data = JSON.parse(line);
        return {
          id: data.ID,
          name: data.Names,
          image: data.Image,
          status: data.Status,
          state: data.State,
          ports: data.Ports,
          created: data.CreatedAt
        };
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
  } catch (err) {
    console.error('[AviCloud Docker] Error listing containers:', err.message);
    return [];
  }
}

async function deployApp(templateId, customPort) {
  const template = APP_TEMPLATES.find(t => t.id === templateId);
  if (!template) throw new Error('Invalid app template ID');

  const containerName = `avicloud-${template.id}`;
  const hostPort = customPort || template.defaultPort;

  // Check if container already exists
  try {
    const { stdout } = await execPromise(`docker ps -a --filter "name=${containerName}" --format "{{.ID}}"`);
    if (stdout.trim()) {
      // Start existing
      await execPromise(`docker start ${containerName}`);
      return { success: true, message: `App ${template.name} started on port ${hostPort}`, port: hostPort };
    }
  } catch (_) {}

  // Ensure volume dirs
  const fs = require('fs');
  if (template.volumes) {
    template.volumes.forEach(v => {
      const hostPath = v.split(':')[0];
      if (hostPath.startsWith('/home/avinash/cloud-platform')) {
        fs.mkdirSync(hostPath, { recursive: true });
      }
    });
  }

  // Construct docker run command
  let runCmd = `docker run -d --name ${containerName} --restart unless-stopped -p ${hostPort}:${template.containerPort}`;
  
  if (template.env && template.env.length > 0) {
    template.env.forEach(e => {
      runCmd += ` -e "${e}"`;
    });
  }

  if (template.volumes && template.volumes.length > 0) {
    template.volumes.forEach(v => {
      runCmd += ` -v "${v}"`;
    });
  }

  runCmd += ` ${template.image}`;

  console.log(`[AviCloud Docker] Running: ${runCmd}`);
  const { stdout } = await execPromise(runCmd);

  return {
    success: true,
    containerId: stdout.trim(),
    containerName,
    port: hostPort,
    message: `Successfully launched ${template.name} on port ${hostPort}`
  };
}

async function controlContainer(containerName, action) {
  if (!['start', 'stop', 'restart', 'rm'].includes(action)) {
    throw new Error('Invalid action');
  }

  // Safety check: only allow controlling avicloud-* containers
  if (!containerName.startsWith('avicloud-')) {
    throw new Error('Safety policy: You can only control AviCloud managed containers.');
  }

  const cmd = action === 'rm' ? `docker rm -f ${containerName}` : `docker ${action} ${containerName}`;
  const { stdout } = await execPromise(cmd);
  return { success: true, action, containerName, result: stdout.trim() };
}

async function getContainerLogs(containerName) {
  if (!containerName.startsWith('avicloud-')) {
    throw new Error('Unauthorized container name');
  }
  const { stdout, stderr } = await execPromise(`docker logs --tail 100 ${containerName}`);
  return stdout || stderr || 'No logs available.';
}

module.exports = {
  APP_TEMPLATES,
  isDockerAvailable,
  listAviCloudContainers,
  deployApp,
  controlContainer,
  getContainerLogs
};
