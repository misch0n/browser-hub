#!/bin/bash
# Cloud sessions (claude.ai/code): install the test-only packages so every
# suite can run (see docs/testing.md). Chromium is pre-installed there.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# Idempotent: skip when the pinned versions are already installed.
have() { node -e "process.exit(require('./node_modules/$1/package.json').version === '$2' ? 0 : 1)" 2>/dev/null; }
if have playwright 1.56.1 && have jsqr 1.4.0 && have @zxing/library 0.21.3; then
  exit 0
fi

PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm run setup --silent
