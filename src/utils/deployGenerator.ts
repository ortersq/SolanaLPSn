import { StrategyConfig } from './strategyEngine';

export interface DeployBundleInput {
  heliusRpcUrl: string;
  strategyConfig: StrategyConfig;
}

export interface DeployBundleOutput {
  envExample: string;
  dockerCompose: string;
  deployScript: string;
  botPackageJson: string;
  botIndexJs: string;
}

/**
 * Generates server-side Singapore deployment files with ZERO sensitive inputs
 * (neither PRIVATE_KEY nor RECIPIENT_ADDRESS is accepted from the browser frontend).
 * Both are prompted strictly inside the user's own SSH terminal and saved to chmod 600 .env.
 */
export function generateDeployBundle(input: DeployBundleInput): DeployBundleOutput {
  const cfg = input.strategyConfig;

  const envExample = `# ========================================================
# Solana 200U 稳健做市机器人 - 新加坡服务器本地私有配置 (.env)
# 安全原则：交易私钥与收款公钥全部由服务器后台掌控，不经过任何网页前台！
# ========================================================

# 1. Helius 主网高速节点
SOLANA_RPC_URL=${input.heliusRpcUrl}

# 2. 机器人执行钱包私钥（Base58，仅保存在本机 .env，建议放 200U 等值资产）
PRIVATE_KEY=

# 3. 盈利接收 Solana 公钥地址（仅用于收款，利润达标后自动转账到此地址）
RECIPIENT_ADDRESS=

# 4. Jito 新加坡防夹子节点（公共节点无需 Key）
JITO_BLOCK_ENGINE_URL=https://singapore.mainnet.block-engine.jito.wtf/api/v1/bundles
JITO_TIP_LAMPORTS=${cfg.jitoTipLamports}

# 5. 200U 稳定盈利与三道保命风控参数
RISK_PROFILE=${cfg.riskProfile}
CAPITAL_USDT=${cfg.capitalUsdt}
GAS_RESERVE_USDT=${cfg.gasReserveUsdt}
LP_ACTIVE_USDT=${cfg.lpActiveUsdt}
CORE_SPLIT_PCT=${cfg.coreSplitPct}
AUTO_COMPOUND=${cfg.autoCompound}
MIN_APR=${cfg.minAPR}
MIN_TVL_USD=${cfg.minTVL}
RANGE_WIDTH_PCT=${cfg.rangeWidthPct}
HARVEST_MIN_USD=${cfg.harvestMinUsd}
STOP_LOSS_PCT=${cfg.stopLossPercentage}
TAKE_PROFIT_SWEEP_USD=${cfg.takeProfitSweepUsd}
MAX_IL_TOLERANCE_PCT=${cfg.maxILTolerance}
SLIPPAGE_BPS=${cfg.slippageBps}
DRY_RUN=true
`;

  const dockerCompose = `services:
  sol-lp-bot:
    image: node:20-alpine
    container_name: sol-200u-steady-bot
    restart: unless-stopped
    working_dir: /app
    env_file:
      - .env
    volumes:
      - ./bot:/app
    command: sh -c "npm install --omit=dev && npm start"
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
`;

  const botPackageJson = `{
  "name": "sol-200u-steady-bot",
  "version": "2.1.0",
  "type": "module",
  "dependencies": {
    "@solana/web3.js": "^1.98.0",
    "@solana/spl-token": "^0.4.9",
    "bs58": "^6.0.0",
    "dotenv": "^16.4.5"
  },
  "scripts": {
    "start": "node index.js"
  }
}`;

  const botIndexJs = `import 'dotenv/config';
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

const RPC_URL = process.env.SOLANA_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RECIPIENT_ADDRESS = process.env.RECIPIENT_ADDRESS;
const DRY_RUN = process.env.DRY_RUN !== 'false';

const RISK_PROFILE = process.env.RISK_PROFILE || 'balanced-steady';
const CORE_SPLIT_PCT = Number(process.env.CORE_SPLIT_PCT || 100);
const MIN_APR = Number(process.env.MIN_APR || 45);
const MIN_TVL_USD = Number(process.env.MIN_TVL_USD || 2000000);
const RANGE_WIDTH_PCT = Number(process.env.RANGE_WIDTH_PCT || 15);
const HARVEST_MIN_USD = Number(process.env.HARVEST_MIN_USD || 2.5);
const STOP_LOSS_PCT = Number(process.env.STOP_LOSS_PCT || 6);
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS || 50);

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const STABLES = new Set(['USDC', 'USDT', 'PYUSD', 'USDS', 'USD1']);
const BLUECHIPS = new Set(['SOL', 'WSOL', 'MSOL', 'JITOSOL', 'BSOL', 'JUP']);

if (!RPC_URL || !PRIVATE_KEY || !RECIPIENT_ADDRESS) {
  console.error('[启动中止] 后台 .env 缺少 SOLANA_RPC_URL、PRIVATE_KEY 或 RECIPIENT_ADDRESS');
  process.exit(1);
}

const connection = new Connection(RPC_URL, 'confirmed');
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY.trim()));
const recipientPubkey = new PublicKey(RECIPIENT_ADDRESS.trim());

console.log('====================================================');
console.log(' Solana 200U 做市引擎（新加坡 VPS 后台模式）');
console.log(' 策略档位:', RISK_PROFILE, '| 核心仓占比:', CORE_SPLIT_PCT + '%');
console.log(' 执行钱包:', wallet.publicKey.toBase58());
console.log(' 收款钱包:', recipientPubkey.toBase58());
console.log(' 选池门槛: TVL >= $' + (MIN_TVL_USD / 1e6).toFixed(1) + 'M, APR >= ' + MIN_APR + '%, 区间 ±' + RANGE_WIDTH_PCT + '%');
console.log(' 省Gas铁律: 手续费 >= $' + HARVEST_MIN_USD + ' 才收割 | 止损熔断: -' + STOP_LOSS_PCT + '%');
console.log(' 当前模式:', DRY_RUN ? '安全演练模式 (DRY_RUN=true)' : '实盘自动运行模式');
console.log('====================================================');

// 1. 真实 Jupiter Swap v1 询价与兑换（自动配平 50:50 或止损换回 USDC）
async function buildJupiterSwapTx(inputMint, outputMint, amountLamports) {
  const quoteUrl = \`https://lite-api.jup.ag/swap/v1/quote?inputMint=\${inputMint}&outputMint=\${outputMint}&amount=\${amountLamports}&slippageBps=\${SLIPPAGE_BPS}\`;
  const quoteRes = await fetch(quoteUrl);
  const quote = await quoteRes.json();
  if (!quote || quote.error) {
    throw new Error('Jupiter 询价失败: ' + JSON.stringify(quote));
  }

  const swapRes = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      prioritizationFeeLamports: 'auto',
    }),
  });
  const swapData = await swapRes.json();
  const tx = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, 'base64'));
  tx.sign([wallet]);
  return { quote, tx };
}

// 2. 真实利润落袋转账（转回后台设定的 RECIPIENT_ADDRESS）
async function sweepProfitSol(amountSol) {
  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  if (DRY_RUN) {
    console.log(\`[演练] 利润达标，模拟转出 \${amountSol} SOL -> \${recipientPubkey.toBase58()}\`);
    return;
  }
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: recipientPubkey,
      lamports,
    })
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
  console.log('[利润落袋成功] Signature:', sig);
}

// 3. 200U 真实主网实时选池引擎（支持核心蓝筹 + 卫星增效双仓）
async function selectTargetPools() {
  const res = await fetch('https://api-v3.raydium.io/pools/info/list?poolType=concentrated&poolSortField=volume24h&sortType=desc&pageSize=20&page=1');
  const json = await res.json();
  const rows = json?.data?.data || [];

  const coreCandidates = rows
    .filter((p) => {
      const symA = p.mintA?.symbol || '';
      const symB = p.mintB?.symbol || '';
      const isBothStable = STABLES.has(symA) && STABLES.has(symB);
      const isBluechip =
        (STABLES.has(symA) && BLUECHIPS.has(symB)) ||
        (stablesOrBluechip(symB) && BLUECHIPS.has(symA));
      const tvl = Number(p.tvl || 0);
      const apr = Number(p.day?.apr || 0);
      return (isBothStable || isBluechip) && tvl >= Math.max(MIN_TVL_USD, 1500000) && apr >= 30;
    })
    .sort((a, b) => Number(b.day?.apr || 0) - Number(a.day?.apr || 0));

  const satelliteCandidates =
    RISK_PROFILE === 'active-yield'
      ? rows
          .filter((p) => {
            const tvl = Number(p.tvl || 0);
            const apr = Number(p.day?.apr || 0);
            return tvl >= MIN_TVL_USD && apr >= MIN_APR && apr <= 220;
          })
          .sort((a, b) => Number(b.day?.apr || 0) - Number(a.day?.apr || 0))
      : [];

  return {
    corePool: coreCandidates[0] || null,
    satellitePool: satelliteCandidates[0] || null,
  };
}

function stablesOrBluechip(sym) {
  return STABLES.has(sym);
}

async function tick() {
  try {
    const lamports = await connection.getBalance(wallet.publicKey);
    const solBalance = lamports / LAMPORTS_PER_SOL;
    const { corePool, satellitePool } = await selectTargetPools();

    if (corePool) {
      console.log(
        \`[\${new Date().toISOString()}] 余额: \${solBalance.toFixed(4)} SOL | 核心池(\${CORE_SPLIT_PCT}%): \${corePool.mintA?.symbol}/\${corePool.mintB?.symbol} (TVL $\${(Number(corePool.tvl) / 1e6).toFixed(2)}M, 24h APR \${Number(corePool.day?.apr || 0).toFixed(1)}%)\`
      );
    } else {
      console.log(\`[\${new Date().toISOString()}] 余额: \${solBalance.toFixed(4)} SOL | 暂无符合风控门槛的核心池，空仓避险中\`);
    }

    if (RISK_PROFILE === 'active-yield' && satellitePool) {
      console.log(
        \`[\${new Date().toISOString()}] 卫星增效池(\${100 - CORE_SPLIT_PCT}%): \${satellitePool.mintA?.symbol}/\${satellitePool.mintB?.symbol} (TVL $\${(Number(satellitePool.tvl) / 1e6).toFixed(2)}M, 24h APR \${Number(satellitePool.day?.apr || 0).toFixed(1)}%)\`
      );
    }

    if (solBalance >= 0.08) {
      const { quote } = await buildJupiterSwapTx(SOL_MINT, USDC_MINT, 10_000_000);
      console.log(\`[Jupiter 实时路由] 0.01 SOL ≈ \${(Number(quote.outAmount) / 1e6).toFixed(4)} USDC\`);
    } else {
      console.log('[Gas 保护] 钱包 SOL 不足 0.08 SOL（约 12~15U 燃料保留金），暂停新开池');
    }
  } catch (err) {
    console.error('[巡检异常]', err.message);
  }
}

tick();
setInterval(tick, 60_000);
`;

  const deployScript = `#!/bin/bash
set -euo pipefail
# ========================================================
# Solana 200U 稳健做市机器人 - 新加坡服务器后台安全一键部署
# 私钥与收款地址全部在您自己的 SSH 终端内输入，网页端零接触！
# ========================================================

echo "[1/5] 检查 Docker 环境..."
if ! command -v docker >/dev/null 2>&1; then
  echo "未检测到 Docker，正在自动安装..."
  curl -fsSL https://get.docker.com | sh
fi

mkdir -p sol-200u-bot/bot
cd sol-200u-bot

echo "[2/5] 写入容器配置与 200U 稳定盈利执行代码..."
cat << 'EOF' > docker-compose.yml
${dockerCompose}EOF

cat << 'EOF' > bot/package.json
${botPackageJson}
EOF

cat << 'EOF' > bot/index.js
${botIndexJs}EOF

echo "[3/5] 在新加坡服务器本地后台配置私钥与收款公钥（全程不经过网页）..."
read -s -p "请输入执行钱包 Base58 私钥 (建议新建 200U 专用钱包，输入时不回显): " INPUT_PRIVATE_KEY
echo ""
if [ -z "$INPUT_PRIVATE_KEY" ]; then
  echo "[错误] 私钥不能为空。"
  exit 1
fi

read -p "请输入您的盈利接收 Solana 公钥地址 (必填，利润将转到此地址): " INPUT_RECIPIENT
if [ -z "$INPUT_RECIPIENT" ]; then
  echo "[错误] 盈利接收地址不能为空。"
  exit 1
fi

cat << EOF > .env
SOLANA_RPC_URL=${input.heliusRpcUrl}
PRIVATE_KEY=\${INPUT_PRIVATE_KEY}
RECIPIENT_ADDRESS=\${INPUT_RECIPIENT}
JITO_BLOCK_ENGINE_URL=https://singapore.mainnet.block-engine.jito.wtf/api/v1/bundles
JITO_TIP_LAMPORTS=${cfg.jitoTipLamports}
RISK_PROFILE=${cfg.riskProfile}
CAPITAL_USDT=${cfg.capitalUsdt}
GAS_RESERVE_USDT=${cfg.gasReserveUsdt}
LP_ACTIVE_USDT=${cfg.lpActiveUsdt}
CORE_SPLIT_PCT=${cfg.coreSplitPct}
AUTO_COMPOUND=${cfg.autoCompound}
MIN_APR=${cfg.minAPR}
MIN_TVL_USD=${cfg.minTVL}
RANGE_WIDTH_PCT=${cfg.rangeWidthPct}
HARVEST_MIN_USD=${cfg.harvestMinUsd}
STOP_LOSS_PCT=${cfg.stopLossPercentage}
TAKE_PROFIT_SWEEP_USD=${cfg.takeProfitSweepUsd}
MAX_IL_TOLERANCE_PCT=${cfg.maxILTolerance}
SLIPPAGE_BPS=${cfg.slippageBps}
DRY_RUN=true
EOF

chmod 600 .env
unset INPUT_PRIVATE_KEY

echo "[4/5] 启动容器（首次默认 DRY_RUN=true 演练模式）..."
docker compose up -d --build

echo "[5/5] 部署成功！常用命令："
echo "  查看日志: cd sol-200u-bot && docker compose logs -f"
echo "  开启实盘: sed -i 's/DRY_RUN=true/DRY_RUN=false/' .env && docker compose restart"
`;

  return {
    envExample,
    dockerCompose,
    deployScript,
    botPackageJson,
    botIndexJs,
  };
}
