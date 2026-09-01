#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$DIR/data/avicloud.pid"

echo "=========================================="
echo "      🚀 AviCloud Platform Status"
echo "=========================================="

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Status:          RUNNING (PID: $PID)"
    echo "Dashboard URL:   http://localhost:9000"
    echo "Proxy URL:       http://localhost:9080"
  else
    echo "Status:          STOPPED (Stale PID file)"
  fi
else
  echo "Status:          STOPPED"
fi

echo "Storage Pool:    100 GB Allocated"
echo "Storage Path:    $DIR/storage_data"
echo "Storage Used:    $(du -sh "$DIR/storage_data" 2>/dev/null | cut -f1)"
echo "=========================================="
