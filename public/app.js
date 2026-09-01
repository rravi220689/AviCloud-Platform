// AviCloud Client Application
let currentToken = localStorage.getItem('avicloud_token');
let currentPath = '';
let currentShareTarget = null;
let currentPreviewPath = null;
let activeTab = 'overview';
let activeDbId = null;
let currentLiveTunnelUrl = null;

// WebSocket connection for real-time telemetry
let ws = null;

function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'telemetry') {
        if (data.tunnel && data.tunnel.url && data.tunnel.url !== currentLiveTunnelUrl) {
          currentLiveTunnelUrl = data.tunnel.url;
          if (activeTab === 'redirects') loadRedirects();
          if (activeTab === 'domains') loadDomains();
        }
        updateTelemetryUI(data.metrics, data.tunnel);
      }
    } catch (_) {}
  };

  ws.onclose = () => {
    setTimeout(initWebSocket, 3000);
  };
}

// -------------------------------------------------------------
// Auth & Startup
// -------------------------------------------------------------
async function checkAuth() {
  if (!currentToken) {
    document.getElementById('loginModal').classList.remove('hidden');
    return false;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (!data.success) {
      logout();
      return false;
    }
    document.getElementById('loginModal').classList.add('hidden');
    document.getElementById('sidebarUsername').innerText = data.user.username;
    return true;
  } catch (err) {
    logout();
    return false;
  }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;
  const errorBox = document.getElementById('loginError');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success) {
      localStorage.setItem('avicloud_token', data.token);
      currentToken = data.token;
      document.getElementById('loginModal').classList.add('hidden');
      document.getElementById('sidebarUsername').innerText = data.user.username;
      loadAllData();
    } else {
      errorBox.innerText = data.error || 'Login failed';
      errorBox.classList.remove('hidden');
    }
  } catch (err) {
    errorBox.innerText = 'Network error while signing in';
    errorBox.classList.remove('hidden');
  }
});

function logout() {
  localStorage.removeItem('avicloud_token');
  currentToken = null;
  document.getElementById('loginModal').classList.remove('hidden');
}

// -------------------------------------------------------------
// Navigation & Tabs
// -------------------------------------------------------------
function switchTab(tabId) {
  activeTab = tabId;
  document.querySelectorAll('section[id^="tab-"]').forEach(sec => sec.classList.add('hidden'));
  const targetSection = document.getElementById(`tab-${tabId}`);
  if (targetSection) targetSection.classList.remove('hidden');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.className = 'nav-btn w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition text-cyan-400 bg-cyan-500/10';
    } else {
      btn.className = 'nav-btn w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition text-slate-400 hover:text-slate-200 hover:bg-slate-800/50';
    }
  });

  const titles = {
    overview: 'Platform Overview',
    storage: '100 GB Cloud Drive',
    nfs: 'NFS Network File System Share',
    databases: 'Database Servers & Connection Hub',
    domains: 'Domains & Dynamic Reverse Proxy',
    redirects: 'Universal URL Rewriter & Outside Links',
    network: 'Free Remote Tunnels & Dynamic DNS',
    apps: 'Cloud App Store',
    shares: 'Active Public Shares',
    settings: 'Settings & Security'
  };
  document.getElementById('headerTitle').innerText = titles[tabId] || 'AviCloud';

  if (tabId === 'storage') refreshStorage();
  if (tabId === 'nfs') loadNfsStatus();
  if (tabId === 'databases') loadDatabases();
  if (tabId === 'domains') loadDomains();
  if (tabId === 'redirects') loadRedirects();
  if (tabId === 'network') loadNetworkInfo();
  if (tabId === 'apps') loadApps();
  if (tabId === 'shares') loadShares();
}

// -------------------------------------------------------------
// Telemetry UI Updates
// -------------------------------------------------------------
function updateTelemetryUI(metrics, tunnel) {
  if (!metrics) return;

  // 100GB Pool Quota
  const pool = metrics.cloudStoragePool;
  document.getElementById('sidebarQuotaPercent').innerText = `${pool.usedPercentage}%`;
  document.getElementById('sidebarQuotaBar').style.width = `${pool.usedPercentage}%`;
  document.getElementById('sidebarQuotaUsed').innerText = `${pool.usedFormatted} Used`;

  document.getElementById('statStorageUsed').innerText = pool.usedFormatted;
  document.getElementById('statStorageFree').innerText = `${pool.freeFormatted} Available`;
  document.getElementById('statStorageBar').style.width = `${pool.usedPercentage}%`;

  // System stats
  document.getElementById('statCpuMem').innerText = `${metrics.cpuPercentage}% CPU • ${metrics.memory.usedPercentage}% RAM`;
  document.getElementById('statUptime').innerText = `Uptime: ${metrics.uptimeFormatted}`;
  document.getElementById('statCpuBar').style.width = `${metrics.cpuPercentage}%`;

  // Tunnel stats
  if (tunnel) {
    const isRunning = tunnel.status === 'running' || !!tunnel.url;
    document.getElementById('statTunnelStatus').innerText = isRunning ? 'Online (24/7)' : 'Starting...';
    document.getElementById('statTunnelUrl').innerText = tunnel.url || 'Connecting Tunnel...';
    currentLiveTunnelUrl = tunnel.url;

    const badge = document.getElementById('topTunnelBadge');
    if (isRunning && tunnel.url) {
      badge.classList.remove('hidden');
      badge.classList.add('flex');
      badge.innerHTML = `<a href="${tunnel.url}" target="_blank" class="hover:underline flex items-center gap-1.5"><i class="fa-solid fa-shield-halved text-[10px]"></i> Outside: ${tunnel.url.replace('https://', '')}</a>`;
    } else {
      badge.classList.add('hidden');
      badge.classList.remove('flex');
    }

    const tunnelToggleBtn = document.getElementById('tunnelToggleBtn');
    if (tunnelToggleBtn) {
      if (isRunning) {
        tunnelToggleBtn.className = 'px-5 py-2.5 bg-rose-500 hover:bg-rose-600 rounded-xl text-xs font-bold text-white flex items-center gap-2';
        tunnelToggleBtn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop Tunnel';
      } else {
        tunnelToggleBtn.className = 'gradient-btn px-5 py-2.5 rounded-xl text-xs font-bold text-white flex items-center gap-2';
        tunnelToggleBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Start Outside Tunnel';
      }
    }

    const urlBox = document.getElementById('tunnelUrlBox');
    if (urlBox) {
      if (isRunning && tunnel.url) {
        urlBox.classList.remove('hidden');
        document.getElementById('livePublicUrl').innerText = tunnel.url;
      } else {
        urlBox.classList.add('hidden');
      }
    }
  }
}

// -------------------------------------------------------------
// NFS Network File Share
// -------------------------------------------------------------
async function loadNfsStatus() {
  try {
    const res = await fetch('/api/nfs/status', {
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (!data.success) return;

    const badge = document.getElementById('nfsStatusBadge');
    const toggleBtn = document.getElementById('nfsToggleBtn');

    if (data.isRunning) {
      badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
      badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block mr-1"></span> NFS ACTIVE (Port 2049)';
      toggleBtn.className = 'px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold rounded-xl border border-rose-500/30 transition';
      toggleBtn.innerText = 'Stop NFS';
    } else {
      badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-500 border border-slate-700';
      badge.innerText = 'NFS STOPPED';
      toggleBtn.className = 'gradient-btn px-4 py-2 text-white text-xs font-semibold rounded-xl shadow transition';
      toggleBtn.innerText = 'Start NFS';
    }

    if (data.mountCommands) {
      document.getElementById('nfsCmdLinux').innerText = data.mountCommands.linux;
      document.getElementById('nfsCmdMac').innerText = data.mountCommands.macos;
      document.getElementById('nfsCmdWin').innerText = data.mountCommands.windows;
    }
  } catch (err) {
    console.error('Error loading NFS status:', err);
  }
}

async function toggleNfsServer() {
  try {
    const statusRes = await fetch('/api/nfs/status', {
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    const statusData = await statusRes.json();
    const action = statusData.isRunning ? 'stop' : 'start';

    const res = await fetch(`/api/nfs/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    const data = await res.json();
    alert(data.message || `NFS server ${action}ed`);
    loadNfsStatus();
  } catch (_) {
    alert('Failed to toggle NFS server');
  }
}

// -------------------------------------------------------------
// 100GB Storage Manager
// -------------------------------------------------------------
async function refreshStorage() {
  try {
    const res = await fetch(`/api/storage/files?path=${encodeURIComponent(currentPath)}`, {
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (!data.success) return;

    renderBreadcrumbs(currentPath);
    renderFileGrid(data.items);
  } catch (err) {
    console.error('Error fetching files:', err);
  }
}

function renderBreadcrumbs(pathStr) {
  const container = document.getElementById('storageBreadcrumbs');
  const parts = pathStr.split('/').filter(Boolean);
  
  let html = `
    <button onclick="navigateToPath('')" class="text-cyan-400 font-bold hover:underline flex items-center gap-1">
      <i class="fa-solid fa-house"></i> 100GB Drive
    </button>
  `;

  let accumulated = '';
  parts.forEach((part, index) => {
    accumulated += (index === 0 ? '' : '/') + part;
    const isLast = index === parts.length - 1;
    html += `
      <span class="text-slate-600">/</span>
      <button onclick="navigateToPath('${accumulated}')" class="${isLast ? 'text-slate-200 font-bold' : 'text-slate-400 hover:text-cyan-400'}">${part}</button>
    `;
  });

  container.innerHTML = html;
}

function renderFileGrid(items) {
  const grid = document.getElementById('fileGrid');
  if (!items || items.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-16 text-center text-slate-500">
        <i class="fa-solid fa-folder-open text-4xl mb-3 text-slate-700"></i>
        <p class="text-sm font-semibold">This folder is empty</p>
        <p class="text-xs text-slate-600 mt-1">Upload files or drag & drop above</p>
      </div>
    `;
    return;
  }

  const iconMap = {
    folder: 'fa-solid fa-folder text-amber-400 text-3xl',
    image: 'fa-solid fa-file-image text-purple-400 text-3xl',
    video: 'fa-solid fa-file-video text-rose-400 text-3xl',
    audio: 'fa-solid fa-file-audio text-emerald-400 text-3xl',
    pdf: 'fa-solid fa-file-pdf text-red-400 text-3xl',
    code: 'fa-solid fa-file-code text-cyan-400 text-3xl',
    archive: 'fa-solid fa-file-zipper text-yellow-400 text-3xl',
    file: 'fa-solid fa-file text-slate-400 text-3xl'
  };

  grid.innerHTML = items.map(item => `
    <div class="file-card glass-card p-4 rounded-2xl flex flex-col justify-between group relative overflow-hidden">
      <div class="flex items-center justify-between mb-3">
        <div class="cursor-pointer" onclick="${item.isDirectory ? `navigateToPath('${item.path}')` : `openPreview('${item.path}', '${item.type}')`}">
          <i class="${iconMap[item.type] || iconMap.file}"></i>
        </div>
        <div class="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition">
          <button onclick="openShareModal('${item.path}', '${item.name}')" title="Create Share Link" class="p-1.5 text-slate-400 hover:text-cyan-400 transition text-xs">
            <i class="fa-solid fa-share-nodes"></i>
          </button>
          <a href="/api/storage/download?path=${encodeURIComponent(item.path)}&token=${currentToken}" title="Download" class="p-1.5 text-slate-400 hover:text-emerald-400 transition text-xs">
            <i class="fa-solid fa-download"></i>
          </a>
          <button onclick="deleteStorageItem('${item.path}')" title="Delete" class="p-1.5 text-slate-400 hover:text-rose-400 transition text-xs">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>

      <div class="cursor-pointer" onclick="${item.isDirectory ? `navigateToPath('${item.path}')` : `openPreview('${item.path}', '${item.type}')`}">
        <p class="text-xs font-semibold text-slate-200 truncate" title="${item.name}">${item.name}</p>
        <p class="text-[11px] text-slate-500 mt-0.5">${item.sizeFormatted}</p>
      </div>
    </div>
  `).join('');
}

function navigateToPath(pathStr) {
  currentPath = pathStr;
  refreshStorage();
}

async function promptNewFolder() {
  const folderName = prompt('Enter new folder name:');
  if (!folderName) return;

  try {
    const res = await fetch('/api/storage/folder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentToken}`
      },
      body: JSON.stringify({ path: currentPath, name: folderName })
    });
    const data = await res.json();
    if (data.success) {
      refreshStorage();
    } else {
      alert(data.error || 'Failed to create folder');
    }
  } catch (err) {
    alert('Network error');
  }
}

async function deleteStorageItem(pathStr) {
  if (!confirm(`Are you sure you want to delete "${pathStr}"?`)) return;

  try {
    const res = await fetch('/api/storage/item', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentToken}`
      },
      body: JSON.stringify({ path: pathStr })
    });
    const data = await res.json();
    if (data.success) {
      refreshStorage();
    } else {
      alert(data.error || 'Failed to delete item');
    }
  } catch (err) {
    alert('Network error');
  }
}

// -------------------------------------------------------------
// Universal URL Rewriter & Outside Links
// -------------------------------------------------------------
async function loadRedirects() {
  try {
    const res = await fetch('/api/redirects', {
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (!data.success) return;

    const tbody = document.getElementById('redirectsTableBody');
    if (data.redirects.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-500">No URL rewrite rules created yet. Click "Add URL Rewrite Rule" above!</td></tr>';
      return;
    }

    const liveBase = currentLiveTunnelUrl || window.location.origin;

    tbody.innerHTML = data.redirects.map(r => {
      const cleanSlug = r.slug.replace(/^\/+/, '');
      const localUrl = `${window.location.origin}/${cleanSlug}`;
      const outsideUrl = currentLiveTunnelUrl ? `${currentLiveTunnelUrl}/${cleanSlug}` : localUrl;

      return `
        <tr class="hover:bg-slate-900/40 transition">
          <td class="p-4 font-mono">
            <span class="font-bold text-amber-400">/${cleanSlug}</span>
            <div class="text-[10px] text-cyan-400 mt-1 flex items-center gap-1.5 truncate max-w-xs">
              <i class="fa-solid fa-globe text-[9px]"></i>
              <a href="${outsideUrl}" target="_blank" class="hover:underline truncate" title="Outside URL">${outsideUrl}</a>
            </div>
          </td>
          <td class="p-4 font-mono text-slate-300 truncate max-w-xs" title="${r.target_url}">
            <a href="${r.target_url}" target="_blank" class="text-slate-300 hover:underline">${r.target_url}</a>
          </td>
          <td class="p-4">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${r.redirect_type === 'proxy' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'} uppercase">
              ${r.redirect_type === 'proxy' ? 'REVERSE PROXY' : r.redirect_type}
            </span>
          </td>
          <td class="p-4 text-slate-300 font-bold">${r.hits || 0}</td>
          <td class="p-4 text-slate-400 text-xs">${r.description || '--'}</td>
          <td class="p-4 text-right">
            <div class="flex items-center justify-end gap-2">
              <button onclick="copyToClipboard('${outsideUrl}')" class="p-1.5 text-cyan-400 hover:text-cyan-300" title="Copy Outside Public URL"><i class="fa-solid fa-link"></i></button>
              <button onclick="deleteRedirect(${r.id})" class="p-1.5 text-slate-500 hover:text-rose-400" title="Delete Rule"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading rewrites:', err);
  }
}

function openAddRedirectModal() {
  document.getElementById('addRedirectModal').classList.remove('hidden');
}

function closeAddRedirectModal() {
  document.getElementById('addRedirectModal').classList.add('hidden');
}

document.getElementById('addRedirectForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const slug = document.getElementById('redirectSlug').value;
  const target_url = document.getElementById('redirectTarget').value;
  const redirect_type = document.getElementById('redirectType').value;
  const description = document.getElementById('redirectDesc').value;

  try {
    const res = await fetch('/api/redirects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentToken}`
      },
      body: JSON.stringify({ slug, target_url, redirect_type, description })
    });
    const data = await res.json();
    if (data.success) {
      closeAddRedirectModal();
      loadRedirects();
    } else {
      alert(data.error || 'Failed to create rewrite rule');
    }
  } catch (err) {
    alert('Network error');
  }
});

async function deleteRedirect(id) {
  if (!confirm('Delete this rewrite rule?')) return;
  try {
    const res = await fetch(`/api/redirects/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) loadRedirects();
  } catch (_) {}
}

// -------------------------------------------------------------
// Database Cloud Hub
// -------------------------------------------------------------
async function loadDatabases() {
  try {
    const res = await fetch('/api/databases', {
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (!data.success) return;

    renderDatabases(data.databases);
  } catch (err) {
    console.error('Error loading databases:', err);
  }
}

function renderDatabases(databases) {
  const grid = document.getElementById('databasesGrid');
  const typeIcons = {
    mysql: 'fa-solid fa-database text-blue-400',
    mariadb: 'fa-solid fa-leaf text-teal-400',
    postgres: 'fa-solid fa-elephant text-sky-400',
    mssql: 'fa-brands fa-microsoft text-rose-400'
  };

  grid.innerHTML = databases.map(db => `
    <div class="glass-card p-6 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2.5">
            <i class="${typeIcons[db.type] || 'fa-solid fa-database'} text-2xl"></i>
            <div>
              <h4 class="text-sm font-bold text-white">${db.name}</h4>
              <p class="text-[11px] text-slate-400 font-mono">Port ${db.port} • DB: <strong class="text-slate-200">${db.database_name}</strong></p>
            </div>
          </div>
          <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${db.isOnline ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}">
            ${db.isOnline ? 'ONLINE' : 'OFFLINE'}
          </span>
        </div>

        <div class="mt-4 p-3 bg-slate-900/90 rounded-xl border border-slate-800">
          <div class="flex items-center justify-between text-[10px] text-slate-400 mb-1 font-semibold uppercase">
            <span>Connection String / URI</span>
            <button onclick="copyToClipboard('${db.connectionUri}')" class="text-cyan-400 hover:text-cyan-300">
              <i class="fa-solid fa-copy mr-1"></i> Copy URI
            </button>
          </div>
          <input type="text" readonly value="${db.connectionUri}" class="w-full bg-transparent font-mono text-xs text-slate-300 focus:outline-none select-all truncate">
        </div>

        <div class="grid grid-cols-2 gap-2 mt-3 text-xs text-slate-400 font-mono">
          <div class="bg-slate-900/50 p-2 rounded-lg border border-slate-800/60">
            <span class="text-[10px] uppercase text-slate-500 block">User:</span>
            <span class="text-slate-200 font-bold">${db.username}</span>
          </div>
          <div class="bg-slate-900/50 p-2 rounded-lg border border-slate-800/60">
            <span class="text-[10px] uppercase text-slate-500 block">Password:</span>
            <span class="text-slate-200 font-bold">${db.password}</span>
          </div>
        </div>
      </div>

      <div class="mt-5 pt-4 border-t border-slate-800/80 flex items-center justify-between gap-2">
        <button onclick="openQueryModal('${db.id}', '${db.name}', '${db.type}')" class="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition">
          <i class="fa-solid fa-terminal"></i> Query Console
        </button>
        <button onclick="backupDatabaseDirect('${db.id}')" class="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-400 rounded-xl text-xs font-semibold border border-slate-700 transition flex items-center gap-1.5">
          <i class="fa-solid fa-cloud-arrow-down"></i> Backup SQL
        </button>
      </div>
    </div>
  `).join('');
}

function openQueryModal(dbId, dbName, dbType) {
  activeDbId = dbId;
  document.getElementById('queryModalTitle').innerText = `${dbName} — Query Console`;
  document.getElementById('queryModalSubtitle').innerText = `Target Database: ${dbId}`;
  
  const sampleQueries = {
    mysql: 'SHOW TABLES;\nSELECT * FROM information_schema.tables LIMIT 5;',
    mariadb: 'SHOW TABLES;\nSELECT * FROM information_schema.tables LIMIT 5;',
    postgres: 'SELECT tablename FROM pg_tables WHERE schemaname=\'public\';',
    mssql: 'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES;'
  };

  document.getElementById('sqlQueryInput').value = sampleQueries[dbType] || 'SHOW TABLES;';
  document.getElementById('queryResultsBox').innerHTML = '<div class="text-slate-500 italic">Click "Run Query" to execute...</div>';
  document.getElementById('queryModal').classList.remove('hidden');
}

function closeQueryModal() {
  document.getElementById('queryModal').classList.add('hidden');
}

async function executeSqlQuery() {
  if (!activeDbId) return;
  const query = document.getElementById('sqlQueryInput').value.trim();
  if (!query) return;

  const resultsBox = document.getElementById('queryResultsBox');
  const statusText = document.getElementById('queryStatusText');
  const runBtn = document.getElementById('runSqlBtn');

  try {
    runBtn.disabled = true;
    statusText.innerText = 'Executing query...';
    resultsBox.innerHTML = '<div class="text-cyan-400">Running query on database server...</div>';

    const res = await fetch('/api/databases/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentToken}`
      },
      body: JSON.stringify({ dbId: activeDbId, query })
    });
    const data = await res.json();
    runBtn.disabled = false;

    if (data.success) {
      statusText.innerText = 'Query completed successfully';
      if (data.columns && data.columns.length > 0) {
        let tableHtml = '<div class="overflow-x-auto"><table class="w-full text-left divide-y divide-slate-800 border border-slate-800"><thead class="bg-slate-800/60"><tr>';
        data.columns.forEach(col => {
          tableHtml += `<th class="p-2.5 font-bold text-cyan-400">${col}</th>`;
        });
        tableHtml += '</tr></thead><tbody class="divide-y divide-slate-800/60">';
        data.rows.forEach(row => {
          tableHtml += '<tr class="hover:bg-slate-800/40">';
          row.forEach(val => {
            tableHtml += `<td class="p-2.5 text-slate-300 font-mono">${escapeHtml(val || 'NULL')}</td>`;
          });
          tableHtml += '</tr>';
        });
        tableHtml += '</tbody></table></div>';
        resultsBox.innerHTML = tableHtml;
      } else {
        resultsBox.innerHTML = `<pre class="text-slate-200 whitespace-pre-wrap">${escapeHtml(data.raw || data.message || 'Query executed successfully')}</pre>`;
      }
    } else {
      statusText.innerText = 'Query error';
      resultsBox.innerHTML = `<div class="text-rose-400 font-bold">${escapeHtml(data.error || 'Query failed')}</div>`;
    }
  } catch (err) {
    runBtn.disabled = false;
    statusText.innerText = 'Execution failed';
    resultsBox.innerHTML = `<div class="text-rose-400">${err.message}</div>`;
  }
}

async function backupCurrentDatabase() {
  if (!activeDbId) return;
  backupDatabaseDirect(activeDbId);
}

async function backupDatabaseDirect(dbId) {
  try {
    alert('Starting database backup to 100GB Cloud Storage Drive...');
    const res = await fetch('/api/databases/backup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentToken}`
      },
      body: JSON.stringify({ dbId })
    });
    const data = await res.json();
    if (data.success) {
      alert(`✅ ${data.message}`);
      refreshStorage();
    } else {
      alert(`Backup failed: ${data.error}`);
    }
  } catch (err) {
    alert('Backup network error');
  }
}

// -------------------------------------------------------------
// Uploads & Drag-and-Drop
// -------------------------------------------------------------
function openUploadModal() {
  document.getElementById('uploadModal').classList.remove('hidden');
}

function closeUploadModal() {
  document.getElementById('uploadModal').classList.add('hidden');
  document.getElementById('uploadProgressBar').classList.add('hidden');
  document.getElementById('fileInput').value = '';
}

async function executeUpload() {
  const files = document.getElementById('fileInput').files;
  if (!files || files.length === 0) {
    alert('Please select at least one file to upload');
    return;
  }

  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }

  const progressBar = document.getElementById('uploadProgressBar');
  const progressFill = document.getElementById('uploadProgressFill');
  const progressPercent = document.getElementById('uploadProgressPercent');
  const submitBtn = document.getElementById('uploadSubmitBtn');

  progressBar.classList.remove('hidden');
  submitBtn.disabled = true;

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/storage/upload?path=${encodeURIComponent(currentPath)}`);
  xhr.setRequestHeader('Authorization', `Bearer ${currentToken}`);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const percent = Math.round((e.loaded / e.total) * 100);
      progressFill.style.width = `${percent}%`;
      progressPercent.innerText = `${percent}%`;
    }
  };

  xhr.onload = () => {
    submitBtn.disabled = false;
    if (xhr.status === 200) {
      closeUploadModal();
      refreshStorage();
    } else {
      alert(`Upload failed: ${xhr.responseText}`);
    }
  };

  xhr.onerror = () => {
    submitBtn.disabled = false;
    alert('Upload network error');
  };

  xhr.send(formData);
}

// Setup drag and drop
const dropZone = document.getElementById('dropZone');
['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
});
['dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
  });
});
dropZone.addEventListener('drop', (e) => {
  const files = e.dataTransfer.files;
  if (files && files.length > 0) {
    document.getElementById('fileInput').files = files;
    openUploadModal();
  }
});

// -------------------------------------------------------------
// Media Preview / Text Editor
// -------------------------------------------------------------
async function openPreview(pathStr, fileType) {
  currentPreviewPath = pathStr;
  const modal = document.getElementById('previewModal');
  const body = document.getElementById('previewBody');
  const title = document.getElementById('previewTitle');
  const saveBtn = document.getElementById('saveTextBtn');

  title.innerText = pathStr.split('/').pop();
  body.innerHTML = '<div class="text-slate-400 text-sm">Loading preview...</div>';
  saveBtn.classList.add('hidden');
  modal.classList.remove('hidden');

  const downloadUrl = `/api/storage/download?path=${encodeURIComponent(pathStr)}&token=${currentToken}&inline=1`;

  if (fileType === 'image') {
    body.innerHTML = `<img src="${downloadUrl}" class="max-h-[70vh] rounded-xl object-contain shadow-2xl">`;
  } else if (fileType === 'video') {
    body.innerHTML = `
      <video controls autoplay class="max-h-[70vh] w-full rounded-xl bg-black shadow-2xl">
        <source src="${downloadUrl}" type="video/mp4">
        Your browser does not support HTML video.
      </video>
    `;
  } else if (fileType === 'audio') {
    body.innerHTML = `
      <div class="p-8 text-center w-full max-w-md">
        <i class="fa-solid fa-music text-5xl text-emerald-400 mb-4"></i>
        <audio controls class="w-full mt-4">
          <source src="${downloadUrl}">
          Your browser does not support audio playback.
        </audio>
      </div>
    `;
  } else if (fileType === 'pdf') {
    body.innerHTML = `<iframe src="${downloadUrl}" class="w-full h-[70vh] rounded-xl border border-slate-800"></iframe>`;
  } else if (fileType === 'code' || fileType === 'file') {
    try {
      const res = await fetch(`/api/storage/text?path=${encodeURIComponent(pathStr)}`, {
        headers: { Authorization: `Bearer ${currentToken}` }
      });
      const data = await res.json();
      if (data.success) {
        body.innerHTML = `
          <textarea id="textEditorArea" class="w-full h-[65vh] bg-slate-900 font-mono text-xs text-slate-200 p-4 rounded-xl border border-slate-800 focus:outline-none focus:border-cyan-500">${escapeHtml(data.content)}</textarea>
        `;
        saveBtn.classList.remove('hidden');
      } else {
        body.innerHTML = `<div class="text-slate-500 text-xs">Binary file or preview unavailable. <a href="${downloadUrl}" class="text-cyan-400 underline">Download directly</a></div>`;
      }
    } catch (_) {
      body.innerHTML = '<div class="text-rose-400 text-xs">Failed to load text content</div>';
    }
  } else {
    body.innerHTML = `<div class="text-slate-400 text-xs">Preview not available. <a href="${downloadUrl}" class="text-cyan-400 underline ml-1">Download file</a></div>`;
  }
}

async function saveEditedTextFile() {
  if (!currentPreviewPath) return;
  const content = document.getElementById('textEditorArea').value;

  try {
    const res = await fetch('/api/storage/text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentToken}`
      },
      body: JSON.stringify({ path: currentPreviewPath, content })
    });
    const data = await res.json();
    if (data.success) {
      alert('File saved successfully!');
    } else {
      alert(data.error || 'Failed to save');
    }
  } catch (err) {
    alert('Network error');
  }
}

function closePreviewModal() {
  document.getElementById('previewModal').classList.add('hidden');
  document.getElementById('previewBody').innerHTML = '';
}

// -------------------------------------------------------------
// Share Links Modal & Creation
// -------------------------------------------------------------
function openShareModal(pathStr, name) {
  currentShareTarget = pathStr;
  document.getElementById('shareTargetName').value = name;
  document.getElementById('sharePasswordInput').value = '';
  document.getElementById('generatedShareUrlBox').classList.add('hidden');
  document.getElementById('createShareBtn').classList.remove('hidden');
  document.getElementById('shareModal').classList.remove('hidden');
}

function closeShareModal() {
  document.getElementById('shareModal').classList.add('hidden');
}

async function submitShareCreation() {
  const password = document.getElementById('sharePasswordInput').value;
  const expiresDays = document.getElementById('shareExpirySelect').value;

  try {
    const res = await fetch('/api/shares/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentToken}`
      },
      body: JSON.stringify({ path: currentShareTarget, password, expiresDays })
    });
    const data = await res.json();
    if (data.success) {
      const base = currentLiveTunnelUrl || window.location.origin;
      const fullShareUrl = `${base}${data.shareUrl}`;
      document.getElementById('generatedShareUrl').value = fullShareUrl;
      document.getElementById('generatedShareUrlBox').classList.remove('hidden');
      document.getElementById('createShareBtn').classList.add('hidden');
    } else {
      alert(data.error || 'Failed to create share link');
    }
  } catch (err) {
    alert('Network error');
  }
}

// -------------------------------------------------------------
// Domains & Reverse Proxy
// -------------------------------------------------------------
async function loadDomains() {
  try {
    const res = await fetch('/api/domains', {
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (!data.success) return;

    const tbody = document.getElementById('domainsTableBody');
    if (data.domains.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-500">No custom domain routes configured yet.</td></tr>';
      return;
    }

    tbody.innerHTML = data.domains.map(d => `
      <tr class="hover:bg-slate-900/40 transition">
        <td class="p-4 font-mono">
          <span class="font-bold text-cyan-400">${d.domain_name}</span>
          ${currentLiveTunnelUrl ? `<div class="text-[10px] text-purple-400 mt-0.5 truncate">Outside Alias: <a href="${currentLiveTunnelUrl}" target="_blank" class="underline">${currentLiveTunnelUrl}</a></div>` : ''}
        </td>
        <td class="p-4 font-mono text-slate-300">${d.target_url}</td>
        <td class="p-4">
          <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${d.is_active ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-500'}">
            ${d.is_active ? 'ACTIVE' : 'DISABLED'}
          </span>
        </td>
        <td class="p-4 text-slate-300 font-bold">${d.hits || 0}</td>
        <td class="p-4 text-slate-400">${d.description || '--'}</td>
        <td class="p-4 text-right">
          <button onclick="deleteDomain(${d.id})" class="p-1.5 text-slate-500 hover:text-rose-400 transition" title="Delete Route">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading domains:', err);
  }
}

function openAddDomainModal() {
  document.getElementById('addDomainModal').classList.remove('hidden');
}

function closeAddDomainModal() {
  document.getElementById('addDomainModal').classList.add('hidden');
}

document.getElementById('addDomainForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const domain_name = document.getElementById('newDomainName').value;
  const target_url = document.getElementById('newTargetUrl').value;
  const description = document.getElementById('newDomainDesc').value;

  try {
    const res = await fetch('/api/domains', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentToken}`
      },
      body: JSON.stringify({ domain_name, target_url, description })
    });
    const data = await res.json();
    if (data.success) {
      closeAddDomainModal();
      loadDomains();
    } else {
      alert(data.error || 'Failed to create domain');
    }
  } catch (err) {
    alert('Network error');
  }
});

async function deleteDomain(id) {
  if (!confirm('Are you sure you want to delete this domain route?')) return;
  try {
    const res = await fetch(`/api/domains/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) loadDomains();
  } catch (_) {}
}

// -------------------------------------------------------------
// Free Remote Tunnels & Dynamic DNS
// -------------------------------------------------------------
async function loadNetworkInfo() {
  try {
    const [infoRes, ddnsRes] = await Promise.all([
      fetch('/api/network/info', { headers: { Authorization: `Bearer ${currentToken}` } }),
      fetch('/api/network/ddns', { headers: { Authorization: `Bearer ${currentToken}` } })
    ]);

    const infoData = await infoRes.json();
    const ddnsData = await ddnsRes.json();

    if (infoData.success) {
      document.getElementById('detectedPublicIp').innerText = infoData.publicIp || 'Unknown';
    }

    if (ddnsData.success) {
      renderDdnsTable(ddnsData.configs);
    }
  } catch (_) {}
}

function renderDdnsTable(configs) {
  const tbody = document.getElementById('ddnsTableBody');
  if (!configs || configs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-500">No external DDNS providers configured yet.</td></tr>';
    return;
  }

  tbody.innerHTML = configs.map(c => `
    <tr class="hover:bg-slate-900/40 transition">
      <td class="p-3 font-bold text-white uppercase text-[11px]">${c.provider}</td>
      <td class="p-3 font-mono text-cyan-400">${c.domain_name}</td>
      <td class="p-3">
        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${c.last_status === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}">
          ${c.last_status}
        </span>
      </td>
      <td class="p-3 font-mono text-slate-300">${c.last_ip || '--'}</td>
      <td class="p-3 text-slate-400 text-[11px]">${c.last_updated ? new Date(c.last_updated).toLocaleString() : '--'}</td>
      <td class="p-3 text-right">
        <button onclick="deleteDdnsConfig(${c.id})" class="p-1.5 text-slate-500 hover:text-rose-400" title="Delete"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `).join('');
}

async function deleteDdnsConfig(id) {
  if (!confirm('Remove this DDNS provider config?')) return;
  try {
    const res = await fetch(`/api/network/ddns/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) loadNetworkInfo();
  } catch (_) {}
}

async function toggleTunnel() {
  const btn = document.getElementById('tunnelToggleBtn');
  const isStarting = btn.innerText.includes('Start');
  const provider = document.getElementById('tunnelProviderSelect').value;
  const port = parseInt(document.getElementById('tunnelPortSelect').value || '9000', 10);
  const token = document.getElementById('tunnelTokenInput').value;

  try {
    btn.disabled = true;
    if (isStarting) {
      btn.innerText = 'Connecting...';
      const res = await fetch('/api/tunnel/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`
        },
        body: JSON.stringify({ provider, port, token })
      });
      const data = await res.json();
      btn.disabled = false;
      if (!data.success) {
        alert(data.message || 'Failed to start tunnel');
      }
    } else {
      const res = await fetch('/api/tunnel/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`
        }
      });
      btn.disabled = false;
    }
  } catch (err) {
    btn.disabled = false;
    alert('Failed to toggle tunnel');
  }
}

document.getElementById('ddnsSyncForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const provider = document.getElementById('ddnsProvider').value;
  const domain = document.getElementById('ddnsDomain').value;
  const token = document.getElementById('ddnsToken').value;
  const resultDiv = document.getElementById('ddnsResult');

  try {
    resultDiv.classList.remove('hidden');
    resultDiv.className = 'mt-3 text-xs text-slate-400';
    resultDiv.innerText = `Syncing IP with ${provider}...`;

    const res = await fetch('/api/network/ddns/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentToken}`
      },
      body: JSON.stringify({ provider, domain, token })
    });
    const data = await res.json();
    if (data.success) {
      resultDiv.className = 'mt-3 text-xs text-emerald-400 font-bold';
      resultDiv.innerText = `✅ Dynamic DNS Synced successfully! Current IP: ${data.currentIp}`;
      loadNetworkInfo();
    } else {
      resultDiv.className = 'mt-3 text-xs text-rose-400';
      resultDiv.innerText = `Sync error: ${data.error || data.response}`;
    }
  } catch (_) {
    resultDiv.innerText = 'Network error';
  }
});

// -------------------------------------------------------------
// Cloud App Store & Containers
// -------------------------------------------------------------
async function loadApps() {
  try {
    const [templatesRes, containersRes] = await Promise.all([
      fetch('/api/apps/templates', { headers: { Authorization: `Bearer ${currentToken}` } }),
      fetch('/api/apps/containers', { headers: { Authorization: `Bearer ${currentToken}` } })
    ]);

    const templatesData = await templatesRes.json();
    const containersData = await containersRes.json();

    if (templatesData.success) {
      renderAppCatalog(templatesData.templates);
    }
    if (containersData.success) {
      renderContainers(containersData.containers);
    }
  } catch (err) {
    console.error('Error loading apps:', err);
  }
}

function renderAppCatalog(templates) {
  const grid = document.getElementById('appCatalogGrid');
  grid.innerHTML = templates.map(app => `
    <div class="glass-card p-6 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <span class="text-[10px] uppercase font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-md">${app.category}</span>
          <span class="text-xs font-mono text-slate-400">Port ${app.defaultPort}</span>
        </div>
        <h4 class="text-base font-bold text-white mb-1">${app.name}</h4>
        <p class="text-xs text-slate-400 leading-relaxed">${app.description}</p>
      </div>

      <div class="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between">
        <span class="text-xs text-slate-500 font-mono">${app.image}</span>
        <button onclick="deployApp('${app.id}')" class="gradient-btn px-4 py-2 text-xs font-bold text-white rounded-xl shadow">
          <i class="fa-solid fa-rocket mr-1"></i> Deploy
        </button>
      </div>
    </div>
  `).join('');
}

function renderContainers(containers) {
  const tbody = document.getElementById('containersTableBody');
  if (!containers || containers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500">No active AviCloud containers running. Deploy one above!</td></tr>';
    return;
  }

  tbody.innerHTML = containers.map(c => `
    <tr class="hover:bg-slate-900/40 transition">
      <td class="p-4 font-bold text-white">${c.name}</td>
      <td class="p-4 font-mono text-slate-400">${c.image}</td>
      <td class="p-4">
        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${c.state === 'running' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}">
          ${c.status}
        </span>
      </td>
      <td class="p-4 font-mono text-cyan-400">${c.ports || '--'}</td>
      <td class="p-4 text-right">
        <div class="flex items-center justify-end gap-2">
          ${c.state === 'running'
            ? `<button onclick="controlContainer('${c.name}', 'stop')" class="p-1.5 text-slate-400 hover:text-amber-400" title="Stop"><i class="fa-solid fa-stop"></i></button>`
            : `<button onclick="controlContainer('${c.name}', 'start')" class="p-1.5 text-slate-400 hover:text-emerald-400" title="Start"><i class="fa-solid fa-play"></i></button>`
          }
          <button onclick="controlContainer('${c.name}', 'restart')" class="p-1.5 text-slate-400 hover:text-cyan-400" title="Restart"><i class="fa-solid fa-arrows-rotate"></i></button>
          <button onclick="controlContainer('${c.name}', 'rm')" class="p-1.5 text-slate-400 hover:text-rose-400" title="Remove"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function deployApp(templateId) {
  try {
    alert(`Deploying ${templateId}... This may take a moment to pull the image.`);
    const res = await fetch('/api/apps/deploy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentToken}`
      },
      body: JSON.stringify({ templateId })
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message);
      loadApps();
    } else {
      alert(data.error || 'Deployment failed');
    }
  } catch (err) {
    alert('Network error');
  }
}

async function controlContainer(name, action) {
  try {
    const res = await fetch('/api/apps/control', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentToken}`
      },
      body: JSON.stringify({ containerName: name, action })
    });
    const data = await res.json();
    if (data.success) {
      loadApps();
    } else {
      alert(data.error || 'Action failed');
    }
  } catch (_) {}
}

// -------------------------------------------------------------
// Active Public Shares
// -------------------------------------------------------------
async function loadShares() {
  try {
    const res = await fetch('/api/shares', {
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (!data.success) return;

    const tbody = document.getElementById('sharesTableBody');
    if (data.shares.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-500">No active public share links created.</td></tr>';
      return;
    }

    const base = currentLiveTunnelUrl || window.location.origin;

    tbody.innerHTML = data.shares.map(s => {
      const fullUrl = `${base}/s/${s.token}`;
      return `
        <tr class="hover:bg-slate-900/40 transition">
          <td class="p-4 font-bold text-slate-200 truncate max-w-xs">${s.name}</td>
          <td class="p-4 font-mono text-cyan-400 text-xs">
            <div class="flex items-center gap-2">
              <span class="truncate max-w-[220px]">${fullUrl}</span>
              <button onclick="copyToClipboard('${fullUrl}')" class="text-slate-400 hover:text-cyan-300"><i class="fa-solid fa-copy"></i></button>
            </div>
          </td>
          <td class="p-4 text-xs">
            ${s.password_hash ? '<span class="text-amber-400 font-bold"><i class="fa-solid fa-lock mr-1"></i> Protected</span>' : '<span class="text-emerald-400"><i class="fa-solid fa-unlock mr-1"></i> Public</span>'}
          </td>
          <td class="p-4 text-slate-300 font-bold">${s.downloads_count}</td>
          <td class="p-4 text-slate-400 text-xs">${s.expires_at ? new Date(s.expires_at).toLocaleDateString() : 'Never'}</td>
          <td class="p-4 text-right">
            <button onclick="revokeShare(${s.id})" class="p-1.5 text-slate-500 hover:text-rose-400" title="Revoke Link">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading shares:', err);
  }
}

async function revokeShare(id) {
  if (!confirm('Revoke this share link?')) return;
  try {
    const res = await fetch(`/api/shares/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) loadShares();
  } catch (_) {}
}

// -------------------------------------------------------------
// Utilities & Global Helpers
// -------------------------------------------------------------
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert('Copied to clipboard: ' + text);
  }).catch(() => {
    prompt('Copy URL manually:', text);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function loadAllData() {
  refreshStorage();
  loadNfsStatus();
  loadDatabases();
  loadDomains();
  loadRedirects();
  loadNetworkInfo();
  loadApps();
  loadShares();
}

// Startup
(async () => {
  const authed = await checkAuth();
  if (authed) {
    loadAllData();
    initWebSocket();
  }
})();
