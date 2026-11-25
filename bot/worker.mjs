import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATUS_FILE_PATH = path.resolve(__dirname, '../.bot-runtime-status.json');
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const RPC_URL =
  process.env.HELIUS_RPC_URL ||
  'https://mainnet.helius-rpc.com/?api-key=5641e03b-ad1b-46b8-bd65-97bde80f9c3e';
const PRIVATE_KEY = process.env.PRIVATE_KEY?.trim() || '';
const RECIPIENT_ADDRESS = process.env.RECIPIENT_ADDRESS?.trim() || '';
const DRY_RUN = process.env.DRY_RUN !== 'false';

const RISK_PROFILE = process.env.RISK_PROFILE || 'balanced-steady';
const MIN_APR = Number(process.env.MIN_APR || 45);
const MIN_TVL_USD = Number(process.env.MIN_TVL_USD || 2000000);
const RANGE_WIDTH_PCT = Number(process.env.RANGE_WIDTH_PCT || 10);
const HARVEST_MIN_USD = Number(process.env.HARVEST_MIN_USD || 2.5);
const STOP_LOSS_PCT = Number(process.env.STOP_LOSS_PCT || 6);
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS || 50);

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const STABLES = new Set(['USDC', 'USDT', 'PYUSD', 'USDS', 'USD1']);
const BLUECHIPS = new Set(['SOL', 'WSOL', 'MSOL', 'JITOSOL', 'BSOL', 'JUP']);

if (!PRIVATE_KEY || !RECIPIENT_ADDRESS) {
  console.error('[启动中止] 服务器 .env 缺少 PRIVATE_KEY 或 RECIPIENT_ADDRESS。');
  process.exit(1);
}

const connection = new Connection(RPC_URL, 'confirmed');
const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
const recipientPubkey = new PublicKey(RECIPIENT_ADDRESS);
const startedAt = new Date().toISOString();
let tickCount = 0;

function maskAddr(addr) {
  return addr.length > 10 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : '****';
}

function writeHeartbeat(payload) {
  try {
    fs.writeFileSync(
      STATUS_FILE_PATH,
      JSON.stringify(
        {
          pid: process.pid,
          startedAt,
          lastTickAt: new Date().toISOString(),
          dryRun: DRY_RUN,
          riskProfile: RISK_PROFILE,
          walletMasked: maskAddr(wallet.publicKey.toBase58()),
          recipientMasked: maskAddr(recipientPubkey.toBase58()),
          tickCount,
          ...payload,
        },
        null,
        2
      )
    );
  } catch (e) {
    console.error('[状态写入失败]', e.message);
  }
}

console.log('====================================================');
console.log(' Solana LP 新加坡后台执行引擎已启动');
console.log(' 策略档位:', RISK_PROFILE, '| 区间 ±' + RANGE_WIDTH_PCT + '%');
console.log(' 执行钱包:', wallet.publicKey.toBase58());
console.log(' 收款钱包:', recipientPubkey.toBase58());
console.log(' 风控阈值: TVL >= $' + (MIN_TVL_USD / 1e6).toFixed(1) + 'M | 滑点上限 ' + SLIPPAGE_BPS + ' bps | 止损 -' + STOP_LOSS_PCT + '%');
console.log(' 省Gas阈值: 待收手续费 >= $' + HARVEST_MIN_USD + ' 再收割');
console.log(' 运行模式:', DRY_RUN ? 'DRY_RUN=true 安全演练模式' : '实盘自动运行模式');
console.log('====================================================');

async function checkExitSlippageGuard() {
  const quoteUrl = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=100000000&slippageBps=${SLIPPAGE_BPS}`;
  const res = await fetch(quoteUrl);
  const quote = await res.json();
  if (!quote || quote.error) {
    throw new Error('Jupiter 询价异常: ' + JSON.stringify(quote));
  }
  const impactBps = Math.abs(Number(quote.priceImpactPct || 0)) * 10000;
  const outUsdc = Number(quote.outAmount || 0) / 1e6;
  if (impactBps > SLIPPAGE_BPS) {
    console.warn(`[风险预警] 撤池滑点过高 (${impactBps.toFixed(2)} bps > ${SLIPPAGE_BPS} bps)，暂停大额换币！`);
  }
  return { outUsdc, impactBps };
}

async function scanLivePools() {
  const res = await fetch(
    'https://api-v3.raydium.io/pools/info/list?poolType=concentrated&poolSortField=volume24h&sortType=desc&pageSize=20&page=1'
  );
  const json = await res.json();
  const rows = json?.data?.data || [];

  const core = [];
  const alerts = [];

  for (const p of rows) {
    const symA = p.mintA?.symbol || '';
    const symB = p.mintB?.symbol || '';
    const tvl = Number(p.tvl || 0);
    const apr = Number(p.day?.apr || 0);
    const isLowIl =
      (STABLES.has(symA) && STABLES.has(symB)) ||
      (STABLES.has(symA) && BLUECHIPS.has(symB)) ||
      (STABLES.has(symB) && BLUECHIPS.has(symA));

    if (!isLowIl && apr > 180) {
      alerts.push(`Token 波动异常预警: ${symA}/${symB} 年化 +${apr.toFixed(1)}%，已拦截`);
      continue;
    }
    if (tvl < MIN_TVL_USD) {
      alerts.push(`浅池高滑点预警: ${symA}/${symB} 深度仅 $${Math.round(tvl / 1000)}K`);
      continue;
    }
    if (apr >= (isLowIl ? 30 : MIN_APR)) {
      core.push({ pair: `${symA}/${symB}`, tvl, apr, isLowIl });
    }
  }

  return { best: core[0] || null, alerts };
}

export async function sweepProfitSol(amountSol) {
  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  if (DRY_RUN) {
    console.log(`[演练] 模拟将利润 ${amountSol} SOL 转至 ${recipientPubkey.toBase58()}`);
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

export async function buildJupiterSwapTx(inputMint, outputMint, amountLamports) {
  const quoteUrl = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${SLIPPAGE_BPS}`;
  const quoteRes = await fetch(quoteUrl);
  const quote = await quoteRes.json();
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

async function tick() {
  tickCount += 1;
  try {
    const lamports = await connection.getBalance(wallet.publicKey);
    const solBalance = Number((lamports / LAMPORTS_PER_SOL).toFixed(4));
    const [{ best, alerts }, { outUsdc, impactBps }] = await Promise.all([
      scanLivePools(),
      checkExitSlippageGuard(),
    ]);

    writeHeartbeat({
      balanceSOL: solBalance,
      bestPool: best ? `${best.pair} (+${best.apr.toFixed(1)}%)` : '空仓避险中',
      jupiterOutUsdc: Number(outUsdc.toFixed(4)),
      impactBps: Number(impactBps.toFixed(2)),
      lastError: null,
    });

    console.log(
      `[${new Date().toISOString()}] #${tickCount} 余额 ${solBalance} SOL | 0.1 SOL ≈ ${outUsdc.toFixed(4)} USDC (滑点 ${impactBps.toFixed(2)} bps)`
    );
    if (best) {
      console.log(
        `  优选主池: ${best.pair} (TVL $${(best.tvl / 1e6).toFixed(2)}M, 24h APR +${best.apr.toFixed(1)}%)`
      );
    }
    for (const msg of alerts.slice(0, 3)) {
      console.warn(`  [风控拦截] ${msg}`);
    }
  } catch (err) {
    writeHeartbeat({ lastError: err.message });
    console.error('[巡检异常]', err.message);
  }
}

tick();
setInterval(tick, 30_000);
