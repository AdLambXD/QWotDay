#!/usr/bin/env bash
# 一键体检：容器、登录态、取 Cookie、最近一次发帖结果
# 用法：bash deploy/health.sh
set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

ok() { printf '\033[32m✔\033[0m %s\n' "$*"; }
bad() { printf '\033[31m✘\033[0m %s\n' "$*"; }

# shellcheck disable=SC1091
set -a; . "$APP_DIR/.env" 2>/dev/null; set +a
API="${NAPCAT_API_URL:-http://127.0.0.1:3000}"
TOKEN="${NAPCAT_TOKEN:-}"

echo "== 容器 =="
if docker ps --filter name=^napcat$ --format '{{.Status}}' | grep -q Up; then
  ok "napcat 运行中：$(docker ps --filter name=^napcat$ --format '{{.Status}}')"
else
  bad "napcat 没在运行"
fi

echo
echo "== 登录态 =="
if docker logs --tail 300 napcat 2>&1 | tail -300 | grep -q '请扫描下面的二维码'; then
  bad "正在等待扫码（登录态已掉）"
else
  ok "没有等待扫码"
fi

echo
echo "== /get_cookies =="
RESP=$(curl -s -m 10 -X POST "$API/get_cookies" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"domain":"user.qzone.qq.com"}')

if echo "$RESP" | grep -q '"status":"ok"'; then
  OK=$(echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);c=d['data']['cookies'];print('yes' if 'p_skey=' in c else 'no')" 2>/dev/null)
  if [ "$OK" = yes ]; then ok "能取到 Cookie（含 p_skey）"; else bad "取到了 Cookie 但没有 p_skey"; fi
else
  bad "取 Cookie 失败：$(echo "$RESP" | head -c 200)"
fi

echo
echo "== 最近一次发帖 =="
tail -n 40 /var/log/qwotday.log 2>/dev/null | grep -E '发布成功|回读校验|❌' | tail -4 \
  || echo "（还没有日志，或今天还没跑）"

echo
echo "== 资源 =="
free -h | sed -n '2p'
docker stats --no-stream --format '  {{.Name}} {{.MemUsage}}' | grep -E 'napcat' || true
