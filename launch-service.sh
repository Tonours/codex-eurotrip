#!/bin/bash
# Launch SkyComputerUseService as a background daemon.
# This enables the native Computer Use tools (screenshots, AX tree, input)
# when the wrapper is launched by Codex Desktop.
set -euo pipefail

SERVICE="$HOME/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService"

if [ ! -x "$SERVICE" ]; then
  echo "ERROR: SkyComputerUseService not found at $SERVICE"
  exit 1
fi

# Check if already running
EXISTING=$(pgrep -x SkyComputerUseService 2>/dev/null || true)
if [ -n "$EXISTING" ]; then
  echo "SkyComputerUseService already running (PID: $EXISTING)"
  exit 0
fi

echo "Launching SkyComputerUseService..."
nohup "$SERVICE" > /dev/null 2>&1 &
sleep 1

# Verify
PID=$(pgrep -x SkyComputerUseService 2>/dev/null || true)
if [ -n "$PID" ]; then
  echo "✅ SkyComputerUseService running (PID: $PID)"
  echo "$PID" > /tmp/cua-service.pid
else
  echo "❌ Failed to start SkyComputerUseService"
  exit 1
fi
