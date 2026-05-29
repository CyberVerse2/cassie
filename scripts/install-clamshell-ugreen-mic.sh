#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_file="$repo_root/scripts/clamshell-ugreen-mic.swift"
install_dir="$HOME/.local/bin"
binary="$install_dir/cassie-clamshell-ugreen-mic"
agent_dir="$HOME/Library/LaunchAgents"
agent_plist="$agent_dir/com.thecyberverse.clamshell-ugreen-mic.plist"
cache_dir="/private/tmp/cassie-swift-module-cache"

mkdir -p "$install_dir" "$agent_dir" "$cache_dir"

swiftc -module-cache-path "$cache_dir" -o "$binary" "$source_file"
chmod 755 "$binary"

cat > "$agent_plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.thecyberverse.clamshell-ugreen-mic</string>
  <key>ProgramArguments</key>
  <array>
    <string>$binary</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>/tmp/com.thecyberverse.clamshell-ugreen-mic.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/com.thecyberverse.clamshell-ugreen-mic.err</string>
</dict>
</plist>
PLIST

plutil -lint "$agent_plist"

uid="$(id -u)"
launchctl bootout "gui/$uid" "$agent_plist" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$uid" "$agent_plist"
launchctl kickstart -k "gui/$uid/com.thecyberverse.clamshell-ugreen-mic"

"$binary"
