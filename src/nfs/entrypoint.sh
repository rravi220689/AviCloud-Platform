#!/bin/bash
rpcbind -w
echo "/storage (rw,no_root_squash)" > /etc/exports
echo "Starting User-Space NFS Server (unfsd) on port 2049..."
exec /usr/sbin/unfsd -d -e /etc/exports -p
