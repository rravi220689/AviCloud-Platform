#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

PID_FILE="$DIR/data/avicloud.pid"
LOG_FILE="$DIR/data/avicloud.log"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "AviCloud is already running (PID: $PID)"
    echo "Web Dashboard: http://localhost:9000"
    exit 0
  fi
fi

echo "Starting AviCloud Platform..."
nohup /home/avinash/.local/bin/node server.js > "$LOG_FILE" 2>&1 &
NEW_PID=$!
echo $NEW_PID > "$PID_FILE"
sleep 1

if kill -0 "$NEW_PID" 2>/dev/null; then
  echo "✅ AviCloud Platform successfully started!"
  echo "📊 Web Dashboard:  http://localhost:9000"
  echo "🌐 Dynamic Proxy:  http://localhost:9080"
  echo "💾 100GB Storage:  $DIR/storage_data"
  echo "📝 Log file:       $LOG_FILE"
else
  echo "❌ Failed to start AviCloud. Check logs at $LOG_FILE"
  cat "$LOG_FILE"
  exit 1
fi
