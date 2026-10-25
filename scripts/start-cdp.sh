#!/usr/bin/env bash
set -euo pipefail

find_chromium() {
  local directory app executable
  for directory in /Applications "$HOME/Applications"; do
    [[ -d "$directory" ]] || continue
    app="$(find "$directory" -maxdepth 2 -type d \( -name 'Chromium.app' -o -name 'Google Chrome.app' \) -print -quit)"
    if [[ -n "$app" ]]; then
      printf '%s\n' "$app"
      return
    fi
  done
  for executable in chromium chromium-browser google-chrome; do
    if command -v "$executable"; then return; fi
  done
}

export SHOW_TOOLS_CHROMIUM_APP="${SHOW_TOOLS_CHROMIUM_APP:-$(find_chromium)}"
export SHOW_TOOLS_CDP_PORT="${SHOW_TOOLS_CDP_PORT:-9222}"
export SHOW_TOOLS_CDP_PROFILE="${SHOW_TOOLS_CDP_PROFILE:-${TMPDIR:-/tmp}/show-tools-sheets-cdp}"
export SHOW_TOOLS_PRACTICE_ORIGIN="${SHOW_TOOLS_PRACTICE_ORIGIN:-http://127.0.0.1:8082}"

exec node --import tsx "$(dirname "$0")/start-cdp.ts"
