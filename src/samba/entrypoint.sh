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

# Create smb.conf
cat << CONF > /etc/samba/smb.conf
[global]
   workgroup = WORKGROUP
   server string = AviCloud Personal Storage
   security = user
   map to guest = Never
   passdb backend = tdbsam
   log file = /var/log/samba/log.%m
   max log size = 50
   dns proxy = no
   server min protocol = SMB2
   server max protocol = SMB3

[storage]
   comment = AviCloud 100GB Cloud Drive
   path = $SHARE_DIR
   browseable = yes
   read only = no
   writable = yes
   valid users = $SMB_USER
   create mask = 0775
   directory mask = 0775
   force user = root
   force group = root
CONF

echo "Starting Authenticated Samba (SMB) Server for user: $SMB_USER..."
exec smbd -F --debug-stdout --no-process-group
