#!/usr/bin/env bash
# Claude Code on the web: set up the cloud VM at session start. Local sessions skip it.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
bash "$CLAUDE_PROJECT_DIR/scripts/bootstrap.sh" || true
