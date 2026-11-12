#!/usr/bin/env bash
# 手动跑一次（调试用）
#   bash deploy/run.sh --dry    只打印文案，不发布
#   bash deploy/run.sh          真发一条
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

exec node src/server.mjs "$@"
