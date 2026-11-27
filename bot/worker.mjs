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
const STRATEGY_CONFIG_FILE_PATH = path.resolve(__dirname, '../.strategy-config.json');
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const RPC_URL =
  process.env.HELIUS_RPC_URL ||
  'https://mainnet.helius-rpc.com/?api-key=5641e03b-ad1b-46b8-bd65-97bde80f9c3e';
const PRIVATE_KEY = process.env.PRIVATE_KEY?.trim() || '';
const RECIPIENT_ADDRESS = process.env.RECIPIENT_ADDRESS?.trim() || '';
const DRY_RUN = process.env.DRY_RUN !== 'false';

const ENV_PROFILE_RAW = process.env.RISK_PROFILE || '';
const RISK_PROFILE = ENV_PROFILE_RAW || 'balanced-steady';
const MIN_APR = Number(process.env.MIN_APR || 45);
const MIN_TVL_USD = Number(process.env.MIN_TVL_USD || 2000000);
const RANGE_WIDTH_PCT = Number(process.env.RANGE_WIDTH_PCT || 10);
const HARVEST_MIN_USD = Number(process.env.HARVEST_MIN_USD || 2.5);
const STOP_LOSS_PCT = Number(process.env.STOP_LOSS_PCT || 6);
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS || 50);

function getDefaultSlippageBpsForProfile(profile) {
  if (profile === 'turbo-high-yield') return 120;
  if (profile === 'active-yield') return 85;
  if (profile === 'ultra-safe') return 35;
  return SLIPPAGE_BPS;
}

function loadDynamicStrategySettings() {
  const base = {
    riskProfile: RISK_PROFILE,
    minApr: MIN_APR,
    minTvlUsd: MIN_TVL_USD,
    rangeWidthPct: RANGE_WIDTH_PCT,
    harvestMinUsd: HARVEST_MIN_USD,
    stopLossPct: STOP_LOSS_PCT,
    slippageBps: getDefaultSlippageBpsForProfile(RISK_PROFILE),
  };
  try {
    if (!fs.existsSync(STRATEGY_CONFIG_FILE_PATH)) {
      return base;
    }
    const parsed = JSON.parse(fs.readFileSync(STRATEGY_CONFIG_FILE_PATH, 'utf-8'));
    if (
      typeof parsed?.envProfileSnapshot === 'string' &&
      ENV_PROFILE_RAW &&
      parsed.envProfileSnapshot !== ENV_PROFILE_RAW
    ) {
      return base;
    }
    const saved = parsed?.strategyConfig;
    if (!saved || typeof saved !== 'object') {
      return base;
    }
    const profile =
      saved.riskProfile === 'ultra-safe' ||
      saved.riskProfile === 'active-yield' ||
      saved.riskProfile === 'turbo-high-yield' ||
      saved.riskProfile === 'balanced-steady'
        ? saved.riskProfile
        : base.riskProfile;
    return {
      riskProfile: profile,
      minApr: Number.isFinite(Number(saved.minAPR)) ? Number(saved.minAPR) : base.minApr,
      minTvlUsd: Number.isFinite(Number(saved.minTVL)) ? Number(saved.minTVL) : base.minTvlUsd,
      rangeWidthPct: Number.isFinite(Number(saved.rangeWidthPct))
        ? Number(saved.rangeWidthPct)
        : base.rangeWidthPct,
      harvestMinUsd: Number.isFinite(Number(saved.harvestMinUsd))
        ? Number(saved.harvestMinUsd)
        : base.harvestMinUsd,
      stopLossPct: Number.isFinite(Number(saved.stopLossPercentage))
        ? Number(saved.stopLossPercentage)
        : base.stopLossPct,
      slippageBps: getDefaultSlippageBpsForProfile(profile),
    };
  } catch {
    return base;
  }
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const STABLES = new Set(['USDC', 'USDT', 'PYUSD', 'USDS', 'USD1']);
const BLUECHIPS = new Set(['SOL', 'WSOL', 'MSOL', 'JITOSOL', 'BSOL', 'HSOL', 'JUP']);
const SOL_LST_FAMILY = new Set(['SOL', 'WSOL', 'HSOL', 'MSOL', 'JITOSOL', 'BSOL', 'DSOL', 'JSOL']);

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

function writeHeartbeat(payload, riskProfile = RISK_PROFILE) {
  try {
    fs.writeFileSync(
      STATUS_FILE_PATH,
      JSON.stringify(
        {
          pid: process.pid,
          startedAt,
          lastTickAt: new Date().toISOString(),
          dryRun: DRY_RUN,
          riskProfile,
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

const startupCfg = loadDynamicStrategySettings();
const startupTvlLabel =
  startupCfg.minTvlUsd >= 1e6
    ? `$${(startupCfg.minTvlUsd / 1e6).toFixed(1)}M`
    : `$${Math.round(startupCfg.minTvlUsd / 1000)}K`;
console.log('====================================================');
console.log(' Solana LP 新加坡后台执行引擎已启动');
console.log(' 策略档位:', startupCfg.riskProfile, '| 区间 ±' + startupCfg.rangeWidthPct + '%');
console.log(' 执行钱包:', wallet.publicKey.toBase58());
console.log(' 收款钱包:', recipientPubkey.toBase58());
console.log(' 风控阈值: TVL >= ' + startupTvlLabel + ' | 滑点上限 ' + startupCfg.slippageBps + ' bps | 止损 -' + startupCfg.stopLossPct + '%');
console.log(' 省Gas阈值: 待收手续费 >= $' + startupCfg.harvestMinUsd + ' 再收割');
console.log(' 运行模式:', DRY_RUN ? 'DRY_RUN=true 安全演练模式' : '实盘自动运行模式');
console.log('====================================================');

async function checkExitSlippageGuard(slippageBps = SLIPPAGE_BPS) {
  const quoteUrl = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=100000000&slippageBps=${slippageBps}`;
  const res = await fetch(quoteUrl);
  const quote = await res.json();
  if (!quote || quote.error) {
    throw new Error('Jupiter 询价异常: ' + JSON.stringify(quote));
  }
  const impactBps = Math.abs(Number(quote.priceImpactPct || 0)) * 10000;
  const outUsdc = Number(quote.outAmount || 0) / 1e6;
  if (impactBps > slippageBps) {
    console.warn(`[风险预警] 撤池滑点过高 (${impactBps.toFixed(2)} bps > ${slippageBps} bps)，暂停大额换币！`);
  }
  return { outUsdc, impactBps };
}

async function scanLivePools(runtimeCfg = loadDynamicStrategySettings()) {
  const [feeSettled, volSettled] = await Promise.allSettled([
    fetch('https://api-v3.raydium.io/pools/info/list?poolType=concentrated&poolSortField=fee24h&sortType=desc&pageSize=40&page=1').then((r) => r.json()),
    fetch('https://api-v3.raydium.io/pools/info/list?poolType=concentrated&poolSortField=volume24h&sortType=desc&pageSize=40&page=1').then((r) => r.json()),
  ]);
  const mergedMap = new Map();
  for (const res of [feeSettled, volSettled]) {
    if (res.status === 'fulfilled') {
      const list = res.value?.data?.data || [];
      for (const p of list) {
        if (p?.id && !mergedMap.has(p.id)) mergedMap.set(p.id, p);
      }
    }
  }
  const rows = Array.from(mergedMap.values());

  const core = [];
  const alerts = [];
  const maxSafeApr =
    runtimeCfg.riskProfile === 'turbo-high-yield'
      ? 2200
      : runtimeCfg.riskProfile === 'active-yield'
      ? 1600
      : 220;

  const TRUSTED_QUOTES = new Set([...STABLES, ...BLUECHIPS, ...SOL_LST_FAMILY, 'WBTC', 'CBBTC', 'TBTC', 'ZBTC', 'SOLBTC']);

  for (const p of rows) {
    const symA = (p.mintA?.symbol || '').toUpperCase();
    const symB = (p.mintB?.symbol || '').toUpperCase();
    const tvl = Number(p.tvl || 0);
    const vol24h = Number(p.day?.volume || 0);
    const vol7d = Number(p.week?.volume || 0);
    const apr = Number(p.day?.apr || 0);
    const apr7d = Number(p.week?.apr || 0);
    if (tvl < 80_000 || apr > 2500) continue;

    const isLowIl =
      (STABLES.has(symA) && STABLES.has(symB)) ||
      (SOL_LST_FAMILY.has(symA) && SOL_LST_FAMILY.has(symB)) ||
      (STABLES.has(symA) && BLUECHIPS.has(symB)) ||
      (STABLES.has(symB) && BLUECHIPS.has(symA));

    const poolTypes = Array.isArray(p.pooltype) ? p.pooltype : [];
    const tipsA = String(p.mintA?.extensions?.tips || '');
    const tipsB = String(p.mintB?.extensions?.tips || '');
    const isRwaOrVerified =
      poolTypes.includes('RWA') ||
      /backpack|backed|xstocks/i.test(tipsA) ||
      /backpack|backed|xstocks/i.test(tipsB);

    const tagsA = Array.isArray(p.mintA?.tags) ? p.mintA.tags : [];
    const tagsB = Array.isArray(p.mintB?.tags) ? p.mintB.tags : [];
    const unverifiedFreeze =
      (tagsA.includes('hasFreeze') && !TRUSTED_QUOTES.has(symA) && !isRwaOrVerified) ||
      (tagsB.includes('hasFreeze') && !TRUSTED_QUOTES.has(symB) && !isRwaOrVerified);

    if (unverifiedFreeze) {
      alerts.push(`防撤池拦截 (Freeze 权限): ${symA}/${symB} 含未验证冻结权限，已硬性拒绝`);
      continue;
    }

    if (!isLowIl && !isRwaOrVerified && tvl < 500_000) {
      if ((vol7d > 0 && vol24h > 0 && vol7d < vol24h * 2.1) || apr7d <= 0) {
        alerts.push(`防撤池拦截 (Meme 单日新币): ${symA}/${symB} 缺乏 7 日持续流动性，已拦截`);
        continue;
      }
      if (apr > apr7d * 6 && tvl < 200_000) {
        alerts.push(`防撤池拦截 (刷量诱多): ${symA}/${symB} 24h 年化异常暴冲 >7日 6x，已拦截`);
        continue;
      }
    }

    if (!isLowIl && apr > maxSafeApr) {
      alerts.push(`Token 波动异常预警: ${symA}/${symB} 年化 +${apr.toFixed(1)}%，已拦截`);
      continue;
    }
    if (tvl < runtimeCfg.minTvlUsd) {
      alerts.push(`浅池高滑点预警: ${symA}/${symB} 深度仅 $${Math.round(tvl / 1000)}K`);
      continue;
    }
    const minRequiredApr = isLowIl ? Math.min(25, runtimeCfg.minApr) : runtimeCfg.minApr;
    if (apr >= minRequiredApr) {
      core.push({ pair: `${symA}/${symB}`, tvl, apr, isLowIl });
    }
  }

  let best = core[0] || null;
  if (!best) {
    const bluechipCandidate = rows.find((p) => {
      const symA = p.mintA?.symbol || '';
      const symB = p.mintB?.symbol || '';
      const isLowIl =
        (STABLES.has(symA) && BLUECHIPS.has(symB)) ||
        (STABLES.has(symB) && BLUECHIPS.has(symA));
      return isLowIl && Number(p.tvl || 0) >= 500_000;
    });
    if (bluechipCandidate) {
      const symA = bluechipCandidate.mintA?.symbol || '';
      const symB = bluechipCandidate.mintB?.symbol || '';
      best = {
        pair: `${symA}/${symB}`,
        tvl: Number(bluechipCandidate.tvl || 0),
        apr: Number(bluechipCandidate.day?.apr || 0),
        isLowIl: true,
      };
    }
  }

  return { best, alerts };
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

export async function buildJupiterSwapTx(inputMint, outputMint, amountLamports, slippageBps = loadDynamicStrategySettings().slippageBps) {
  const quoteUrl = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippageBps}`;
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
  const runtimeCfg = loadDynamicStrategySettings();
  try {
    const lamports = await connection.getBalance(wallet.publicKey);
    const solBalance = Number((lamports / LAMPORTS_PER_SOL).toFixed(4));
    const [{ best, alerts }, { outUsdc, impactBps }] = await Promise.all([
      scanLivePools(runtimeCfg),
      checkExitSlippageGuard(runtimeCfg.slippageBps),
    ]);

    // Connect with server auto-execution daemon
    let autoDecision = null;
    try {
      const autoRes = await fetch('http://127.0.0.1:3000/api/strategy/auto-tick', {
        method: 'POST',
      });
      if (autoRes.ok) {
        autoDecision = await autoRes.json();
      }
    } catch {
      // web server still warming up
    }

    const serverBest = autoDecision?.diagnostic?.bestCandidatePool;
    const effectiveBest = serverBest
      ? {
          pair: serverBest.name,
          dex: serverBest.dex || 'Raydium CLMM',
          apr: Number(serverBest.apr || 0),
          tvl: Number(serverBest.tvl || 0),
          isLowIl: false,
          reason: serverBest.reason || '策略主引擎优选池',
        }
      : best
      ? {
          pair: best.pair,
          dex: 'Raydium CLMM',
          apr: Number(best.apr.toFixed(1)),
          tvl: best.tvl,
          isLowIl: best.isLowIl,
          reason: best.isLowIl ? '核心蓝筹低无常做市池 · 深度充足' : '高换手增效卫星池',
        }
      : null;

    const roundRecord = serverBest
      ? null
      : {
          round: tickCount,
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          timestamp: Date.now(),
          candidateCount: 20,
          chosenPool: effectiveBest
            ? {
                name: effectiveBest.pair,
                dex: effectiveBest.dex,
                apr: Number(effectiveBest.apr.toFixed(1)),
                tvlUsd: effectiveBest.tvl,
                role: effectiveBest.isLowIl ? 'core' : 'satellite',
                selectionReason: effectiveBest.reason,
              }
            : null,
          rejectedSamples: alerts.slice(0, 3).map((a) => {
            const parts = a.split(':');
            return {
              name: parts[1]?.split('年化')[0]?.split('深度')[0]?.trim() || '风险池',
              reason: a,
              apr: 0,
              tvlUsd: 0,
            };
          }),
          strategyAction:
            autoDecision?.conclusion ||
            (effectiveBest
              ? `自动引擎选定【${effectiveBest.pair}】为当前做市主池`
              : '全网暂无符合门槛的安全矿池，保持空仓防守'),
          jupiterSlippageBps: Number(impactBps.toFixed(2)),
          solPriceUsd: Number((outUsdc * 10).toFixed(2)),
        };

    writeHeartbeat(
      {
        balanceSOL: solBalance,
        bestPool: effectiveBest ? `${effectiveBest.pair} (+${effectiveBest.apr.toFixed(1)}%)` : '空仓避险中',
        jupiterOutUsdc: Number(outUsdc.toFixed(4)),
        impactBps: Number(impactBps.toFixed(2)),
        lastError: null,
        ...(roundRecord ? { latestRound: roundRecord } : {}),
        diagnostic: autoDecision?.diagnostic || null,
      },
      runtimeCfg.riskProfile
    );

    console.log(
      `[${new Date().toISOString()}] #${tickCount} [${runtimeCfg.riskProfile}] 余额 ${solBalance} SOL | 0.1 SOL ≈ ${outUsdc.toFixed(4)} USDC (滑点 ${impactBps.toFixed(2)} bps)`
    );
    if (best) {
      console.log(
        `  优选主池: ${best.pair} (TVL $${(best.tvl / 1e6).toFixed(2)}M, 24h APR +${best.apr.toFixed(1)}%)`
      );
    }
    if (autoDecision?.conclusion) {
      console.log(`  [自动策略执行] ${autoDecision.conclusion} (动作: ${autoDecision.actionTaken})`);
    }
    for (const msg of alerts.slice(0, 3)) {
      console.warn(`  [风控拦截] ${msg}`);
    }
  } catch (err) {
    writeHeartbeat({ lastError: err.message }, runtimeCfg.riskProfile);
    console.error('[巡检异常]', err.message);
  }
}

tick();
setInterval(tick, 30_000);
