#!/bin/sh
set -e

SMB_USER=${SMB_USER:-avinash}
SMB_PASS=${SMB_PASS:-Avinash@Cloud1989}
SHARE_DIR=${SHARE_DIR:-/storage}

mkdir -p "$SHARE_DIR"

# Add user if not exists
if ! id -u "$SMB_USER" >/dev/null 2>&1; then
    adduser -D -H -s /sbin/nologin "$SMB_USER"
fi

# Set Samba password
(echo "$SMB_PASS"; echo "$SMB_PASS") | smbpasswd -a -s "$SMB_USER"
smbpasswd -e "$SMB_USER"

# Create username map for Windows domain prefixes
cat << MAP > /etc/samba/usermap.txt
$SMB_USER = WORKGROUP\\$SMB_USER 165.101.251.196\\$SMB_USER AVICLOUD\\$SMB_USER localhost\\$SMB_USER
MAP

# Create smb.conf optimized for Windows 10 & 11, macOS, and Linux
cat << CONF > /etc/samba/smb.conf
[global]
   workgroup = WORKGROUP
   netbios name = AVICLOUD
   server string = AviCloud Storage Server
   security = user
   map to guest = Bad User
   passdb backend = tdbsam
   server role = standalone server
   obey pam restrictions = no
   username map = /etc/samba/usermap.txt

   # Authentication & Protocols
   ntlm auth = yes
   raw NTLMv2 auth = yes
   server min protocol = SMB2_02
   server max protocol = SMB3_11
   client min protocol = SMB2_02
   client max protocol = SMB3_11

   # Windows 11 Signing & Encryption Compatibility
   server signing = auto
   server smb encrypt = auto

   # File attributes & Case Sensitivity for Windows
   case sensitive = no
   preserve case = yes
   short preserve case = yes
   ea support = yes
   vfs objects = acl_xattr
   map acl inherit = yes
   store dos attributes = yes

   # Disable printing
   load printers = no
   printing = bsd
   printcap name = /dev/null
   disable spoolss = yes

   # Logging
   log file = /var/log/samba/log.%m
   max log size = 50

[storage]
   comment = AviCloud 100GB Cloud Drive
   path = $SHARE_DIR
   browseable = yes
   read only = no
   writable = yes
   guest ok = no
   valid users = $SMB_USER
   admin users = $SMB_USER
   create mask = 0777
   directory mask = 0777
   force user = root
   force group = root
   force create mode = 0777
   force directory mode = 0777
CONF

# Start NetBIOS Name Server Daemon
nmbd -D

echo "Starting Authenticated Samba (SMB) Server for user: $SMB_USER..."
exec smbd -F --debug-stdout --no-process-group
