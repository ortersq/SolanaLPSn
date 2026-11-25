# SolanaLPSn — Solana 200U 自动做市策略与实时风控台

纯策略与实时风控展示前端 + 新加坡 VPS Docker 后台执行引擎。所有敏感私钥、盈利收款公钥均严格保存在服务器后台 `.env` 中，前端网页不提供任何私钥输入或修改入口。

## 一键部署到新加坡服务器（Ubuntu / Debian）

登录您的服务器 SSH 终端后，直接执行以下**一条命令**即可完成拉取代码、安装 Docker、后台配置私钥/收款地址并启动：

```bash
curl -fsSL https://raw.githubusercontent.com/ortersq/SolanaLPSn/main/deploy.sh | bash
```

或者先克隆仓库再运行：

```bash
git clone https://github.com/ortersq/SolanaLPSn.git && cd SolanaLPSn && bash deploy.sh
```

## 部署后常用维护命令

```bash
# 1. 查看后台自动巡检与选池日志
docker compose logs -f bot

# 2. 查看策略看板服务日志
docker compose logs -f web

# 3. 确认演练日志正常后，关闭演练模式开启实盘
sed -i 's/DRY_RUN=true/DRY_RUN=false/' .env && docker compose restart bot

# 4. 更新 GitHub 最新代码并重启
git pull && docker compose up -d --build
```
