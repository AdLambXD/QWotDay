#!/usr/bin/env bash
# 云主机一键部署：Docker + NapCat + 每日定时发布
# 支持 Debian/Ubuntu(apt) 与 RHEL/CentOS/Alibaba Cloud Linux(dnf)
#
# 用法（root）：
#   bash deploy/setup.sh
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

# ---------- 包管理器 ----------
if command -v apt-get >/dev/null 2>&1; then
  PKG=apt
elif command -v dnf >/dev/null 2>&1; then
  PKG=dnf
elif command -v yum >/dev/null 2>&1; then
  PKG=yum
else
  echo "不认识的系统：既没有 apt-get 也没有 dnf/yum" >&2
  exit 1
fi

log "系统包管理器：$PKG"

if [ "$PKG" = apt ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git curl ca-certificates cron
else
  $PKG install -y -q git curl ca-certificates cronie >/dev/null
fi

# ---------- Docker ----------
if ! command -v docker >/dev/null 2>&1; then
  log '安装 Docker'
  if [ "$PKG" = apt ]; then
    curl -fsSL https://get.docker.com | sh
  else
    $PKG install -y -q dnf-plugins-core >/dev/null 2>&1 || true
    $PKG config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo >/dev/null 2>&1 || true
    $PKG install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
  fi
fi
systemctl enable --now docker >/dev/null 2>&1 || true

if ! docker compose version >/dev/null 2>&1; then
  log '安装 docker compose 插件'
  if [ "$PKG" = apt ]; then
    apt-get install -y -qq docker-compose-plugin
  else
    $PKG install -y -q docker-compose-plugin
  fi
fi

# ---------- Node.js ----------
NODE_MAJOR="$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/' || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  log '安装 Node.js 20'
  if [ "$PKG" = apt ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
  else
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    $PKG install -y -q nodejs
  fi
fi
NODE_BIN="$(command -v node)"
log "Node.js：$($NODE_BIN -v)"

# ---------- 代码 ----------
log "准备代码：$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
elif [ -f "$APP_DIR/src/server.mjs" ]; then
  log '已有代码（不是 git 仓库），跳过下载'
else
  mkdir -p "$APP_DIR"
  if ! git clone --depth 1 "$REPO_URL" "$APP_DIR" 2>/dev/null; then
    echo "从 GitHub 拉取失败。请把仓库打包上传后解压到 $APP_DIR，再重新运行本脚本。" >&2
    exit 1
  fi
fi

if [ ! -f "$APP_DIR/.env" ]; then
  TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  log '生成 .env'
  cat > "$APP_DIR/.env" <<EOF
# NapCat 的 OneBot HTTP 接口（容器已映射到本机 3000）
NAPCAT_API_URL=http://127.0.0.1:3000
# 与 NapCat WebUI → 网络配置 → HTTP 服务器 里的 token 保持一致
NAPCAT_TOKEN=${TOKEN}

# 只允许这个 QQ 号发帖；留空表示「NapCat 当前登录的号」
QZONE_UIN=${TARGET_UIN}

TIMEZONE=Asia/Shanghai

# 同步 Cookie 到 GitHub Secret（备用通道）用，格式 owner/repo；留空则不同步
GITHUB_REPO=

# 发帖失败时用 NapCat 给这个 QQ 发提醒；留空则不提醒
ALERT_QQ=
EOF
fi
chmod 600 "$APP_DIR/.env"

# docker compose 会自动读取同目录下的 .env，这里放容器参数
if [ ! -f "$APP_DIR/deploy/.env" ]; then
  cat > "$APP_DIR/deploy/.env" <<EOF
NAPCAT_UID=$(id -u)
NAPCAT_GID=$(id -g)
NAPCAT_QQ=${TARGET_UIN}
EOF
  chmod 600 "$APP_DIR/deploy/.env"
fi

# ---------- NapCat ----------
log '启动 NapCat'
mkdir -p "$APP_DIR/deploy/napcat/config" "$APP_DIR/deploy/ntqq"
(
  cd "$APP_DIR/deploy"
  NAPCAT_UID="$(id -u)" NAPCAT_GID="$(id -g)" docker compose up -d
)

# ---------- 定时任务 ----------
log '写入定时任务 /etc/cron.d/qwotday'
cat > /etc/cron.d/qwotday <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
CRON_TZ=Asia/Shanghai
${RUN_AT} root cd $APP_DIR && $NODE_BIN src/server.mjs >> /var/log/qwotday.log 2>&1
EOF
chmod 644 /etc/cron.d/qwotday
chmod +x "$APP_DIR/deploy/run.sh" 2>/dev/null || true

if [ "$PKG" != apt ]; then
  systemctl enable --now crond >/dev/null 2>&1 || true
fi

cat <<EOF

$(printf '\033[32m✔ 部署完成\033[0m')

接下来：

1) 扫码登录小号
   docker logs -f napcat
   WebUI 只监听 127.0.0.1，请在你自己的电脑上开隧道：
     ssh -L 6099:127.0.0.1:6099 root@<服务器IP>
   然后浏览器打开 http://127.0.0.1:6099/webui/
   用手机上的小号扫码（日志里有 WebUI token）

2) 确认 HTTP 接口的 token 与 .env 一致
   cat $APP_DIR/.env

3) 手动验证
   bash $APP_DIR/deploy/run.sh --dry
   bash $APP_DIR/deploy/run.sh

定时：$RUN_AT（Asia/Shanghai），日志 /var/log/qwotday.log
EOF
