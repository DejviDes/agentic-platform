#!/bin/bash
# Mac sleep: allows your account, once, to run `sudo pmset -a disablesleep 0|1` without a password (only these two commands, nothing else).
# Run in Terminal from the app folder: sudo bash scripts/sleep-sudo.sh
# The rule names pmset, not this script, so moving or renaming the script does not affect an existing rule
# (an older install has the same rule in /etc/sudoers.d/mesto-agentov-spanok, it keeps working).
# Undo: sudo rm /etc/sudoers.d/agentic-platform-sleep
set -u
if [ "$(id -u)" -ne 0 ]; then echo "Run as: sudo bash $0"; exit 1; fi
U="${SUDO_USER:-}"
if [ -z "$U" ] || [ "$U" = "root" ]; then echo "SUDO_USER is missing (run it through sudo as a normal user)."; exit 1; fi
if ! printf '%s' "$U" | grep -Eq '^[A-Za-z0-9._-]+$'; then echo "Invalid user name: $U"; exit 1; fi
if [ -f /etc/sudoers.d/mesto-agentov-spanok ]; then echo "Already set up: /etc/sudoers.d/mesto-agentov-spanok. Check: sudo -n -l /usr/bin/pmset -a disablesleep 1"; exit 0; fi
F=/etc/sudoers.d/agentic-platform-sleep
T=$(mktemp /tmp/agentic-sleep.XXXXXX)
printf '%s ALL=(root) NOPASSWD: /usr/bin/pmset -a disablesleep 0, /usr/bin/pmset -a disablesleep 1\n' "$U" > "$T"
if /usr/sbin/visudo -cf "$T" >/dev/null; then
  install -m 440 -o root -g wheel "$T" "$F" && rm -f "$T"
  if /usr/sbin/visudo -cf "$F" >/dev/null; then
    echo "Done: $F (user $U). Check: sudo -n -l /usr/bin/pmset -a disablesleep 1"
  else
    rm -f "$F"; echo "The file could not be verified, deleted."; exit 1
  fi
else
  rm -f "$T"; echo "visudo rejected the rule, nothing was written."; exit 1
fi
