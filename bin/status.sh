#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$DIR/data/avicloud.pid"

IS_RUNNING=0
PID=""

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    IS_RUNNING=1
  fi
fi

if [ $IS_RUNNING -eq 0 ]; then
  NODE_PID=$(pgrep -f "node.*server.js" | tail -n 1)
  if [ -n "$NODE_PID" ]; then
    IS_RUNNING=1
    PID=$NODE_PID
    echo $PID > "$PID_FILE"
  fi
fi

STORAGE_USAGE=$(du -sh "$DIR/storage_data" 2>/dev/null | cut -f1)

echo "=========================================="
echo "      🚀 AviCloud Platform Status"
echo "=========================================="
if [ $IS_RUNNING -eq 1 ]; then
  echo "Status:          RUNNING (PID: $PID)"
  echo "Web Dashboard:   http://localhost:9000"
  echo "Outside Shortcut:http://localhost:9000/outside"
  echo "Dynamic Proxy:   http://localhost:9080"
else
  echo "Status:          STOPPED"
fi
echo "Storage Pool:    100 GB Dedicated"
echo "Storage Path:    $DIR/storage_data"
echo "Storage Used:    $STORAGE_USAGE"
echo "=========================================="
