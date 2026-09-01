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

# Create optimized smb.conf compatible with Windows 10/11, macOS, and Linux
cat << CONF > /etc/samba/smb.conf
[global]
   workgroup = WORKGROUP
   netbios name = AVICLOUD
   server string = AviCloud Personal Storage
   security = user
   map to guest = Bad User
   passdb backend = tdbsam
   server role = standalone server
   obey pam restrictions = no
   ntlm auth = yes
   lanman auth = no
   server min protocol = NT1
   server max protocol = SMB3
   client min protocol = NT1
   client max protocol = SMB3
   load printers = no
   printing = bsd
   printcap name = /dev/null
   disable spoolss = yes
   dns proxy = no
   log file = /var/log/samba/log.%m
   max log size = 50

[storage]
   comment = AviCloud 100GB Cloud Drive
   path = $SHARE_DIR
   browseable = yes
   read only = no
   writable = yes
   valid users = $SMB_USER
   create mask = 0777
   directory mask = 0777
   force user = root
   force group = root
   vfs objects = acl_xattr
   map acl inherit = yes
   store dos attributes = yes
CONF

# Start NetBIOS daemon in background
nmbd -D

echo "Starting Authenticated Samba (SMB) Server for user: $SMB_USER..."
exec smbd -F --debug-stdout --no-process-group
