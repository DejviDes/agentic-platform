#!/bin/bash
# Starts the Agentic Platform server for launchd (the service template in launchd/).
# launchd has no terminal PATH: claude (~/.local/bin), git, uv, ffmpeg (Homebrew) and node from nvm (newest v2x).
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
NODE_DIR=$(ls -d "$HOME"/.nvm/versions/node/v2*/bin 2>/dev/null | sort -V | tail -1)
[ -n "$NODE_DIR" ] && export PATH="$NODE_DIR:$PATH"
cd "$(dirname "$0")/.." || exit 1
echo "--- $(date '+%Y-%m-%d %H:%M:%S') start, $(command -v node) $(node -v)"
exec node server.js
