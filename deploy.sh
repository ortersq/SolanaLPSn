#!/bin/bash
set -euo pipefail

# ==============================================================================
# SolanaLPSn 新加坡服务器一键部署脚本
# 仓库地址: https://github.com/ortersq/SolanaLPSn.git
# 安全原则: 交易私钥与盈利收款地址仅在服务器 SSH 终端输入并写入 chmod 600 .env
# ==============================================================================

REPO_URL="https://github.com/ortersq/SolanaLPSn.git"
APP_DIR="SolanaLPSn"

echo "============================================================"
echo "  SolanaLPSn 一键部署工具 (适用 Ubuntu / Debian 新加坡 VPS)"
echo "============================================================"

# 1. 确保已安装 git 与 curl
if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  echo "[1/5] 安装基础依赖 (git / curl)..."
  sudo apt-get update -y >/dev/null
  sudo apt-get install -y git curl ca-certificates >/dev/null
else
  echo "[1/5] 基础依赖 git / curl 已就绪。"
fi

# 2. 检查并自动安装 Docker & Docker Compose 插件
if ! command -v docker >/dev/null 2>&1; then
  echo "[2/5] 未检测到 Docker，正在自动安装官方 Docker 引擎..."
  curl -fsSL https://get.docker.com | sh
  sudo systemctl enable --now docker || true
else
  echo "[2/5] Docker 已安装: $(docker --version)"
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[2/5] 正在安装 docker-compose-plugin..."
  sudo apt-get update -y >/dev/null && sudo apt-get install -y docker-compose-plugin >/dev/null
fi

# 3. 克隆或更新 GitHub 仓库代码
echo "[3/5] 同步 GitHub 仓库代码 ($REPO_URL)..."
if [ -f "package.json" ] && [ -f "docker-compose.yml" ]; then
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

# 4. 交互式写入后端私有 .env（支持 curl | bash 通过 /dev/tty 安全读取）
echo "[4/5] 配置后台私有 .env（交易私钥与收款地址全程不经过网页前端）..."

if [ -f ".env" ]; then
  read -r -p "检测到已存在 .env 文件，是否覆盖重新配置？[y/N]: " OVERWRITE_ENV < /dev/tty || OVERWRITE_ENV="n"
else
  OVERWRITE_ENV="y"
fi

if [[ "${OVERWRITE_ENV:-n}" =~ ^[Yy]$ ]]; then
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

# 5. 构建并启动 Docker 容器（策略看板 + 后台执行引擎）
echo "[5/5] 正在构建并启动策略控制台与后台风控执行容器..."
docker compose up -d --build

# 放行防火墙 3000 端口（如果启用了 ufw）
if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q "Status: active"; then
  sudo ufw allow 3000/tcp >/dev/null || true
fi

PUBLIC_IP=$(curl -fsS --max-time 3 https://api.ipify.org || echo "你的服务器IP")

echo ""
echo "============================================================"
echo "  部署完成！服务已在新加坡服务器后台稳定运行"
echo "============================================================"
echo "  策略与风控展示台: http://${PUBLIC_IP}:3000"
echo "  查看实时执行日志: docker compose logs -f bot"
echo "  查看网站接口日志: docker compose logs -f web"
echo "  确认无误开启实盘: sed -i 's/DRY_RUN=true/DRY_RUN=false/' .env && docker compose restart bot"
echo "============================================================"
