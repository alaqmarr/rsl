#!/usr/bin/env bash
# Safe Scoped PM2 Controller for RSL Marketing (Ports 4500-4600 ONLY)
# Usage: ./infra/scripts/rsl-pm2-ctl.sh {start|restart|reload|cleanup|stop|delete|status}
# Guaranteed NEVER to affect non-RSL PM2 processes or ports outside 4500-4600.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ACTION="${1:-status}"
cd "$REPO_ROOT"
exec node infra/pm2/pm2-manager.mjs "$ACTION"
