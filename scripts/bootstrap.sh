#!/usr/bin/env bash
# Set up a dev machine or a Claude Code cloud session for Racing Boy. Safe to rerun.
# The game needs nothing installed. This checks Node (tests, drift lab, dev
# server) and installs playwright-core for headless screenshots (npm run shot).
#   bash scripts/bootstrap.sh               # check Node, install playwright-core
#   bash scripts/bootstrap.sh --no-browser  # check Node only
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null; then
  echo "bootstrap: Node.js 20 or newer is required (node not found)" >&2
  exit 1
fi
major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 20 ]; then
  echo "bootstrap: Node.js 20 or newer is required (found $(node --version))" >&2
  exit 1
fi
echo "bootstrap: node $(node --version)"

[ "${1:-}" = "--no-browser" ] && exit 0

if [ ! -d node_modules/playwright-core ]; then
  npm install --no-audit --no-fund --loglevel=error
fi

# shot.mjs drives an installed Chrome when it finds one (the cloud image has
# Chrome for Testing at $CHROME_PATH). Otherwise fetch Playwright's Chromium.
# A failed download leaves tests, the drift lab and the server working.
if [ -n "${CHROME_PATH:-}" ] || command -v google-chrome >/dev/null || command -v chromium >/dev/null; then
  echo "bootstrap: screenshots will use the installed Chrome"
elif npx --no-install playwright-core install chromium >/dev/null 2>&1; then
  echo "bootstrap: Playwright Chromium installed for screenshots"
else
  echo "bootstrap: no Chrome found and the Chromium download failed; npm run shot unavailable" >&2
fi

# The HUD uses emoji; without an emoji font they shoot as empty boxes.
if [ "$(id -u)" = 0 ] && command -v apt-get >/dev/null && command -v fc-list >/dev/null \
   && ! fc-list | grep -qi emoji; then
  if apt-get install -y -qq fonts-noto-color-emoji >/dev/null 2>&1; then
    echo "bootstrap: installed an emoji font"
  else
    echo "bootstrap: no emoji font (apt-get failed); HUD icons shoot as boxes" >&2
  fi
fi
