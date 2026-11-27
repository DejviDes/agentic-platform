#!/bin/bash
# install.sh – fills in the template launchd/agentic-platform.plist.template and saves it as ~/Library/LaunchAgents/local.agentic-platform.plist.
# macOS only. It does NOT start the service itself: at the end it prints the launchctl commands for you to run.
set -e

if [ "$(uname)" != "Darwin" ]; then
  echo "The launchd service exists only on macOS. On another system start the server by hand: npm start" >&2
  exit 1
fi

DIR=$(cd "$(dirname "$0")" && pwd)
APP_DIR=$(cd "$DIR/.." && pwd)
TEMPLATE="$DIR/agentic-platform.plist.template"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET="$TARGET_DIR/local.agentic-platform.plist"

[ -f "$TEMPLATE" ] || { echo "Template missing: $TEMPLATE" >&2; exit 1; }
[ -f "$APP_DIR/server.js" ] || { echo "No server.js in $APP_DIR" >&2; exit 1; }
[ -f "$APP_DIR/scripts/start.sh" ] || { echo "No scripts/start.sh in $APP_DIR" >&2; exit 1; }

# & < > must be escaped in XML
xml() { local s=$1; s=${s//&/&amp;}; s=${s//</&lt;}; s=${s//>/&gt;}; printf '%s' "$s"; }
CONTENT=$(cat "$TEMPLATE")
CONTENT=${CONTENT//__APP_DIR__/$(xml "$APP_DIR")}
CONTENT=${CONTENT//__HOME__/$(xml "$HOME")}

mkdir -p "$TARGET_DIR" "$HOME/Library/Logs"
if [ -f "$TARGET" ]; then
  echo "Note: $TARGET already exists and is overwritten."
fi
printf '%s\n' "$CONTENT" > "$TARGET"
plutil -lint "$TARGET" >/dev/null || { echo "The filled-in file is not a valid plist: $TARGET" >&2; exit 1; }

echo "Done: $TARGET"
echo
echo "Turn the service on (it then starts by itself after login) with these commands, this script does not run them:"
echo "  launchctl bootstrap gui/\$(id -u) \"$TARGET\""
echo "  launchctl kickstart -k gui/\$(id -u)/local.agentic-platform     # restart"
echo "Turn off and uninstall:"
echo "  launchctl bootout gui/\$(id -u)/local.agentic-platform"
echo "  rm \"$TARGET\""
echo "Log: ~/Library/Logs/agentic-platform.log, app: http://localhost:4747"
