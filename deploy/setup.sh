#!/usr/bin/env bash
# 云主机一键部署：Docker + NapCat + 每日定时发布
# 用法（Ubuntu / Debian，root 执行）：
#   sudo bash deploy/setup.sh
# 可选环境变量：
#   APP_DIR=/opt/qwotday  RUN_AT='17 7 * * *'  QZONE_UIN=2707908134
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/AdLambXD/QWotDay.git}"
APP_DIR="${APP_DIR:-/opt/qwotday}"
RUN_AT="${RUN_AT:-17 7 * * *}"
TARGET_UIN="${QZONE_UIN:-}"

log() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root 运行：sudo bash deploy/setup.sh" >&2
  exit 1
fi

log '安装基础软件'
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates xz-utils cron

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true

NODE_MAJOR="$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/' || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  log '安装 Node.js 20'
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
NODE_BIN="$(command -v node)"
log "Node.js：$($NODE_BIN -v)"

log "准备代码：$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi

if [ ! -f "$APP_DIR/.env" ]; then
  log '生成 .env（请稍后填入 NAPCAT_TOKEN）'
  cat > "$APP_DIR/.env" <<EOF
# NapCat 的 OneBot HTTP 接口（容器已映射到本机 3000）
NAPCAT_API_URL=http://127.0.0.1:3000
# NapCat WebUI → 网络配置 → HTTP 服务器 里的 Token
NAPCAT_TOKEN=

# 只允许这个 QQ 号发帖；留空表示「NapCat 当前登录的号」
QZONE_UIN=${TARGET_UIN}

TIMEZONE=Asia/Shanghai
EOF
fi

log '启动 NapCat'
mkdir -p "$APP_DIR/deploy/napcat/config" "$APP_DIR/deploy/ntqq"
(
  cd "$APP_DIR/deploy"
  NAPCAT_UID="$(id -u)" NAPCAT_GID="$(id -g)" docker compose up -d
)

log '写入定时任务 /etc/cron.d/qwotday'
cat > /etc/cron.d/qwotday <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
CRON_TZ=Asia/Shanghai
${RUN_AT} root cd $APP_DIR && $NODE_BIN src/server.mjs >> /var/log/qwotday.log 2>&1
EOF
chmod 644 /etc/cron.d/qwotday
chmod +x "$APP_DIR/deploy/run.sh" 2>/dev/null || true

cat <<EOF

$(printf '\033[32m✔ 部署完成\033[0m')

接下来 3 步：

1) 扫码登录小号
   docker logs -f napcat
   日志里会给出 WebUI 地址和 token，浏览器打开后扫码。
   （服务器有公网 IP 的话，记得在安全组放行 6099）

2) 取 NapCat 的 HTTP Token 填到 .env
   WebUI → 网络配置 → 新建/查看「HTTP 服务器」(端口 3000)，把 token 抄下来：
   nano $APP_DIR/.env        # 填 NAPCAT_TOKEN=
   chmod 600 $APP_DIR/.env

3) 先手动跑一次，确认能发出去
   bash $APP_DIR/deploy/run.sh --dry     # 只打印文案
   bash $APP_DIR/deploy/run.sh           # 真发一条

之后按 cron「${RUN_AT}」自动执行（Asia/Shanghai），日志在 /var/log/qwotday.log
EOF
