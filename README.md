# 🚀 AviCloud Platform

**AviCloud** is a modern, lightweight, isolated Personal Cloud Operating Platform. It runs in user-space without interfering with any existing system services, providing a **100 GB Dedicated Cloud Storage Drive**, a **Database Cloud Hub**, a **Universal URL Redirection & Shortlink Engine**, a **Dynamic Reverse Proxy**, and **24/7 Auto-Healing Cloudflare Zero-Trust Tunnels** for seamless outside network access.

---

## ✨ Features

- **💾 100 GB Cloud Storage Drive**: Multi-file streaming uploads, folder management, drag-and-drop, inline media streaming (4K video range requests, audio player, code editor), and secure public share links with passwords & expiration timers.
- **🗄️ Database Cloud Hub**: Instant connection and management for 5 containerized database engines:
  - MySQL 8.0 (`jenkins-mysql` on port `3306`)
  - MariaDB 11.4 (`jenkins-mariadb` on port `3307`)
  - PostgreSQL 16 Primary (`jenkins-postgres` on port `5432`)
  - PostgreSQL 16 AppDB (`jenkins-postgres-new` on port `5433`)
  - Microsoft SQL Server 2022 (`jenkins-mssql` on port `1433`)
  - *Includes in-browser SQL Query Console and 1-click automated backups directly to storage.*
- **🔀 Universal URL Redirection & Custom Domain Routing**:
  - Shortlinks & Path routing: `http://localhost:9000/r/:slug` -> redirects/proxies to any target URL.
  - Reverse Proxy on port `9080` for custom subdomains.
  - Supports 301, 302, 307 redirects, transparent reverse proxy masking, and iframe embeds.
- **⚡ 24/7 Auto-Healing Cloudflare Tunnels (Zero Router Port Forwarding)**:
  - Continuously runs in the background.
  - Automatically captures and syncs generated `https://*.trycloudflare.com` URLs in real-time.
  - Dynamically updates outside network URLs for all created domains and redirection rules.
  - Auto-restarts within 5 seconds upon any network disconnection.
- **🔄 Multi-Provider Free Dynamic DNS (DDNS)**:
  - Cloudflare DNS API, FreeDNS (`afraid.org`), No-IP, Dynu, DuckDNS, and Custom HTTP Webhooks.
- **🛍️ Cloud App Store**: 1-click isolated deployment of Nextcloud, Vaultwarden, FileBrowser, Uptime Kuma, Portainer CE, and Redis.
- **📊 Real-Time Telemetry**: Live CPU, RAM, Disk, and 100GB pool meter via WebSockets.

---

## 🚀 Quick Start

### 1. Installation & Dependencies

```bash
git clone git@github.com:rravi220689/AviCloud-Platform.git
cd AviCloud-Platform
npm install
```

### 2. Management Scripts

```bash
# Start AviCloud in the background
./bin/start.sh

# Check server status, PID, and 100GB storage quota
./bin/status.sh

# Stop AviCloud cleanly
./bin/stop.sh
```

---

## 🌐 Default Ports & Access

| Component | URL | Description |
| :--- | :--- | :--- |
| **Web Dashboard** | `http://localhost:9000` | Main Admin & Drive Dashboard |
| **Outside Access** | `http://localhost:9000/outside` | Auto-redirect to live Cloudflare URL |
| **Dynamic Reverse Proxy** | `http://localhost:9080` | Proxy for custom subdomains |
| **URL Redirection Route** | `http://localhost:9000/r/:slug` | Custom URL forwarder |

---

## 🔄 Always-On & Auto-Start Configuration

AviCloud is configured to start automatically on system boot via user `systemd` service and `@reboot` crontab:

```bash
# Enable systemd user service
systemctl --user enable avicloud.service
systemctl --user start avicloud.service

# Check service status
systemctl --user status avicloud.service
```

---

## 📄 License
MIT License
