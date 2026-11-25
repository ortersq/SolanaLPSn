# SolanaLPSn — Solana 200U 自动做市策略与实时风控台

纯策略与实时风控展示前端 + 新加坡 VPS 原生后台执行引擎（Node.js + PM2，无需 Docker）。所有敏感私钥、盈利收款公钥均严格保存在服务器后台 `.env` 中，前端网页不提供任何私钥输入或修改入口。

## 一键部署到新加坡服务器（Ubuntu / Debian，免 Docker）

登录您的服务器 SSH 终端后，直接执行以下**一条命令**即可自动安装 Node.js 20 + PM2、构建策略展示台并启动后台风控引擎：

```bash
curl -fsSL https://raw.githubusercontent.com/ortersq/SolanaLPSn/main/deploy.sh | bash
```

如果您已经克隆了仓库并配置好了 `.env`，只需进入目录更新并直接启动：

```bash
cd SolanaLPSn && git pull && bash deploy.sh
```

## 部署后常用维护命令（PM2）

```bash
# 1. 查看服务运行状态
pm2 status

# 2. 查看后台实时巡检、选池与风控日志
pm2 logs solana-lp-bot

# 3. 查看策略展示台接口日志
pm2 logs solana-lp-web

# 4. 确认演练日志正常后，关闭演练模式开启实盘
sed -i 's/DRY_RUN=true/DRY_RUN=false/' .env && pm2 restart solana-lp-bot --update-env

# 5. 更新 GitHub 最新代码并重新部署
git pull && bash deploy.sh
```
