#!/bin/bash
set -euo pipefail

# ==============================================================================
# SolanaLPSn 新加坡服务器原生直连一键部署脚本（免 Docker）
# 仓库地址: https://github.com/ortersq/SolanaLPSn.git
# 安全原则: 交易私钥与盈利收款地址仅在服务器 SSH 终端输入并写入 chmod 600 .env
# ==============================================================================

REPO_URL="https://github.com/ortersq/SolanaLPSn.git"
APP_DIR="SolanaLPSn"

echo "============================================================"
echo "  SolanaLPSn 原生直连一键部署 (Node.js + PM2，无需 Docker)"
echo "============================================================"

# 1. 确保基础工具就绪
if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  echo "[1/6] 安装基础工具 (git / curl)..."
  sudo apt-get update -y >/dev/null
  sudo apt-get install -y git curl ca-certificates >/dev/null
else
  echo "[1/6] 基础工具 git / curl 已就绪。"
fi

# 2. 检查并安装 Node.js 20.x（原生运行，无需 Docker）
NEED_NODE=false
if ! command -v node >/dev/null 2>&1; then
  NEED_NODE=true
else
  NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
  if [ "${NODE_MAJOR:-0}" -lt 18 ]; then
    NEED_NODE=true
  fi
fi

if [ "$NEED_NODE" = true ]; then
  echo "[2/6] 正在安装 Node.js 20.x LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "[2/6] Node.js 已就绪: $(node -v)"
fi

# 3. 检查并安装 PM2 后台进程守护工具
if ! command -v pm2 >/dev/null 2>&1; then
  echo "[3/6] 正在安装 PM2 守护进程管理器..."
  npm install -g pm2 2>/dev/null || sudo npm install -g pm2
else
  echo "[3/6] PM2 已就绪: $(pm2 -v)"
fi

# 4. 克隆或更新 GitHub 仓库代码
echo "[4/6] 同步 GitHub 仓库代码 ($REPO_URL)..."
if [ -f "package.json" ] && [ -f "server.ts" ]; then
  echo "当前已在项目目录中，正在拉取最新代码..."
  git pull --ff-only || true
else
  if [ -d "$APP_DIR" ]; then
    cd "$APP_DIR"
    git pull --ff-only || true
  else
    git clone "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
  fi
fi

# 5. 配置后台私有 .env（支持保留已填写的 .env）
echo "[5/6] 检查后台私有 .env 配置..."
if [ -f ".env" ]; then
  read -r -p "检测到已存在 .env（含私钥与收款地址），是否保留并直接启动？[Y/n]: " KEEP_ENV < /dev/tty || KEEP_ENV="y"
  if [[ "${KEEP_ENV:-y}" =~ ^[Nn]$ ]]; then
    OVERWRITE_ENV="y"
  else
    OVERWRITE_ENV="n"
  fi
else
  OVERWRITE_ENV="y"
fi

if [ "$OVERWRITE_ENV" = "y" ]; then
  read -s -r -p "请输入交易钱包 Base58 私钥（建议专款专用，输入时屏幕不回显）: " INPUT_PRIVATE_KEY < /dev/tty
  echo ""
  if [ -z "${INPUT_PRIVATE_KEY}" ]; then
    echo "[错误] 交易钱包私钥不能为空！"
    exit 1
  fi

  read -r -p "请输入盈利接收 Solana 公钥地址（必填）: " INPUT_RECIPIENT < /dev/tty
  if [ -z "${INPUT_RECIPIENT}" ]; then
    echo "[错误] 盈利接收地址不能为空！"
    exit 1
  fi

  read -r -p "请输入前端概览脱敏展示的观测钱包公钥（可选，直接回车跳过）: " INPUT_WATCH < /dev/tty || INPUT_WATCH=""
  read -r -p "请输入投入资金策略档位 [1=稳健平衡型(默认) / 2=极稳保守型 / 3=进取增效型]: " PROFILE_CHOICE < /dev/tty || PROFILE_CHOICE="1"

  case "${PROFILE_CHOICE}" in
    2)
      RISK_PROFILE="ultra-safe"
      MIN_TVL_USD="3000000"
      MIN_APR="25"
      RANGE_WIDTH_PCT="20"
      STOP_LOSS_PCT="5"
      SLIPPAGE_BPS="30"
      ;;
    3)
      RISK_PROFILE="active-yield"
      MIN_TVL_USD="500000"
      MIN_APR="60"
      RANGE_WIDTH_PCT="6"
      STOP_LOSS_PCT="8"
      SLIPPAGE_BPS="60"
      ;;
    *)
      RISK_PROFILE="balanced-steady"
      MIN_TVL_USD="2000000"
      MIN_APR="45"
      RANGE_WIDTH_PCT="10"
      STOP_LOSS_PCT="6"
      SLIPPAGE_BPS="50"
      ;;
  esac

  cat << EOF > .env
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=5641e03b-ad1b-46b8-bd65-97bde80f9c3e
PRIVATE_KEY=${INPUT_PRIVATE_KEY}
RECIPIENT_ADDRESS=${INPUT_RECIPIENT}
WATCH_WALLET_ADDRESS=${INPUT_WATCH}
RISK_PROFILE=${RISK_PROFILE}
CAPITAL_USDT=200
MIN_TVL_USD=${MIN_TVL_USD}
MIN_APR=${MIN_APR}
RANGE_WIDTH_PCT=${RANGE_WIDTH_PCT}
HARVEST_MIN_USD=2.5
STOP_LOSS_PCT=${STOP_LOSS_PCT}
SLIPPAGE_BPS=${SLIPPAGE_BPS}
DRY_RUN=true
EOF

  chmod 600 .env
  unset INPUT_PRIVATE_KEY
  echo "已安全写入受保护的 .env（chmod 600），默认启用 DRY_RUN=true 演练模式。"
fi

# 6. 安装依赖、编译前端并通过 PM2 启动双服务（零 Docker）
echo "[6/6] 安装依赖、构建页面并启动后台进程..."
npm install --include=dev --legacy-peer-deps --no-audit --no-fund
npm run build
(cd bot && npm install --omit=dev --no-audit --no-fund)

pm2 delete solana-lp-web solana-lp-bot >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs
pm2 save

# 放行防火墙 3000 端口（如果启用了 ufw）
if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q "Status: active"; then
  sudo ufw allow 3000/tcp >/dev/null || true
fi

PUBLIC_IP=$(curl -fsS --max-time 3 https://api.ipify.org || echo "你的服务器IP")

echo ""
echo "============================================================"
echo "  原生部署完成！无需 Docker，已由 PM2 在后台 7×24 守护运行"
echo "============================================================"
echo "  策略与风控展示台: http://${PUBLIC_IP}:3000"
echo "  查看进程状态:     pm2 status"
echo "  查看实时风控日志: pm2 logs solana-lp-bot"
echo "  查看网页服务日志: pm2 logs solana-lp-web"
echo "  确认无误开启实盘: sed -i 's/DRY_RUN=true/DRY_RUN=false/' .env && pm2 restart solana-lp-bot --update-env"
echo "  设置开机自启动:   pm2 startup (按提示复制运行输出的命令即可)"
echo "============================================================"
