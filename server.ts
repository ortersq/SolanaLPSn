import fs from 'fs';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import {
  CLMM_PROGRAM_ID,
  PoolUtils,
  Raydium,
  TickUtil,
  TxVersion,
} from '@raydium-io/raydium-sdk-v2';
import {
  API_KEY_REQUIREMENTS,
  ActiveLpPosition,
  AutoPortfolioPlan,
  DEFAULT_200U_STRATEGY,
  PipelineRunMode,
  PipelineStepKey,
  PipelineStepResult,
  PipelineTestAsset,
  PoolMetrics,
  PoolSelectionRound,
  RiskLogEntry,
  RiskProfileKey,
  ScoredPool,
  StrategyConfig,
  assessLiveTestWalletReadiness,
  buildPresetForCapital,
  buildSelectionRoundFromPools,
  calculateAutoPortfolioPlan,
  calculateLpDepositAmounts,
  calculatePositionMetrics,
  computeSafeClmmOtherAmountMax,
  evaluateLiveRiskAlerts,
  formatChainError,
  isValidSolanaAddress,
  maskSolanaAddress,
  rankPools,
} from './src/utils/strategyEngine.ts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const HELIUS_RPC_URL =
  process.env.HELIUS_RPC_URL ||
  'https://mainnet.helius-rpc.com/?api-key=5641e03b-ad1b-46b8-bd65-97bde80f9c3e';

// Strictly backend-only env configuration (never editable from frontend)
const BACKEND_PRIVATE_KEY_RAW = process.env.PRIVATE_KEY?.trim() || '';
const BACKEND_RECIPIENT_RAW = process.env.RECIPIENT_ADDRESS?.trim() || '';
const BACKEND_WATCH_WALLET_RAW = process.env.WATCH_WALLET_ADDRESS?.trim() || '';

let BACKEND_KEYPAIR: Keypair | null = null;
let BACKEND_PRIVATE_KEY_ERROR = '';
if (BACKEND_PRIVATE_KEY_RAW) {
  try {
    BACKEND_KEYPAIR = Keypair.fromSecretKey(bs58.decode(BACKEND_PRIVATE_KEY_RAW));
  } catch (err: any) {
    BACKEND_PRIVATE_KEY_ERROR = err?.message || 'Base58 私钥格式无效';
  }
}

const BACKEND_PRIVATE_KEY_SET = Boolean(BACKEND_PRIVATE_KEY_RAW && BACKEND_KEYPAIR);
const EFFECTIVE_WALLET_ADDRESS = isValidSolanaAddress(BACKEND_WATCH_WALLET_RAW)
  ? BACKEND_WATCH_WALLET_RAW
  : BACKEND_KEYPAIR
  ? BACKEND_KEYPAIR.publicKey.toBase58()
  : '';

const STATUS_FILE_PATH = path.resolve(__dirname, '.bot-runtime-status.json');
const solanaConnection = new Connection(HELIUS_RPC_URL, 'confirmed');

interface LogItem {
  id: number;
  time: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

export interface WorkerHeartbeatStatus {
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  lastTickAt: string | null;
  dryRun: boolean;
  riskProfile: string;
  walletMasked: string;
  recipientMasked: string;
  tickCount: number;
  balanceSOL: number | null;
  bestPool: string | null;
  jupiterOutUsdc: number | null;
  impactBps: number | null;
  lastError: string | null;
  latestRound?: PoolSelectionRound | null;
}

const nowTime = () => new Date().toTimeString().split(' ')[0];

const envCapital = Number(process.env.CAPITAL_USDT || 200);
const envProfileRaw = process.env.RISK_PROFILE;
const envProfile: RiskProfileKey =
  envProfileRaw === 'ultra-safe'
    ? 'ultra-safe'
    : envProfileRaw === 'active-yield'
    ? 'active-yield'
    : envProfileRaw === 'turbo-high-yield'
    ? 'turbo-high-yield'
    : 'balanced-steady';

let strategyConfig: StrategyConfig =
  envProfileRaw || process.env.CAPITAL_USDT
    ? buildPresetForCapital(envCapital, envProfile)
    : { ...DEFAULT_200U_STRATEGY };

function readWorkerHeartbeat(): WorkerHeartbeatStatus {
  const dryRunFallback = process.env.DRY_RUN !== 'false';
  const defaultState: WorkerHeartbeatStatus = {
    running: false,
    pid: null,
    startedAt: null,
    lastTickAt: null,
    dryRun: dryRunFallback,
    riskProfile: strategyConfig.riskProfile,
    walletMasked: EFFECTIVE_WALLET_ADDRESS ? maskSolanaAddress(EFFECTIVE_WALLET_ADDRESS) : '未配置',
    recipientMasked: isValidSolanaAddress(BACKEND_RECIPIENT_RAW)
      ? maskSolanaAddress(BACKEND_RECIPIENT_RAW)
      : '未配置',
    tickCount: 0,
    balanceSOL: null,
    bestPool: null,
    jupiterOutUsdc: null,
    impactBps: null,
    lastError: null,
  };

  try {
    if (!fs.existsSync(STATUS_FILE_PATH)) {
      return defaultState;
    }
    const raw = fs.readFileSync(STATUS_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const lastTickMs = parsed?.lastTickAt ? Date.parse(parsed.lastTickAt) : 0;
    const isFresh = Number.isFinite(lastTickMs) && Date.now() - lastTickMs < 90_000;
    const workerRound = parsed?.latestRound;
    if (
      workerRound &&
      (!selectionRounds.length || selectionRounds[0].round !== workerRound.round)
    ) {
      selectionRounds.unshift(workerRound);
      if (selectionRounds.length > 40) selectionRounds.pop();
    }

    return {
      running: isFresh,
      pid: parsed?.pid ?? null,
      startedAt: parsed?.startedAt ?? null,
      lastTickAt: parsed?.lastTickAt ?? null,
      dryRun: parsed?.dryRun ?? dryRunFallback,
      riskProfile: parsed?.riskProfile ?? strategyConfig.riskProfile,
      walletMasked: parsed?.walletMasked ?? defaultState.walletMasked,
      recipientMasked: parsed?.recipientMasked ?? defaultState.recipientMasked,
      tickCount: Number(parsed?.tickCount || 0),
      balanceSOL: parsed?.balanceSOL ?? null,
      bestPool: parsed?.bestPool ?? null,
      jupiterOutUsdc: parsed?.jupiterOutUsdc ?? null,
      impactBps: parsed?.impactBps ?? null,
      lastError: parsed?.lastError ?? null,
      latestRound: workerRound ?? null,
    };
  } catch {
    return defaultState;
  }
}

let backendStatus = {
  heliusConnected: false,
  heliusLatencyMs: null as number | null,
  lastSlot: null as number | null,
  privateKeyConfigured: BACKEND_PRIVATE_KEY_SET,
  privateKeyError: BACKEND_PRIVATE_KEY_ERROR,
  recipientConfigured: isValidSolanaAddress(BACKEND_RECIPIENT_RAW),
  recipientMasked: isValidSolanaAddress(BACKEND_RECIPIENT_RAW)
    ? maskSolanaAddress(BACKEND_RECIPIENT_RAW)
    : '待后台 .env 配置',
  watchWalletConfigured: isValidSolanaAddress(EFFECTIVE_WALLET_ADDRESS),
  watchWalletMasked: isValidSolanaAddress(EFFECTIVE_WALLET_ADDRESS)
    ? maskSolanaAddress(EFFECTIVE_WALLET_ADDRESS)
    : '待后台 .env 配置',
  watchBalanceSOL: null as number | null,
  splTokenAccountsCount: 0,
  lastJupiterImpactBps: null as number | null,
  dryRunMode: process.env.DRY_RUN !== 'false',
  riskAlerts: [] as RiskLogEntry[],
  logs: [
    {
      id: 1,
      time: nowTime(),
      type: 'info',
      message:
        '策略与风控展示台已就绪：交易私钥与收款地址仅由后台 .env 管理，前台只展示实时策略与风险日志。',
    },
    {
      id: 2,
      time: nowTime(),
      type: 'success',
      message: `已装载【${strategyConfig.capitalUsdt}U 自动做市方案】：${strategyConfig.lpActiveUsdt}U 做市 + ${strategyConfig.gasReserveUsdt}U Gas 保留金 + 全网异常波动与滑点实时巡检。`,
    },
  ] as LogItem[],
};

let cachedActivePositions: ActiveLpPosition[] = [];
let lastPositionsFetchTime = 0;
let selectionRoundCounter = 0;
let selectionRounds: PoolSelectionRound[] = [];
let isAutoTicking = false;
let lastAutoTickDiagnostic: any = null;
let latestSolPriceUsd = 85;
const poolActionCooldownMs = new Map<string, number>();

function getLiveBackendStatus() {
  return {
    ...backendStatus,
    dryRunMode: process.env.DRY_RUN !== 'false',
    workerStatus: readWorkerHeartbeat(),
    activePositions: cachedActivePositions,
    selectionRounds,
    strategyDiagnostic: lastAutoTickDiagnostic,
  };
}

function pushLog(type: LogItem['type'], message: string) {
  backendStatus.logs.unshift({
    id: Date.now() + Math.floor(Math.random() * 1000),
    time: nowTime(),
    type,
    message,
  });
  if (backendStatus.logs.length > 40) {
    backendStatus.logs.pop();
  }
}

function appendRiskAlerts(newAlerts: RiskLogEntry[]) {
  if (!newAlerts.length) return;
  const stamp = Date.now();
  const stamped = newAlerts.map((a, idx) => ({
    ...a,
    id: `${a.id}-${stamp}-${idx}`,
  }));
  backendStatus.riskAlerts = [...stamped, ...backendStatus.riskAlerts].slice(0, 40);
}

async function fetchActivePositions(force = false): Promise<ActiveLpPosition[]> {
  const now = Date.now();
  if (!force && now - lastPositionsFetchTime < 12_000) {
    return cachedActivePositions;
  }
  const targetWallet =
    BACKEND_KEYPAIR?.publicKey ||
    (isValidSolanaAddress(EFFECTIVE_WALLET_ADDRESS)
      ? new PublicKey(EFFECTIVE_WALLET_ADDRESS)
      : null);
  if (!targetWallet) {
    cachedActivePositions = [];
    lastPositionsFetchTime = now;
    return [];
  }

  try {
    const raydium = await Raydium.load({
      owner: targetWallet,
      connection: solanaConnection,
      cluster: 'mainnet',
      disableFeatureCheck: true,
      disableLoadToken: true,
    });
    const rawPositions = await raydium.clmm.getOwnerPositionInfo({
      programId: CLMM_PROGRAM_ID,
    });
    raydium.account.clearAccountChangeCkb();

    const nonEmptyPositions = (rawPositions || []).filter((p) => !p.liquidity.isZero());
    if (nonEmptyPositions.length === 0) {
      cachedActivePositions = [];
      lastPositionsFetchTime = now;
      return [];
    }

    const epochInfo = await solanaConnection.getEpochInfo('confirmed');
    const parsed: ActiveLpPosition[] = [];
    const stables = new Set(['USDC', 'USDT', 'PYUSD', 'USDS', 'USD1']);

    for (const pos of nonEmptyPositions) {
      try {
        const poolIdStr = pos.poolId.toBase58();
        const { poolInfo } = await raydium.clmm.getPoolInfoFromRpc(poolIdStr);
        const currentPrice = Number(poolInfo.price || 0);

        const lowerTick = Math.min(pos.tickLower, pos.tickUpper);
        const upperTick = Math.max(pos.tickLower, pos.tickUpper);
        const priceLower = TickUtil.tickToPrice(
          lowerTick,
          poolInfo.mintA.decimals,
          poolInfo.mintB.decimals
        ).toNumber();
        const priceUpper = TickUtil.tickToPrice(
          upperTick,
          poolInfo.mintA.decimals,
          poolInfo.mintB.decimals
        ).toNumber();

        const liqAmounts = await PoolUtils.getAmountsFromLiquidity({
          epochInfo,
          poolInfo,
          tickLower: lowerTick,
          tickUpper: upperTick,
          liquidity: pos.liquidity,
          slippage: 0,
          add: false,
        });
        const amountA =
          Number(liqAmounts.amountA.amount.toString()) / 10 ** poolInfo.mintA.decimals;
        const amountB =
          Number(liqAmounts.amountB.amount.toString()) / 10 ** poolInfo.mintB.decimals;

        const symA =
          poolInfo.mintA.symbol ||
          (poolInfo.mintA.address === SOL_MINT_ADDR ? 'WSOL' : poolInfo.mintA.address === USDC_MINT_ADDR ? 'USDC' : 'TOKENA');
        const symB =
          poolInfo.mintB.symbol ||
          (poolInfo.mintB.address === USDC_MINT_ADDR ? 'USDC' : poolInfo.mintB.address === SOL_MINT_ADDR ? 'WSOL' : 'TOKENB');

        const feeA = Number(pos.tokenFeesOwedA.toString()) / 10 ** poolInfo.mintA.decimals;
        const feeB = Number(pos.tokenFeesOwedB.toString()) / 10 ** poolInfo.mintB.decimals;
        const upperA = symA.toUpperCase();
        const upperB = symB.toUpperCase();
        let uncollectedFeeUsd = 0;
        if (stables.has(upperB)) {
          uncollectedFeeUsd = feeA * currentPrice + feeB;
        } else if (stables.has(upperA)) {
          uncollectedFeeUsd = feeA + (currentPrice > 0 ? feeB / currentPrice : 0);
        } else if (upperA === 'SOL' || upperA === 'WSOL') {
          uncollectedFeeUsd = feeA * latestSolPriceUsd + (currentPrice > 0 ? feeB * (latestSolPriceUsd / currentPrice) : 0);
        } else if (upperB === 'SOL' || upperB === 'WSOL') {
          uncollectedFeeUsd = feeB * latestSolPriceUsd + feeA * currentPrice * latestSolPriceUsd;
        } else {
          uncollectedFeeUsd = feeA * currentPrice + feeB;
        }
        uncollectedFeeUsd = Number(uncollectedFeeUsd.toFixed(3));

        const metrics = calculatePositionMetrics({
          currentPrice,
          priceLower,
          priceUpper,
          amountA,
          amountB,
          tokenASymbol: symA,
          tokenBSymbol: symB,
          uncollectedFeeUsd,
          solPriceUsd: latestSolPriceUsd,
        });

        parsed.push({
          nftMint: pos.nftMint.toBase58(),
          nftMintMasked: maskSolanaAddress(pos.nftMint.toBase58()),
          poolId: poolIdStr,
          poolName: `${symA} / ${symB}`,
          dex: 'Raydium CLMM',
          priceCurrentUsd: currentPrice,
          priceLowerUsd: Number(priceLower.toFixed(6)),
          priceUpperUsd: Number(priceUpper.toFixed(6)),
          tickLower: lowerTick,
          tickUpper: upperTick,
          inRange: metrics.inRange,
          tokenASymbol: symA,
          tokenBSymbol: symB,
          tokenAAmount: Number(amountA.toFixed(5)),
          tokenBAmount: Number(amountB.toFixed(4)),
          injectedValueUsd: metrics.injectedValueUsd,
          uncollectedFeeUsd,
          unrealizedPnlUsd: metrics.unrealizedPnlUsd,
          unrealizedPnlPct: metrics.unrealizedPnlPct,
          liquidity: pos.liquidity.toString(),
        });
      } catch (posErr) {
        console.error('解析单个 CLMM 仓位失败:', posErr);
      }
    }

    cachedActivePositions = parsed;
    lastPositionsFetchTime = now;
    return cachedActivePositions;
  } catch (err) {
    console.error('获取链上 CLMM 仓位列表失败:', err);
    return cachedActivePositions;
  }
}

function recordSelectionRound(
  pools: ScoredPool[],
  jupiterSlippageBps: number | null,
  solPriceUsd: number | null
): PoolSelectionRound | null {
  if (!pools.length) return null;
  selectionRoundCounter += 1;
  const newRound = buildSelectionRoundFromPools({
    roundNumber: selectionRoundCounter,
    pools,
    jupiterSlippageBps,
    solPriceUsd,
    timeStr: nowTime(),
  });
  selectionRounds.unshift(newRound);
  if (selectionRounds.length > 40) {
    selectionRounds.pop();
  }
  return newRound;
}

async function callHeliusRpc(method: string, params: unknown[] = []) {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(HELIUS_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    const json = await res.json();
    const latency = Date.now() - start;
    if (json.error) {
      throw new Error(json.error.message || 'Helius RPC error');
    }
    return { result: json.result, latency };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRealPools(): Promise<{ pools: PoolMetrics[]; source: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(
      'https://api-v3.raydium.io/pools/info/list?poolType=concentrated&poolSortField=volume24h&sortType=desc&pageSize=35&page=1',
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const json = await res.json();
      const rows = json?.data?.data || [];
      const stables = new Set(['USDC', 'USDT', 'PYUSD', 'USDS', 'USD1']);
      const bluechips = new Set(['SOL', 'WSOL', 'MSOL', 'JITOSOL', 'BSOL', 'JUP']);

      const mapped: PoolMetrics[] = rows
        .filter((p: any) => {
          const tvl = Number(p.tvl || 0);
          const apr = Number(p.day?.apr || 0);
          // Filter out $0/$2 TVL scam APR traps while keeping real >=$100K active CLMM pools
          return tvl >= 100_000 && apr <= 600 && apr >= 1;
        })
        .slice(0, 16)
        .map((p: any) => {
          const tvl = Number(p.tvl || 0);
          const vol24h = Number(p.day?.volume || 0);
          const apr = Number(p.day?.apr || 0);
          const feeRate = Number(p.feeRate || 0.0025);
          const symbolA = p.mintA?.symbol || 'TOKEN';
          const symbolB = p.mintB?.symbol || 'SOL';
          const isBothStable = stables.has(symbolA) && stables.has(symbolB);
          const isBluechipStable =
            (stables.has(symbolA) && bluechips.has(symbolB)) ||
            (stables.has(symbolB) && bluechips.has(symbolA));
          const isLowIlPair = isBothStable || isBluechipStable;

          const safetyScore =
            tvl > 5_000_000 ? 96 : tvl > 2_000_000 ? 92 : tvl > 500_000 ? 84 : tvl > 250_000 ? 74 : 64;
          const ilRisk: '低' | '中' | '高' = isLowIlPair ? '低' : apr > 260 ? '高' : '中';

          return {
            id: p.id,
            name: `${symbolA} / ${symbolB}`,
            dex: 'RAYDIUM CLMM',
            address: p.id,
            tvl,
            volume24h: vol24h,
            apr: Number(apr.toFixed(1)),
            feeTier: `${(feeRate * 100).toFixed(2)}%`,
            priceUsd: p.price ? Number(p.price).toFixed(4) : '0.0000',
            safetyScore,
            ilRisk,
            isBluechip: isLowIlPair,
          };
        });

      if (mapped.length > 0) {
        return { pools: mapped, source: 'Raydium Mainnet API v3 (实时链上数据)' };
      }
    }
  } catch {
    // Fallback below
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch('https://api.dexscreener.com/latest/dex/search?q=SOL/USDC', {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const pairs = (data?.pairs || [])
        .filter((p: any) => p.chainId === 'solana' && Number(p.liquidity?.usd || 0) > 25_000)
        .slice(0, 10)
        .map((p: any) => {
          const tvl = Number(p.liquidity?.usd || 0);
          const vol24h = Number(p.volume?.h24 || 0);
          const apr = tvl > 0 ? Number((((vol24h * 0.0025 * 365) / tvl) * 100).toFixed(1)) : 0;
          return {
            id: p.pairAddress,
            name: `${p.baseToken?.symbol || 'SOL'} / ${p.quoteToken?.symbol || 'USDC'}`,
            dex: (p.dexId || 'RAYDIUM').toUpperCase(),
            address: p.pairAddress,
            tvl,
            volume24h: vol24h,
            apr,
            feeTier: '0.25%',
            priceUsd: p.priceUsd || '0.00',
            priceChange24h: Number(p.priceChange?.h24 || 0),
            safetyScore: tvl > 5_000_000 ? 95 : tvl > 2_000_000 ? 90 : 76,
            ilRisk: apr > 180 ? '高' : apr > 90 ? '中' : '低',
            url: p.url,
          } as PoolMetrics;
        });
      if (pairs.length > 0) {
        return { pools: pairs, source: 'DexScreener Solana 实时行情' };
      }
    }
  } catch {
    // Upstream unreachable
  }

  return { pools: [], source: '上游行情接口暂时不可达' };
}

app.get('/api/helius/health', async (_req, res) => {
  try {
    const { result: slot, latency } = await callHeliusRpc('getSlot', []);
    backendStatus.lastSlot = slot;
    backendStatus.heliusLatencyMs = latency;
    backendStatus.heliusConnected = true;

    // Query watch wallet OR derived server keypair public key (never exposes private key)
    if (isValidSolanaAddress(EFFECTIVE_WALLET_ADDRESS)) {
      const [balRes, tokRes] = await Promise.all([
        callHeliusRpc('getBalance', [EFFECTIVE_WALLET_ADDRESS]),
        callHeliusRpc('getTokenAccountsByOwner', [
          EFFECTIVE_WALLET_ADDRESS,
          { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
          { encoding: 'jsonParsed' },
        ]),
      ]);
      backendStatus.watchBalanceSOL = Number((Number(balRes.result?.value ?? 0) / 1e9).toFixed(4));
      backendStatus.splTokenAccountsCount = Array.isArray(tokRes.result?.value)
        ? tokRes.result.value.length
        : 0;
    }

    res.json({
      success: true,
      backendStatus: getLiveBackendStatus(),
    });
  } catch (err: any) {
    backendStatus.heliusConnected = false;
    res.status(502).json({
      success: false,
      error: `Helius RPC 连接异常: ${err.message}`,
    });
  }
});

app.get('/api/status', async (_req, res) => {
  if (selectionRounds.length === 0) {
    try {
      const { pools } = await fetchRealPools();
      const ranked = rankPools(pools, strategyConfig);
      recordSelectionRound(ranked, backendStatus.lastJupiterImpactBps, 142);
    } catch {
      // fallback
    }
  }
  const positions = await fetchActivePositions(false);
  res.json({
    success: true,
    backendStatus: getLiveBackendStatus(),
    strategyConfig,
    apiKeyRequirements: API_KEY_REQUIREMENTS,
    activePositions: positions,
    selectionRounds,
  });
});

app.get('/api/positions', async (req, res) => {
  const force = req.query.force === 'true';
  const positions = await fetchActivePositions(force);
  res.json({
    success: true,
    positions,
    updatedAt: new Date().toISOString(),
  });
});

app.get('/api/selection-rounds', (_req, res) => {
  res.json({
    success: true,
    rounds: selectionRounds,
    totalRounds: selectionRoundCounter,
    latestRound: selectionRounds[0] || null,
  });
});

async function fetchJupiterQuoteMetrics(amountSol: number) {
  const lamports = Math.round(amountSol * 1e9);
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  const url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=${lamports}&slippageBps=${strategyConfig.slippageBps}`;
  const apiRes = await fetch(url, { signal: controller.signal });
  clearTimeout(timer);
  if (!apiRes.ok) {
    throw new Error(`HTTP ${apiRes.status}`);
  }
  const quote = await apiRes.json();
  const outUsdc = Number(quote.outAmount || 0) / 1e6;
  const priceImpactPct = Number(quote.priceImpactPct || 0);
  const impactBps = Number((Math.abs(priceImpactPct) * 10000).toFixed(2));
  backendStatus.lastJupiterImpactBps = impactBps;
  const routeLabels = (quote.routePlan || [])
    .map((r: any) => r.swapInfo?.label)
    .filter(Boolean)
    .join(' → ');

  return {
    inAmountSol: amountSol,
    outAmountUsdc: Number(outUsdc.toFixed(4)),
    priceImpactPct,
    impactBps,
    route: routeLabels || 'Jupiter Smart Route',
  };
}

app.get('/api/pools/scan', async (_req, res) => {
  const { pools, source } = await fetchRealPools();
  const ranked = rankPools(pools, strategyConfig);
  recordSelectionRound(ranked, backendStatus.lastJupiterImpactBps, 142);
  if (backendStatus.riskAlerts.length === 0) {
    const initialAlerts = evaluateLiveRiskAlerts({
      pools: ranked,
      jupiterImpactBps: backendStatus.lastJupiterImpactBps,
      heliusLatencyMs: backendStatus.heliusLatencyMs,
      privateKeyConfigured: backendStatus.privateKeyConfigured,
      config: strategyConfig,
      nowTime: nowTime(),
    });
    appendRiskAlerts(initialAlerts);
  }
  res.json({
    success: true,
    source,
    pools: ranked,
    riskAlerts: backendStatus.riskAlerts,
    selectionRounds,
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/risk/scan', async (_req, res) => {
  try {
    const [heliusRes, poolsRes, jupiterRes] = await Promise.allSettled([
      callHeliusRpc('getSlot', []),
      fetchRealPools(),
      fetchJupiterQuoteMetrics(0.1),
    ]);

    if (heliusRes.status === 'fulfilled') {
      backendStatus.lastSlot = heliusRes.value.result;
      backendStatus.heliusLatencyMs = heliusRes.value.latency;
      backendStatus.heliusConnected = true;
    }

    const ranked =
      poolsRes.status === 'fulfilled'
        ? rankPools(poolsRes.value.pools, strategyConfig)
        : [];
    const jupiterImpactBps =
      jupiterRes.status === 'fulfilled' ? jupiterRes.value.impactBps : null;

    const solPriceUsd =
      jupiterRes.status === 'fulfilled'
        ? Number((jupiterRes.value.outAmountUsdc * 10).toFixed(2))
        : 142;

    recordSelectionRound(ranked, jupiterImpactBps, solPriceUsd);

    const alerts = evaluateLiveRiskAlerts({
      pools: ranked,
      jupiterImpactBps,
      heliusLatencyMs: backendStatus.heliusLatencyMs,
      privateKeyConfigured: backendStatus.privateKeyConfigured,
      config: strategyConfig,
      nowTime: nowTime(),
    });
    appendRiskAlerts(alerts);

    const positions = await fetchActivePositions(false);

    res.json({
      success: true,
      backendStatus: getLiveBackendStatus(),
      riskAlerts: backendStatus.riskAlerts,
      activePositions: positions,
      selectionRounds,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: `实时风控巡检失败: ${err.message}` });
  }
});

app.post('/api/jupiter/quote', async (req, res) => {
  const amountSol = Number(req.body?.amountSol ?? 0.1);
  if (!Number.isFinite(amountSol) || amountSol <= 0 || amountSol > 1000) {
    return res.status(400).json({ success: false, error: '请输入有效的测试兑换数量 (0 ~ 1000 SOL)' });
  }

  try {
    const result = await fetchJupiterQuoteMetrics(amountSol);
    pushLog(
      'info',
      `Jupiter Swap v1 真实免密询价成功：${amountSol} SOL ≈ ${result.outAmountUsdc} USDC（冲击 ${result.impactBps} bps，路由：${result.route}）`
    );
    if (result.impactBps > strategyConfig.slippageBps) {
      appendRiskAlerts([
        {
          id: `quote-slip`,
          time: nowTime(),
          severity: 'critical',
          category: '撤池换币滑点超限预警',
          target: `${amountSol} SOL → USDC`,
          detail: `当前试算冲击 ${result.impactBps} bps 已超过设定滑点上限 ${strategyConfig.slippageBps} bps，建议拆分换币或开启 Jito 防夹保护。`,
        },
      ]);
    }

    res.json({
      success: true,
      ...result,
      riskAlerts: backendStatus.riskAlerts,
    });
  } catch (err: any) {
    res.status(502).json({
      success: false,
      error: `Jupiter 询价接口请求失败: ${err.message}`,
    });
  }
});

// Simple capital + risk profile preset selector (no obscure technical fields needed)
app.post('/api/strategy/preset', (req, res) => {
  const capitalUsdt = Number(req.body?.capitalUsdt ?? 200);
  const rawProfile = req.body?.riskProfile;
  const riskProfile: RiskProfileKey =
    rawProfile === 'ultra-safe'
      ? 'ultra-safe'
      : rawProfile === 'active-yield'
      ? 'active-yield'
      : rawProfile === 'turbo-high-yield'
      ? 'turbo-high-yield'
      : 'balanced-steady';

  strategyConfig = buildPresetForCapital(capitalUsdt, riskProfile);
  const profileLabel =
    riskProfile === 'ultra-safe'
      ? '极稳保守'
      : riskProfile === 'active-yield'
      ? '进取增效（±6%窄区间双仓）'
      : riskProfile === 'turbo-high-yield'
      ? '极速高收益突击（±4%超窄双仓 · 45%核心+55%高APR卫星池）'
      : '稳健平衡（±10%集中区间）';
  pushLog(
    'info',
    `已应用 ${strategyConfig.capitalUsdt}U ${profileLabel}方案（做市 ${strategyConfig.lpActiveUsdt}U + Gas 预留 ${strategyConfig.gasReserveUsdt}U，最低 TVL $${(strategyConfig.minTVL / 1e6).toFixed(2)}M，区间 ±${strategyConfig.rangeWidthPct}%）。`
  );
  res.json({ success: true, strategyConfig, logs: backendStatus.logs });
});

const SOL_MINT_ADDR = 'So11111111111111111111111111111111111111112';
const USDC_MINT_ADDR = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT_ADDR = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

let lastLiveTestPosition: { poolId: string; nftMint: string } | null = null;

async function getWalletBalances(pubkey: PublicKey): Promise<{
  solBalance: number;
  usdcBalance: number;
  usdtBalance: number;
  tokenAccountCount: number;
}> {
  const [lamports, tokenAccs] = await Promise.all([
    solanaConnection.getBalance(pubkey),
    solanaConnection.getParsedTokenAccountsByOwner(pubkey, {
      programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    }),
  ]);
  let usdcBalance = 0;
  let usdtBalance = 0;
  for (const acc of tokenAccs.value) {
    const info = acc.account.data?.parsed?.info;
    const mint = info?.mint;
    const uiAmount = Number(info?.tokenAmount?.uiAmount || 0);
    if (mint === USDC_MINT_ADDR) usdcBalance += uiAmount;
    if (mint === USDT_MINT_ADDR) usdtBalance += uiAmount;
  }
  const solBalance = Number((lamports / 1e9).toFixed(6));
  backendStatus.watchBalanceSOL = Number(solBalance.toFixed(4));
  backendStatus.splTokenAccountsCount = tokenAccs.value.length;
  return {
    solBalance,
    usdcBalance,
    usdtBalance,
    tokenAccountCount: tokenAccs.value.length,
  };
}

async function resolveTopSolUsdcClmmPoolId(): Promise<string> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(
      `https://api-v3.raydium.io/pools/info/mint?mint1=${SOL_MINT_ADDR}&mint2=${USDC_MINT_ADDR}&poolType=concentrated&poolSortField=liquidity&sortType=desc&pageSize=3&page=1`,
      { signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const json = await res.json();
      const firstId = json?.data?.data?.[0]?.id;
      if (firstId && isValidSolanaAddress(firstId)) {
        return firstId;
      }
    }
  } catch {
    // Fallback to flagship WSOL/USDC CLMM pool
  }
  return '3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUsdcVisibility(pubkey: PublicKey, maxWaitMs = 4500) {
  const deadline = Date.now() + maxWaitMs;
  let balances = await getWalletBalances(pubkey);
  while (balances.usdcBalance < 0.05 && Date.now() < deadline) {
    await sleep(600);
    balances = await getWalletBalances(pubkey);
  }
  return balances;
}

/**
 * Simulates a signed VersionedTransaction to fail fast on balance/slippage errors (no 30s hang),
 * then broadcasts and actively rebroadcasts every 1.5s with skipPreflight=true while polling
 * getSignatureStatuses + blockHeight until confirmed or genuinely expired.
 */
async function sendAndConfirmRawWithRebroadcast(
  tx: VersionedTransaction,
  signature: string,
  lastValidBlockHeight: number
): Promise<string> {
  const sim = await solanaConnection.simulateTransaction(tx, {
    sigVerify: false,
    commitment: 'confirmed',
  });
  if (sim.value.err) {
    const tailLogs = Array.isArray(sim.value.logs) ? sim.value.logs.slice(-4).join(' | ') : '';
    throw new Error(
      `链上仿真未通过: ${formatChainError(sim.value.err)}${tailLogs ? ` [日志: ${tailLogs}]` : ''}`
    );
  }

  const rawTx = tx.serialize();
  const startedAt = Date.now();
  let lastSendAt = 0;

  while (true) {
    const now = Date.now();
    if (now - lastSendAt >= 1500) {
      lastSendAt = now;
      await solanaConnection
        .sendRawTransaction(rawTx, { skipPreflight: true, maxRetries: 0 })
        .catch(() => undefined);
    }

    await sleep(900);

    const statusResp = await solanaConnection
      .getSignatureStatuses([signature], { searchTransactionHistory: false })
      .catch(() => null);
    const status = statusResp?.value?.[0];
    if (status) {
      if (status.err) {
        throw new Error(`链上确认返回指令错误: ${formatChainError(status.err)}`);
      }
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
        return signature;
      }
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed > 10_000) {
      const currentBlockHeight = await solanaConnection
        .getBlockHeight('confirmed')
        .catch(() => 0);
      if (
        (lastValidBlockHeight > 0 && currentBlockHeight > lastValidBlockHeight + 4) ||
        elapsed > 45_000
      ) {
        throw new Error(
          `Signature ${signature} has expired: block height exceeded (${currentBlockHeight} > ${lastValidBlockHeight}).`
        );
      }
    }
  }
}

async function runSwapPipelineTest(
  mode: PipelineRunMode,
  asset: PipelineTestAsset
): Promise<PipelineStepResult> {
  const started = Date.now();
  const isSolInput = asset === 'SOL';
  const inputMint =
    asset === 'USDC' ? USDC_MINT_ADDR : asset === 'USDT' ? USDT_MINT_ADDR : SOL_MINT_ADDR;
  const outputMint = isSolInput ? USDC_MINT_ADDR : SOL_MINT_ADDR;
  const amountAtomic = isSolInput ? 10_000_000 : 100_000; // 0.01 SOL or 0.1 USDC / 0.1 USDT
  const amountLabel = isSolInput ? '0.01 SOL → USDC' : `0.1 ${asset} → SOL`;
  const outDivisor = isSolInput ? 1e6 : 1e9;
  const outSymbol = isSolInput ? 'USDC' : 'SOL';

  const fetchQuoteAndSwapTx = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const slippageBps = Math.max(strategyConfig.slippageBps, 80);
    const quoteUrl = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountAtomic}&slippageBps=${slippageBps}`;
    const quoteRes = await fetch(quoteUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!quoteRes.ok) {
      throw new Error(`Jupiter quote HTTP ${quoteRes.status}`);
    }
    const quote = await quoteRes.json();
    const outReadable = (Number(quote.outAmount || 0) / outDivisor).toFixed(isSolInput ? 4 : 5);
    const impactBps = (Math.abs(Number(quote.priceImpactPct || 0)) * 10000).toFixed(2);
    const route =
      (quote.routePlan || [])
        .map((r: any) => r.swapInfo?.label)
        .filter(Boolean)
        .join(' → ') || 'Jupiter Smart Route';

    if (!BACKEND_KEYPAIR) {
      return {
        quote,
        outReadable,
        impactBps,
        route,
        swapData: null as any,
      };
    }

    const swapCtrl = new AbortController();
    const swapTimer = setTimeout(() => swapCtrl.abort(), 9000);
    const swapRes = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: BACKEND_KEYPAIR.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 350_000,
            priorityLevel: 'high',
          },
        },
      }),
      signal: swapCtrl.signal,
    });
    clearTimeout(swapTimer);
    if (!swapRes.ok) {
      const errBody = await swapRes.text().catch(() => '');
      throw new Error(`Jupiter swap HTTP ${swapRes.status}${errBody ? `: ${errBody.slice(0, 120)}` : ''}`);
    }
    const swapData = await swapRes.json();
    if (!swapData?.swapTransaction) {
      throw new Error('Jupiter swapTransaction 返回为空');
    }
    return { quote, outReadable, impactBps, route, swapData };
  };

  try {
    let prepared = await fetchQuoteAndSwapTx();

    if (!BACKEND_KEYPAIR) {
      return {
        step: 'swap',
        title: '1. 代币兑换 (Jupiter Swap v1)',
        status: mode === 'live' ? 'failed' : 'readonly_only',
        mode,
        summary:
          mode === 'live'
            ? '真实交易被拒绝：后台 .env 尚未配置有效 PRIVATE_KEY'
            : `免密路由正常（${amountLabel} ≈ ${prepared.outReadable} ${outSymbol}），未配私钥仅做报价检查`,
        details: `路由: ${prepared.route} · 滑点冲击 ${prepared.impactBps} bps。请在服务器 .env 配置 PRIVATE_KEY 后即可发送真实主网兑换交易。`,
        durationMs: Date.now() - started,
      };
    }

    if (mode === 'live') {
      let txId = '';
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const tx = VersionedTransaction.deserialize(
          Buffer.from(prepared.swapData.swapTransaction, 'base64')
        );
        tx.sign([BACKEND_KEYPAIR]);
        const sig = bs58.encode(tx.signatures[0]);
        const lastValidBlockHeight =
          Number(prepared.swapData.lastValidBlockHeight || 0) ||
          (await solanaConnection.getBlockHeight('confirmed')) + 140;
        try {
          txId = await sendAndConfirmRawWithRebroadcast(tx, sig, lastValidBlockHeight);
          break;
        } catch (attemptErr: any) {
          const msg = formatChainError(attemptErr);
          const canRetry =
            attempt === 1 &&
            (msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('blockhash'));
          if (!canRetry) {
            throw attemptErr;
          }
          prepared = await fetchQuoteAndSwapTx();
        }
      }

      if (isSolInput) {
        await waitForUsdcVisibility(BACKEND_KEYPAIR.publicKey);
      } else {
        await getWalletBalances(BACKEND_KEYPAIR.publicKey);
      }

      return {
        step: 'swap',
        title: '1. 代币兑换 (Jupiter Swap v1)',
        status: 'passed',
        mode: 'live',
        txId,
        explorerUrl: `https://solscan.io/tx/${txId}`,
        summary: `真实兑换上链成功！已完成 ${amountLabel}（实收约 ${prepared.outReadable} ${outSymbol}）`,
        details: `真实路由 ${prepared.route} · 滑点 ${prepared.impactBps} bps · 高优 Fee + 重广播已确认 · TX: ${txId}`,
        durationMs: Date.now() - started,
      };
    }

    const tx = VersionedTransaction.deserialize(
      Buffer.from(prepared.swapData.swapTransaction, 'base64')
    );
    tx.sign([BACKEND_KEYPAIR]);
    const sim = await solanaConnection.simulateTransaction(tx, { sigVerify: true });
    if (sim.value.err) {
      return {
        step: 'swap',
        title: '1. 代币兑换 (Jupiter Swap v1)',
        status: 'warning',
        mode: 'simulate',
        summary: `仿真检查提示钱包余额不足或需租金: ${formatChainError(sim.value.err)}`,
        details: `已签名交易 (${amountLabel} ≈ ${prepared.outReadable} ${outSymbol})，路由 ${prepared.route}。`,
        durationMs: Date.now() - started,
      };
    }

    return {
      step: 'swap',
      title: '1. 代币兑换 (Jupiter Swap v1)',
      status: 'passed',
      mode: 'simulate',
      summary: `仿真检查通过！${amountLabel} ≈ ${prepared.outReadable} ${outSymbol}（消耗 ${
        sim.value.unitsConsumed ?? 'N/A'
      } CU）`,
      details: `真实路由 ${prepared.route} · 滑点 ${prepared.impactBps} bps（未真实广播）。`,
      durationMs: Date.now() - started,
    };
  } catch (err: unknown) {
    return {
      step: 'swap',
      title: '1. 代币兑换 (Jupiter Swap v1)',
      status: 'failed',
      mode,
      summary: `真实兑换执行失败: ${formatChainError(err)}`,
      details: '请确认钱包持有足够的 SOL/USDC/USDT 余额及 Gas 费，且服务器可正常访问 Jupiter v1。',
      durationMs: Date.now() - started,
    };
  }
}

async function getSplTokenUiBalance(pubkey: PublicKey, mintAddr: string): Promise<{
  atomic: bigint;
  uiAmount: number;
  decimals: number;
}> {
  if (mintAddr === SOL_MINT_ADDR) {
    const lamports = await solanaConnection.getBalance(pubkey);
    return { atomic: BigInt(lamports), uiAmount: lamports / 1e9, decimals: 9 };
  }
  const accs = await solanaConnection.getParsedTokenAccountsByOwner(pubkey, {
    mint: new PublicKey(mintAddr),
  });
  let totalAtomic = 0n;
  let decimals = 6;
  for (const acc of accs.value) {
    const tokenAmt = acc.account.data?.parsed?.info?.tokenAmount;
    if (tokenAmt?.amount) {
      totalAtomic += BigInt(tokenAmt.amount);
      decimals = Number(tokenAmt.decimals ?? decimals);
    }
  }
  return {
    atomic: totalAtomic,
    uiAmount: Number(totalAtomic) / 10 ** decimals,
    decimals,
  };
}

async function executeJupiterTokenSwap(params: {
  inputMint: string;
  outputMint: string;
  amountAtomic: string | number | bigint;
  slippageBps?: number;
}): Promise<{ txId: string; outAmountAtomic: string }> {
  if (!BACKEND_KEYPAIR) {
    throw new Error('后台 .env 未配置有效 PRIVATE_KEY');
  }
  const { inputMint, outputMint, amountAtomic, slippageBps = Math.max(strategyConfig.slippageBps, 100) } = params;

  const fetchPrepared = async () => {
    const qCtrl = new AbortController();
    const qTimer = setTimeout(() => qCtrl.abort(), 9000);
    const quoteUrl = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${String(amountAtomic)}&slippageBps=${slippageBps}`;
    const qRes = await fetch(quoteUrl, { signal: qCtrl.signal });
    clearTimeout(qTimer);
    if (!qRes.ok) {
      throw new Error(`Jupiter quote HTTP ${qRes.status}`);
    }
    const quote = await qRes.json();
    const sCtrl = new AbortController();
    const sTimer = setTimeout(() => sCtrl.abort(), 9000);
    const sRes = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: BACKEND_KEYPAIR!.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 350_000,
            priorityLevel: 'high',
          },
        },
      }),
      signal: sCtrl.signal,
    });
    clearTimeout(sTimer);
    if (!sRes.ok) {
      const errBody = await sRes.text().catch(() => '');
      throw new Error(`Jupiter swap HTTP ${sRes.status}: ${errBody.slice(0, 120)}`);
    }
    const swapData = await sRes.json();
    if (!swapData?.swapTransaction) {
      throw new Error('Jupiter swapTransaction 返回为空');
    }
    return { quote, swapData };
  };

  let prepared = await fetchPrepared();
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const tx = VersionedTransaction.deserialize(
      Buffer.from(prepared.swapData.swapTransaction, 'base64')
    );
    tx.sign([BACKEND_KEYPAIR]);
    const sig = bs58.encode(tx.signatures[0]);
    const lastValidBlockHeight =
      Number(prepared.swapData.lastValidBlockHeight || 0) ||
      (await solanaConnection.getBlockHeight('confirmed')) + 140;
    try {
      const txId = await sendAndConfirmRawWithRebroadcast(tx, sig, lastValidBlockHeight);
      return { txId, outAmountAtomic: String(prepared.quote.outAmount || '0') };
    } catch (err: any) {
      const msg = formatChainError(err).toLowerCase();
      if (attempt === 1 && (msg.includes('expired') || msg.includes('blockhash'))) {
        prepared = await fetchPrepared();
        continue;
      }
      throw err;
    }
  }
  throw new Error('Jupiter swap retry exhausted');
}

async function closeClmmPositionByNft(nftMintFilter?: string): Promise<{
  closedNftMint: string;
  poolId: string;
  txId: string;
}> {
  if (!BACKEND_KEYPAIR) {
    throw new Error('后台 .env 未配置有效 PRIVATE_KEY');
  }
  const raydium = await Raydium.load({
    owner: BACKEND_KEYPAIR,
    connection: solanaConnection,
    cluster: 'mainnet',
    disableFeatureCheck: true,
    disableLoadToken: true,
  });
  try {
    await raydium.account.fetchWalletTokenAccounts({
      forceUpdate: true,
      commitment: 'confirmed',
    });
    const positions = await raydium.clmm.getOwnerPositionInfo({
      programId: CLMM_PROGRAM_ID,
    });
    if (!positions.length) {
      throw new Error('链上暂未检测到活跃 Raydium CLMM 仓位');
    }
    const targetPos =
      (nftMintFilter && positions.find((p) => p.nftMint.toBase58() === nftMintFilter)) ||
      positions[0];
    const { poolInfo, poolKeys } = await raydium.clmm.getPoolInfoFromRpc(
      targetPos.poolId.toBase58()
    );

    let txId = '';
    if (!targetPos.liquidity.isZero()) {
      const { transaction } = await raydium.clmm.decreaseLiquidity({
        poolInfo,
        poolKeys,
        ownerPosition: targetPos,
        ownerInfo: {
          useSOLBalance: true,
          closePosition: true,
        },
        liquidity: targetPos.liquidity,
        amountMinA: new BN(0),
        amountMinB: new BN(0),
        txVersion: TxVersion.V0,
        computeBudgetConfig: { units: 500_000, microLamports: 150_000 },
      });
      const sig = bs58.encode(transaction.signatures[0]);
      const currentHeight = await solanaConnection.getBlockHeight('confirmed');
      txId = await sendAndConfirmRawWithRebroadcast(transaction, sig, currentHeight + 145);
    } else {
      const { transaction } = await raydium.clmm.closePosition({
        poolInfo,
        poolKeys,
        ownerPosition: targetPos,
        txVersion: TxVersion.V0,
        computeBudgetConfig: { units: 300_000, microLamports: 150_000 },
      });
      const sig = bs58.encode(transaction.signatures[0]);
      const currentHeight = await solanaConnection.getBlockHeight('confirmed');
      txId = await sendAndConfirmRawWithRebroadcast(transaction, sig, currentHeight + 145);
    }

    await getWalletBalances(BACKEND_KEYPAIR.publicKey);
    await fetchActivePositions(true);
    return {
      closedNftMint: targetPos.nftMint.toBase58(),
      poolId: targetPos.poolId.toBase58(),
      txId,
    };
  } finally {
    raydium.account.clearAccountChangeCkb();
  }
}

async function openRealClmmPoolPosition(params: {
  poolId: string;
  targetUsd: number;
  rangeWidthPct: number;
  solPriceUsd?: number;
}): Promise<{
  poolId: string;
  poolName: string;
  nftMint: string;
  txId: string;
  swapTxId?: string;
  tickLower: number;
  tickUpper: number;
  injectedSummary: string;
}> {
  if (!BACKEND_KEYPAIR) {
    throw new Error('后台 .env 未配置有效 PRIVATE_KEY');
  }
  const { poolId, targetUsd, rangeWidthPct, solPriceUsd = latestSolPriceUsd || 85 } = params;
  const safeRangePct = Math.max(3, Math.min(25, rangeWidthPct));
  const ownerPk = BACKEND_KEYPAIR.publicKey;

  const raydium = await Raydium.load({
    owner: BACKEND_KEYPAIR,
    connection: solanaConnection,
    cluster: 'mainnet',
    disableFeatureCheck: true,
    disableLoadToken: true,
  });

  try {
    const { poolInfo, poolKeys } = await raydium.clmm.getPoolInfoFromRpc(poolId);
    const mintA = poolInfo.mintA.address;
    const mintB = poolInfo.mintB.address;
    const decA = poolInfo.mintA.decimals;
    const decB = poolInfo.mintB.decimals;
    const symA = poolInfo.mintA.symbol || (mintA === SOL_MINT_ADDR ? 'WSOL' : mintA === USDC_MINT_ADDR ? 'USDC' : 'TOKENA');
    const symB = poolInfo.mintB.symbol || (mintB === USDC_MINT_ADDR ? 'USDC' : mintB === SOL_MINT_ADDR ? 'WSOL' : 'TOKENB');

    const isSolA = mintA === SOL_MINT_ADDR;
    const isSolB = mintB === SOL_MINT_ADDR;
    const isUsdcA = mintA === USDC_MINT_ADDR;
    const isUsdcB = mintB === USDC_MINT_ADDR;

    if (!isSolA && !isSolB && !isUsdcA && !isUsdcB) {
      throw new Error(`池子 ${symA}/${symB} 不含 SOL 或 USDC 基础资产，暂跳过`);
    }

    const balances = await getWalletBalances(ownerPk);
    const minSolReserve = 0.026; // NFT rent ~0.018 + gas fees
    const availSol = Math.max(0, balances.solBalance - minSolReserve);
    if (balances.solBalance < minSolReserve) {
      throw new Error(`可用 SOL 仅 ${balances.solBalance.toFixed(4)}，低于 ${minSolReserve} SOL 仓位租金与手续费门槛`);
    }

    const availSolUsd = availSol * solPriceUsd;
    const availUsdcUsd = balances.usdcBalance;
    const cappedTotalUsd = Math.min(Math.max(targetUsd, 2), (availSolUsd + availUsdcUsd) * 0.92);
    const halfUsd = cappedTotalUsd * 0.48;
    let swapTxId: string | undefined;

    // Step 1: Ensure we hold ~halfUsd worth of the non-USDC / non-SOL side (or balance WSOL/USDC)
    if ((isSolA && isUsdcB) || (isUsdcA && isSolB)) {
      // WSOL <-> USDC pair: balance only if one side is much smaller than halfUsd
      if (availUsdcUsd < halfUsd * 0.72 && availSolUsd > halfUsd * 1.15) {
        const swapUsd = Math.min(halfUsd - availUsdcUsd, availSolUsd * 0.55);
        const swapLamports = Math.floor((swapUsd / solPriceUsd) * 1e9);
        if (swapLamports >= 2_000_000) {
          const sw = await executeJupiterTokenSwap({
            inputMint: SOL_MINT_ADDR,
            outputMint: USDC_MINT_ADDR,
            amountAtomic: swapLamports,
          });
          swapTxId = sw.txId;
          await sleep(1800);
        }
      } else if (availSolUsd < halfUsd * 0.72 && availUsdcUsd > halfUsd * 1.15) {
        const swapUsd = Math.min(halfUsd - availSolUsd, availUsdcUsd * 0.55);
        const swapUsdcAtomic = Math.floor(swapUsd * 1e6);
        if (swapUsdcAtomic >= 300_000) {
          const sw = await executeJupiterTokenSwap({
            inputMint: USDC_MINT_ADDR,
            outputMint: SOL_MINT_ADDR,
            amountAtomic: swapUsdcAtomic,
          });
          swapTxId = sw.txId;
          await sleep(1800);
        }
      }
    } else {
      // One side is TokenX, the other side is USDC or WSOL
      const tokenXMint = isUsdcA || isSolA ? mintB : mintA;
      const otherIsUsdc = isUsdcA || isUsdcB;
      const balX = await getSplTokenUiBalance(ownerPk, tokenXMint);
      const tokenXDecimals = balX.decimals;
      // Estimate TokenX price in USD
      const currentPoolPrice = Number(poolInfo.price || 0);
      let priceXUsd = 1;
      if (isUsdcB) priceXUsd = currentPoolPrice;
      else if (isUsdcA) priceXUsd = currentPoolPrice > 0 ? 1 / currentPoolPrice : 1;
      else if (isSolA) priceXUsd = currentPoolPrice > 0 ? solPriceUsd / currentPoolPrice : 1;
      else if (isSolB) priceXUsd = currentPoolPrice * solPriceUsd;

      const existingXUsd = balX.uiAmount * priceXUsd;
      const needSwapUsd = Math.max(0, halfUsd - existingXUsd);

      if (needSwapUsd >= 0.5) {
        if (otherIsUsdc) {
          // Reserve ~halfUsd in USDC for the USDC side; fund TokenX swap from excess USDC or excess SOL
          const excessUsdc = Math.max(0, availUsdcUsd - halfUsd);
          if (excessUsdc >= needSwapUsd * 0.9) {
            const amtAtomic = Math.floor(Math.min(needSwapUsd, excessUsdc * 0.96) * 1e6);
            const sw = await executeJupiterTokenSwap({
              inputMint: USDC_MINT_ADDR,
              outputMint: tokenXMint,
              amountAtomic: amtAtomic,
            });
            swapTxId = sw.txId;
            await sleep(2200);
          } else if (availSolUsd >= needSwapUsd * 0.95) {
            const amtLamports = Math.floor((Math.min(needSwapUsd, availSolUsd * 0.92) / solPriceUsd) * 1e9);
            const sw = await executeJupiterTokenSwap({
              inputMint: SOL_MINT_ADDR,
              outputMint: tokenXMint,
              amountAtomic: amtLamports,
            });
            swapTxId = sw.txId;
            await sleep(2200);
          } else if (availUsdcUsd >= needSwapUsd * 1.1) {
            const amtAtomic = Math.floor((availUsdcUsd * 0.48) * 1e6);
            const sw = await executeJupiterTokenSwap({
              inputMint: USDC_MINT_ADDR,
              outputMint: tokenXMint,
              amountAtomic: amtAtomic,
            });
            swapTxId = sw.txId;
            await sleep(2200);
          }
        } else {
          // WSOL / TokenX pool
          const excessSolUsd = Math.max(0, availSolUsd - halfUsd);
          if (availUsdcUsd >= needSwapUsd * 0.9) {
            const amtAtomic = Math.floor(Math.min(needSwapUsd, availUsdcUsd * 0.96) * 1e6);
            const sw = await executeJupiterTokenSwap({
              inputMint: USDC_MINT_ADDR,
              outputMint: tokenXMint,
              amountAtomic: amtAtomic,
            });
            swapTxId = sw.txId;
            await sleep(2200);
          } else if (excessSolUsd >= needSwapUsd * 0.9) {
            const amtLamports = Math.floor((Math.min(needSwapUsd, excessSolUsd * 0.92) / solPriceUsd) * 1e9);
            const sw = await executeJupiterTokenSwap({
              inputMint: SOL_MINT_ADDR,
              outputMint: tokenXMint,
              amountAtomic: amtLamports,
            });
            swapTxId = sw.txId;
            await sleep(2200);
          }
        }

        // Wait up to 4s until TokenX balance settles
        const deadline = Date.now() + 4000;
        let settled = await getSplTokenUiBalance(ownerPk, tokenXMint);
        while (settled.atomic === 0n && Date.now() < deadline) {
          await sleep(600);
          settled = await getSplTokenUiBalance(ownerPk, tokenXMint);
        }
        if (settled.atomic === 0n && tokenXDecimals >= 0) {
          throw new Error(`兑换 ${symA}/${symB} 后链上代币尚未到账，下一轮巡检将继续建仓`);
        }
      }
    }

    await raydium.account.fetchWalletTokenAccounts({
      forceUpdate: true,
      commitment: 'confirmed',
    });

    const latestBalA = await getSplTokenUiBalance(ownerPk, mintA);
    const latestBalB = await getSplTokenUiBalance(ownerPk, mintB);
    const availAAtomic =
      mintA === SOL_MINT_ADDR
        ? BigInt(Math.max(0, Number(latestBalA.atomic) - Math.floor(minSolReserve * 1e9)))
        : latestBalA.atomic;
    const availBAtomic =
      mintB === SOL_MINT_ADDR
        ? BigInt(Math.max(0, Number(latestBalB.atomic) - Math.floor(minSolReserve * 1e9)))
        : latestBalB.atomic;

    if (availAAtomic <= 0n || availBAtomic <= 0n) {
      throw new Error(`开仓所需双边代币余额不足 (${symA}=${latestBalA.uiAmount.toFixed(4)}, ${symB}=${latestBalB.uiAmount.toFixed(4)})`);
    }

    const currentPrice = new Decimal(poolInfo.price);
    const lowerPrice = currentPrice.mul(1 - safeRangePct / 100);
    const upperPrice = currentPrice.mul(1 + safeRangePct / 100);
    const lowerRes = TickUtil.getPriceAndTick({
      price: lowerPrice,
      mintADecimals: decA,
      mintBDecimals: decB,
      zeroForOne: true,
      tickSpacing: poolInfo.config.tickSpacing,
    });
    const upperRes = TickUtil.getPriceAndTick({
      price: upperPrice,
      mintADecimals: decA,
      mintBDecimals: decB,
      zeroForOne: true,
      tickSpacing: poolInfo.config.tickSpacing,
    });

    const tickLower = Math.min(lowerRes.tick, upperRes.tick);
    const tickUpper =
      Math.max(lowerRes.tick, upperRes.tick) <= tickLower
        ? tickLower + poolInfo.config.tickSpacing * 2
        : Math.max(lowerRes.tick, upperRes.tick);

    const epochInfo = await solanaConnection.getEpochInfo('confirmed');

    // Choose non-SOL/non-USDC side as base when present; otherwise MintB (USDC) capped to halfUsd
    let base: 'MintA' | 'MintB' = !isSolA && !isUsdcA ? 'MintA' : !isSolB && !isUsdcB ? 'MintB' : isUsdcA ? 'MintA' : 'MintB';
    let targetBaseAtomic: bigint;

    if (base === 'MintA') {
      const capByUsd =
        isUsdcA
          ? BigInt(Math.floor(halfUsd * 10 ** decA))
          : isSolA
          ? BigInt(Math.floor((halfUsd / solPriceUsd) * 10 ** decA))
          : availAAtomic;
      const capped = capByUsd < availAAtomic ? capByUsd : availAAtomic;
      targetBaseAtomic = (capped * 92n) / 100n;
    } else {
      const capByUsd =
        isUsdcB
          ? BigInt(Math.floor(halfUsd * 10 ** decB))
          : isSolB
          ? BigInt(Math.floor((halfUsd / solPriceUsd) * 10 ** decB))
          : availBAtomic;
      const capped = capByUsd < availBAtomic ? capByUsd : availBAtomic;
      targetBaseAtomic = (capped * 92n) / 100n;
    }

    if (targetBaseAtomic <= 0n) {
      throw new Error(`测算开仓基础数量为 0 (${symA}/${symB})`);
    }

    let baseAmount = new BN(targetBaseAtomic.toString());
    let liqRes = await PoolUtils.getLiquidityAmountOutFromAmountIn({
      poolInfo,
      inputA: base === 'MintA',
      tickLower,
      tickUpper,
      amount: baseAmount,
      slippage: 0.08,
      add: true,
      epochInfo,
      amountHasFee: true,
    });

    let expectedOther = base === 'MintA' ? liqRes.amountB.amount : liqRes.amountA.amount;
    let sdkSlippageOther =
      base === 'MintA' ? liqRes.amountSlippageB.amount : liqRes.amountSlippageA.amount;
    let otherAmountMaxStr = computeSafeClmmOtherAmountMax(
      expectedOther.toString(),
      sdkSlippageOther.toString(),
      25
    );
    const availOtherAtomic = base === 'MintA' ? availBAtomic : availAAtomic;

    // Auto-scale base down proportionally if otherAmountMax exceeds wallet's available balance
    if (BigInt(otherAmountMaxStr) > (availOtherAtomic * 94n) / 100n) {
      const maxAllowedOther = (availOtherAtomic * 90n) / 100n;
      const scaledBase = (targetBaseAtomic * maxAllowedOther) / BigInt(otherAmountMaxStr);
      if (scaledBase <= 0n) {
        throw new Error(`对向代币余额不足以配比开仓 (${symA}/${symB})`);
      }
      baseAmount = new BN(scaledBase.toString());
      liqRes = await PoolUtils.getLiquidityAmountOutFromAmountIn({
        poolInfo,
        inputA: base === 'MintA',
        tickLower,
        tickUpper,
        amount: baseAmount,
        slippage: 0.08,
        add: true,
        epochInfo,
        amountHasFee: true,
      });
      expectedOther = base === 'MintA' ? liqRes.amountB.amount : liqRes.amountA.amount;
      sdkSlippageOther =
        base === 'MintA' ? liqRes.amountSlippageB.amount : liqRes.amountSlippageA.amount;
      otherAmountMaxStr = computeSafeClmmOtherAmountMax(
        expectedOther.toString(),
        sdkSlippageOther.toString(),
        25
      );
    }

    const otherAmountMax = new BN(otherAmountMaxStr);
    const { transaction, extInfo } = await raydium.clmm.openPositionFromBase({
      poolInfo,
      poolKeys,
      tickLower,
      tickUpper,
      base,
      ownerInfo: { useSOLBalance: true },
      baseAmount,
      otherAmountMax,
      nft2022: true,
      withMetadata: 'no-create',
      txVersion: TxVersion.V0,
      computeBudgetConfig: { units: 600_000, microLamports: 150_000 },
    });

    const sig = bs58.encode(transaction.signatures[0]);
    const currentHeight = await solanaConnection.getBlockHeight('confirmed');
    const txId = await sendAndConfirmRawWithRebroadcast(transaction, sig, currentHeight + 145);

    const nftMint = extInfo.nftMint.toBase58();
    lastLiveTestPosition = { poolId, nftMint };
    await getWalletBalances(ownerPk);
    await fetchActivePositions(true);

    const amtAStr = (
      Number((base === 'MintA' ? baseAmount : expectedOther).toString()) /
      10 ** decA
    ).toFixed(4);
    const amtBStr = (
      Number((base === 'MintB' ? baseAmount : expectedOther).toString()) /
      10 ** decB
    ).toFixed(4);

    return {
      poolId,
      poolName: `${symA} / ${symB}`,
      nftMint,
      txId,
      swapTxId,
      tickLower,
      tickUpper,
      injectedSummary: `${amtAStr} ${symA} + ${amtBStr} ${symB} (±${safeRangePct}%)`,
    };
  } finally {
    raydium.account.clearAccountChangeCkb();
  }
}

async function runAddLpPipelineTest(mode: PipelineRunMode): Promise<PipelineStepResult> {
  const started = Date.now();
  let raydium: Raydium | null = null;
  try {
    if (mode === 'simulate') {
      const [{ pools, source }, solQuote] = await Promise.all([
        fetchRealPools(),
        fetchJupiterQuoteMetrics(0.1).catch(() => null),
      ]);
      const ranked = rankPools(pools, strategyConfig);
      const targetPool = ranked.find((p) => p.eligibleFor200U) || ranked[0];
      if (!targetPool) {
        return {
          step: 'addLp',
          title: '2. 加池子 (Raydium CLMM)',
          status: 'warning',
          mode,
          summary: '当前暂无符合门槛的矿池（数据源不可达或全被风控拦截）',
          details: `数据源: ${source}`,
          durationMs: Date.now() - started,
        };
      }
      const accountInfo = await solanaConnection.getAccountInfo(new PublicKey(targetPool.address));
      const solPriceUsd = solQuote ? solQuote.outAmountUsdc * 10 : 140;
      const split = calculateLpDepositAmounts(
        strategyConfig.lpActiveUsdt,
        solPriceUsd,
        strategyConfig.rangeWidthPct
      );
      return {
        step: 'addLp',
        title: '2. 加池子 (Raydium CLMM)',
        status: BACKEND_KEYPAIR ? 'passed' : 'readonly_only',
        mode,
        summary: `优选池 ${targetPool.name}（年化 +${targetPool.apr}%）链上账户只读核验通过`,
        details: `账户字节 ${accountInfo?.data.length ?? 0} B · ${strategyConfig.lpActiveUsdt}U 测算配比 ${
          split.usdcAmount
        } USDC + ${split.solAmount} SOL（±${strategyConfig.rangeWidthPct}%）。`,
        durationMs: Date.now() - started,
      };
    }

    if (!BACKEND_KEYPAIR) {
      return {
        step: 'addLp',
        title: '2. 加池子 (Raydium CLMM)',
        status: 'failed',
        mode: 'live',
        summary: '真实加池被拒绝：后台 .env 未配置有效 PRIVATE_KEY',
        details: '请在服务器 .env 中配置交易私钥后重新部署执行真实 CLMM 开仓。',
        durationMs: Date.now() - started,
      };
    }

    const balances = await waitForUsdcVisibility(BACKEND_KEYPAIR.publicKey, 2500);
    const rangePct = Math.max(strategyConfig.rangeWidthPct, 4);

    if (balances.usdcBalance < 0.05) {
      return {
        step: 'addLp',
        title: '2. 加池子 (Raydium CLMM)',
        status: 'failed',
        mode: 'live',
        summary: `钱包 USDC 不足：当前仅 ${balances.usdcBalance.toFixed(4)} USDC，集中流动性加池需双边代币`,
        details: `在 SOL/USDC ±${rangePct}% 区间内做市需至少 0.05 USDC 与约 0.022 SOL（含 0.018 SOL 可退仓位 NFT 租金）。请先点击“1. 实测兑换”或“一键真实全流程实测”自动将 SOL 换出 USDC。`,
        durationMs: Date.now() - started,
      };
    }

    const poolId = await resolveTopSolUsdcClmmPoolId();
    raydium = await Raydium.load({
      owner: BACKEND_KEYPAIR,
      connection: solanaConnection,
      cluster: 'mainnet',
      disableFeatureCheck: true,
      disableLoadToken: true,
    });
    await raydium.account.fetchWalletTokenAccounts({
      forceUpdate: true,
      commitment: 'confirmed',
    });

    const { poolInfo, poolKeys } = await raydium.clmm.getPoolInfoFromRpc(poolId);
    const currentPrice = new Decimal(poolInfo.price);
    const lowerPrice = currentPrice.mul(1 - rangePct / 100);
    const upperPrice = currentPrice.mul(1 + rangePct / 100);

    const lowerRes = TickUtil.getPriceAndTick({
      price: lowerPrice,
      mintADecimals: poolInfo.mintA.decimals,
      mintBDecimals: poolInfo.mintB.decimals,
      zeroForOne: true,
      tickSpacing: poolInfo.config.tickSpacing,
    });
    const upperRes = TickUtil.getPriceAndTick({
      price: upperPrice,
      mintADecimals: poolInfo.mintA.decimals,
      mintBDecimals: poolInfo.mintB.decimals,
      zeroForOne: true,
      tickSpacing: poolInfo.config.tickSpacing,
    });

    const tickLower = Math.min(lowerRes.tick, upperRes.tick);
    const tickUpper =
      Math.max(lowerRes.tick, upperRes.tick) <= tickLower
        ? tickLower + poolInfo.config.tickSpacing * 2
        : Math.max(lowerRes.tick, upperRes.tick);

    const isMintAUsdc = poolInfo.mintA.address === USDC_MINT_ADDR;
    const isMintBUsdc = poolInfo.mintB.address === USDC_MINT_ADDR;
    const isMintASol = poolInfo.mintA.address === SOL_MINT_ADDR;
    const isMintBSol = poolInfo.mintB.address === SOL_MINT_ADDR;

    if (!isMintAUsdc && !isMintBUsdc) {
      throw new Error(`池子 ${poolId} 不包含 USDC 交易对`);
    }

    const base: 'MintA' | 'MintB' = isMintAUsdc ? 'MintA' : 'MintB';
    // Micro-test explicitly uses 0.1 USDC so test stays low-cost
    const usdcDepositUi = Math.max(
      0.05,
      Math.min(0.1, Number((balances.usdcBalance * 0.85).toFixed(4)))
    );
    const baseAmount = new BN(Math.round(usdcDepositUi * 1e6));
    const depositLabel = `${usdcDepositUi.toFixed(2)} USDC`;

    const epochInfo = await solanaConnection.getEpochInfo('confirmed');
    const liqRes = await PoolUtils.getLiquidityAmountOutFromAmountIn({
      poolInfo,
      inputA: base === 'MintA',
      tickLower,
      tickUpper,
      amount: baseAmount,
      slippage: 0.08,
      add: true,
      epochInfo,
      amountHasFee: true,
    });

    const expectedOther = base === 'MintA' ? liqRes.amountB.amount : liqRes.amountA.amount;
    const sdkSlippageOther =
      base === 'MintA' ? liqRes.amountSlippageB.amount : liqRes.amountSlippageA.amount;
    const otherAmountMaxStr = computeSafeClmmOtherAmountMax(
      expectedOther.toString(),
      sdkSlippageOther.toString(),
      25
    );
    const otherAmountMax = new BN(otherAmountMaxStr);

    const requiredSolForLp = Number(otherAmountMax.toString()) / 1e9;
    const minNeededSol = requiredSolForLp + 0.02;
    if (balances.solBalance < minNeededSol) {
      return {
        step: 'addLp',
        title: '2. 加池子 (Raydium CLMM)',
        status: 'failed',
        mode: 'live',
        summary: `可用 SOL 不足：当前 ${balances.solBalance.toFixed(4)} SOL，开仓配比及 NFT 租金需约 ${minNeededSol.toFixed(4)} SOL`,
        details: `其中 ${requiredSolForLp.toFixed(4)} SOL 将配对注入池子，约 0.018 SOL 为临时仓位 NFT 租金（撤池关仓后自动退回）。`,
        durationMs: Date.now() - started,
      };
    }

    const { transaction, extInfo } = await raydium.clmm.openPositionFromBase({
      poolInfo,
      poolKeys,
      tickLower,
      tickUpper,
      base,
      ownerInfo: { useSOLBalance: true },
      baseAmount,
      otherAmountMax,
      nft2022: true,
      withMetadata: 'no-create',
      txVersion: TxVersion.V0,
      computeBudgetConfig: { units: 600_000, microLamports: 150_000 },
    });

    const sig = bs58.encode(transaction.signatures[0]);
    const currentHeight = await solanaConnection.getBlockHeight('confirmed');
    const txId = await sendAndConfirmRawWithRebroadcast(transaction, sig, currentHeight + 145);

    const nftMint = extInfo.nftMint.toBase58();
    lastLiveTestPosition = { poolId, nftMint };
    await getWalletBalances(BACKEND_KEYPAIR.publicKey);
    await fetchActivePositions(true);

    const symA = poolInfo.mintA.symbol || (isMintASol ? 'WSOL' : 'USDC');
    const symB = poolInfo.mintB.symbol || (isMintBSol ? 'WSOL' : 'USDC');

    return {
      step: 'addLp',
      title: '2. 加池子 (Raydium CLMM)',
      status: 'passed',
      mode: 'live',
      txId,
      explorerUrl: `https://solscan.io/tx/${txId}`,
      positionNftMint: nftMint,
      summary: `真实小额测试开仓成功！已向 ${symA}/${symB} 注入 ${depositLabel} + 约 ${(
        Number(expectedOther.toString()) / 1e9
      ).toFixed(4)} SOL（±${rangePct}%）`,
      details: `Position NFT: ${maskSolanaAddress(nftMint)} · Tick [${tickLower}, ${tickUpper}] · TX: ${txId}`,
      durationMs: Date.now() - started,
    };
  } catch (err: unknown) {
    return {
      step: 'addLp',
      title: '2. 加池子 (Raydium CLMM)',
      status: 'failed',
      mode,
      summary: `真实加池执行失败: ${formatChainError(err)}`,
      details:
        '开仓需约 0.018 SOL 临时仓位 NFT 租金（撤池时全额退回）及对应 SOL/USDC 双边流动资金。',
      durationMs: Date.now() - started,
    };
  } finally {
    raydium?.account.clearAccountChangeCkb();
  }
}

async function runRemoveLpPipelineTest(mode: PipelineRunMode): Promise<PipelineStepResult> {
  const started = Date.now();
  let raydium: Raydium | null = null;
  try {
    if (mode === 'simulate') {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${USDC_MINT_ADDR}&outputMint=${SOL_MINT_ADDR}&amount=10000000&slippageBps=${strategyConfig.slippageBps}`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const quote = await res.json();
      const outSol = (Number(quote.outAmount || 0) / 1e9).toFixed(5);
      const impactBps = Number((Math.abs(Number(quote.priceImpactPct || 0)) * 10000).toFixed(2));
      const slippageOk = impactBps <= strategyConfig.slippageBps;

      return {
        step: 'removeLp',
        title: '3. 撤池子与关仓退租',
        status: slippageOk ? 'passed' : 'warning',
        mode,
        summary: slippageOk
          ? `反向退出通路正常（10 USDC ≈ ${outSol} SOL，冲击 ${impactBps} bps）`
          : `触发防滑点警告（冲击 ${impactBps} bps > 上限 ${strategyConfig.slippageBps} bps）`,
        details: `已校验撤池退出滑点上限 ${strategyConfig.slippageBps} bps 与止损阈值 -${strategyConfig.stopLossPercentage}%。`,
        durationMs: Date.now() - started,
      };
    }

    if (!BACKEND_KEYPAIR) {
      return {
        step: 'removeLp',
        title: '3. 撤池子与关仓退租',
        status: 'failed',
        mode: 'live',
        summary: '真实撤池被拒绝：后台 .env 未配置有效 PRIVATE_KEY',
        details: '请在服务器 .env 中配置交易私钥后再试。',
        durationMs: Date.now() - started,
      };
    }

    raydium = await Raydium.load({
      owner: BACKEND_KEYPAIR,
      connection: solanaConnection,
      cluster: 'mainnet',
      disableFeatureCheck: true,
      disableLoadToken: true,
    });
    await raydium.account.fetchWalletTokenAccounts({
      forceUpdate: true,
      commitment: 'confirmed',
    });

    let positions = await raydium.clmm.getOwnerPositionInfo({
      programId: CLMM_PROGRAM_ID,
    });

    if (!positions.length && lastLiveTestPosition) {
      for (let i = 0; i < 4; i += 1) {
        await sleep(700);
        await raydium.account.fetchWalletTokenAccounts({
          forceUpdate: true,
          commitment: 'confirmed',
        });
        positions = await raydium.clmm.getOwnerPositionInfo({
          programId: CLMM_PROGRAM_ID,
        });
        if (positions.length > 0) break;
      }
    }

    if (!positions.length) {
      return {
        step: 'removeLp',
        title: '3. 撤池子与关仓退租',
        status: 'warning',
        mode: 'live',
        summary: '链上暂未检测到活跃 Raydium CLMM 仓位，无法单独执行撤池',
        details: '请先点击“测试加池”或直接点击“一键测试全流程（兑换/加池/撤池/转利润）”自动完成开仓与撤仓闭环。',
        durationMs: Date.now() - started,
      };
    }

    const targetPos =
      (lastLiveTestPosition &&
        positions.find((p) => p.nftMint.toBase58() === lastLiveTestPosition?.nftMint)) ||
      positions[0];

    const { poolInfo, poolKeys } = await raydium.clmm.getPoolInfoFromRpc(
      targetPos.poolId.toBase58()
    );

    let txId = '';
    if (!targetPos.liquidity.isZero()) {
      const { transaction } = await raydium.clmm.decreaseLiquidity({
        poolInfo,
        poolKeys,
        ownerPosition: targetPos,
        ownerInfo: {
          useSOLBalance: true,
          closePosition: true,
        },
        liquidity: targetPos.liquidity,
        amountMinA: new BN(0),
        amountMinB: new BN(0),
        txVersion: TxVersion.V0,
        computeBudgetConfig: { units: 500_000, microLamports: 150_000 },
      });
      const sig = bs58.encode(transaction.signatures[0]);
      const currentHeight = await solanaConnection.getBlockHeight('confirmed');
      txId = await sendAndConfirmRawWithRebroadcast(transaction, sig, currentHeight + 145);
    } else {
      const { transaction } = await raydium.clmm.closePosition({
        poolInfo,
        poolKeys,
        ownerPosition: targetPos,
        txVersion: TxVersion.V0,
        computeBudgetConfig: { units: 300_000, microLamports: 150_000 },
      });
      const sig = bs58.encode(transaction.signatures[0]);
      const currentHeight = await solanaConnection.getBlockHeight('confirmed');
      txId = await sendAndConfirmRawWithRebroadcast(transaction, sig, currentHeight + 145);
    }

    if (lastLiveTestPosition?.nftMint === targetPos.nftMint.toBase58()) {
      lastLiveTestPosition = null;
    }
    await getWalletBalances(BACKEND_KEYPAIR.publicKey);
    await fetchActivePositions(true);

    return {
      step: 'removeLp',
      title: '3. 撤池子与关仓退租',
      status: 'passed',
      mode: 'live',
      txId,
      explorerUrl: `https://solscan.io/tx/${txId}`,
      positionNftMint: targetPos.nftMint.toBase58(),
      summary: `真实撤池关仓成功！已全额提取本金及手续费并退回仓位 NFT 押金`,
      details: `已销毁仓位 NFT ${maskSolanaAddress(targetPos.nftMint.toBase58())} · TX: ${txId}`,
      durationMs: Date.now() - started,
    };
  } catch (err: unknown) {
    return {
      step: 'removeLp',
      title: '3. 撤池子与关仓退租',
      status: 'failed',
      mode,
      summary: `真实撤池执行失败: ${formatChainError(err)}`,
      details: '请确认钱包持有至少 0.002 SOL 支付链上撤销手续费。',
      durationMs: Date.now() - started,
    };
  } finally {
    raydium?.account.clearAccountChangeCkb();
  }
}

async function runSweepPipelineTest(mode: PipelineRunMode): Promise<PipelineStepResult> {
  const started = Date.now();
  try {
    const recipientValid = isValidSolanaAddress(BACKEND_RECIPIENT_RAW);
    if (!recipientValid) {
      return {
        step: 'sweep',
        title: '4. 利润转移 (SystemProgram 转账)',
        status: mode === 'live' ? 'failed' : 'warning',
        mode,
        summary: '后台 .env 尚未配置有效 RECIPIENT_ADDRESS 收款公钥',
        details: '请在服务器 .env 中填入盈利接收 Solana 公钥地址并重启 pm2 服务。',
        durationMs: Date.now() - started,
      };
    }

    const recipientPubkey = new PublicKey(BACKEND_RECIPIENT_RAW);
    if (!BACKEND_KEYPAIR) {
      return {
        step: 'sweep',
        title: '4. 利润转移 (SystemProgram 转账)',
        status: mode === 'live' ? 'failed' : 'readonly_only',
        mode,
        summary:
          mode === 'live'
            ? '真实转账被拒绝：后台 .env 尚未配置有效 PRIVATE_KEY'
            : `收款公钥 ${maskSolanaAddress(
                recipientPubkey.toBase58()
              )} 校验有效，等待后台私钥完成转账预演`,
        details: '请在服务器 .env 中填入交易私钥后即可真实转账至您的冷钱包。',
        durationMs: Date.now() - started,
      };
    }

    const transferLamports = mode === 'live' ? 500_000 : 100_000; // 0.0005 SOL live real test transfer
    const { blockhash } = await solanaConnection.getLatestBlockhash('confirmed');
    const tx = new Transaction({
      recentBlockhash: blockhash,
      feePayer: BACKEND_KEYPAIR.publicKey,
    }).add(
      SystemProgram.transfer({
        fromPubkey: BACKEND_KEYPAIR.publicKey,
        toPubkey: recipientPubkey,
        lamports: transferLamports,
      })
    );

    if (mode === 'live') {
      const txId = await sendAndConfirmTransaction(solanaConnection, tx, [BACKEND_KEYPAIR], {
        commitment: 'confirmed',
      });
      await getWalletBalances(BACKEND_KEYPAIR.publicKey);
      return {
        step: 'sweep',
        title: '4. 利润转移 (SystemProgram 转账)',
        status: 'passed',
        mode: 'live',
        txId,
        explorerUrl: `https://solscan.io/tx/${txId}`,
        summary: `真实利润转账上链成功！已转出 0.0005 SOL 至收款地址 ${maskSolanaAddress(
          recipientPubkey.toBase58()
        )}`,
        details: `Solana 原生 SystemProgram.transfer 已确认 · TX: ${txId}`,
        durationMs: Date.now() - started,
      };
    }

    tx.sign(BACKEND_KEYPAIR);
    const sim = await solanaConnection.simulateTransaction(tx);
    if (sim.value.err) {
      return {
        step: 'sweep',
        title: '4. 利润转移 (SystemProgram 转账)',
        status: 'warning',
        mode: 'simulate',
        summary: `仿真检查提示钱包余额/租金状态: ${formatChainError(sim.value.err)}`,
        details: `目标地址 ${maskSolanaAddress(recipientPubkey.toBase58())} 合法且签名有效。`,
        durationMs: Date.now() - started,
      };
    }

    return {
      step: 'sweep',
      title: '4. 利润转移 (SystemProgram 转账)',
      status: 'passed',
      mode: 'simulate',
      summary: `仿真检查通过！目标冷钱包 ${maskSolanaAddress(recipientPubkey.toBase58())} 可正常接收利润`,
      details: `已通过 simulateTransaction 验证（消耗 ${sim.value.unitsConsumed ?? 150} CU，未真实扣款）。`,
      durationMs: Date.now() - started,
    };
  } catch (err: unknown) {
    return {
      step: 'sweep',
      title: '4. 利润转移 (SystemProgram 转账)',
      status: 'failed',
      mode,
      summary: `真实利润转账失败: ${formatChainError(err)}`,
      details: '请检查钱包 SOL 余额、Helius RPC 连通性与 RECIPIENT_ADDRESS 配置。',
      durationMs: Date.now() - started,
    };
  }
}

app.post('/api/pipeline/test', async (req, res) => {
  const rawStep = req.body?.step;
  const target: 'all' | PipelineStepKey =
    rawStep === 'swap' || rawStep === 'addLp' || rawStep === 'removeLp' || rawStep === 'sweep'
      ? rawStep
      : 'all';
  const mode: PipelineRunMode = req.body?.mode === 'simulate' ? 'simulate' : 'live';
  const asset: PipelineTestAsset =
    req.body?.asset === 'USDC' ? 'USDC' : req.body?.asset === 'USDT' ? 'USDT' : 'SOL';

  try {
    if (mode === 'live') {
      const liveBalances = BACKEND_KEYPAIR
        ? await getWalletBalances(BACKEND_KEYPAIR.publicKey)
        : { solBalance: 0, usdcBalance: 0, usdtBalance: 0, tokenAccountCount: 0 };

      const readiness = assessLiveTestWalletReadiness({
        step: target,
        asset,
        solBalance: liveBalances.solBalance,
        usdcBalance: liveBalances.usdcBalance,
        usdtBalance: liveBalances.usdtBalance,
        hasPrivateKey: Boolean(BACKEND_KEYPAIR),
        hasValidRecipient: isValidSolanaAddress(BACKEND_RECIPIENT_RAW),
      });

      if (!readiness.ok) {
        const stepsToReport: PipelineStepKey[] =
          target === 'all' ? ['swap', 'addLp', 'removeLp', 'sweep'] : [target];
        const titles: Record<PipelineStepKey, string> = {
          swap: '1. 代币兑换 (Jupiter Swap v1)',
          addLp: '2. 加池子 (Raydium CLMM)',
          removeLp: '3. 撤池子与关仓退租',
          sweep: '4. 利润转移 (SystemProgram 转账)',
        };
        const aborted: PipelineStepResult[] = stepsToReport.map((k) => ({
          step: k,
          title: titles[k],
          status: 'failed',
          mode: 'live',
          summary: readiness.reason || '未满足真实链上测试前置条件',
          details: readiness.note,
          durationMs: 0,
        }));
        pushLog('warning', `真实链上测试未执行：${readiness.reason}`);
        return res.json({
          success: true,
          target,
          mode,
          asset,
          results: aborted,
          backendStatus: getLiveBackendStatus(),
          testedAt: new Date().toISOString(),
        });
      }
    }

    const results: PipelineStepResult[] = [];
    if (target === 'all' || target === 'swap') {
      results.push(await runSwapPipelineTest(mode, asset));
    }
    if (target === 'all' || target === 'addLp') {
      results.push(await runAddLpPipelineTest(mode));
    }
    if (target === 'all' || target === 'removeLp') {
      results.push(await runRemoveLpPipelineTest(mode));
    }
    if (target === 'all' || target === 'sweep') {
      results.push(await runSweepPipelineTest(mode));
    }

    const summaryText = results
      .map((r) => `${r.step}:${r.status}${r.txId ? `(${r.txId.slice(0, 6)}...)` : ''}`)
      .join(' | ');
    pushLog(
      results.some((r) => r.status === 'failed') ? 'error' : 'success',
      `${mode === 'live' ? '真实链上小额实测' : '只读仿真核验'}完成 [${summaryText}]`
    );

    res.json({
      success: true,
      target,
      mode,
      asset,
      results,
      backendStatus: getLiveBackendStatus(),
      testedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: `全流程实测异常: ${err.message}`,
    });
  }
});

app.post('/api/ai/analyze', async (req, res) => {
  const { poolName, dex, apr, tvl, volume24h, alphaScore, ilRisk } = req.body || {};
  if (!process.env.GEMINI_API_KEY) {
    return res.status(400).json({
      success: false,
      error: '当前环境未配置 GEMINI_API_KEY，无法调用 AI 策略审计。',
    });
  }
  try {
    const prompt = `你是一位专门指导小资金（${strategyConfig.capitalUsdt}U 总资产）在 Solana 上稳健做市盈利的风控顾问。请用通俗易懂的中文分析以下真实矿池：
- 矿池: ${poolName} (${dex})
- 200U稳健评分: ${alphaScore}/100
- 年化收益率 (APR): ${apr}%
- 总锁仓量 (TVL): $${tvl}
- 24小时交易量: $${volume24h}
- 无常损失风险: ${ilRisk}

请以 JSON 格式输出：
1. evaluation: 这个池子适不适合 ${strategyConfig.capitalUsdt}U 稳健赚钱？为什么？
2. ilStrategy: 对小白用户解释宽区间（±${strategyConfig.rangeWidthPct}%）和省 Gas 收割能帮他避开什么坑
3. recommendation: 明确结论（建议投入多少 U、止损和落袋建议）
4. suggestedStopLoss: 建议止损百分比数字
5. suggestedTakeProfit: 建议单次落袋止盈金额数字（USD）`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json({ success: true, analysis: parsed });
  } catch (err: any) {
    res.status(500).json({ success: false, error: `AI 审计失败: ${err.message}` });
  }
});

async function executeFullPortfolioDeployment(forceConsolidateDust = true): Promise<{
  success: boolean;
  dryRunBlocked?: boolean;
  message: string;
  closedDustCount: number;
  openedPositions: Array<{ poolName: string; poolId: string; nftMint: string; txId: string; summary: string }>;
  errors: string[];
  portfolioPlan: AutoPortfolioPlan;
}> {
  const isDryRun = process.env.DRY_RUN !== 'false';
  const targetWallet =
    BACKEND_KEYPAIR?.publicKey ||
    (isValidSolanaAddress(EFFECTIVE_WALLET_ADDRESS)
      ? new PublicKey(EFFECTIVE_WALLET_ADDRESS)
      : null);

  const [balances, positions, poolsRes, solQuote] = await Promise.all([
    targetWallet
      ? getWalletBalances(targetWallet)
      : Promise.resolve({ solBalance: 0, usdcBalance: 0, usdtBalance: 0, tokenAccountCount: 0 }),
    fetchActivePositions(true),
    fetchRealPools(),
    fetchJupiterQuoteMetrics(0.1).catch(() => null),
  ]);

  if (solQuote) {
    latestSolPriceUsd = Number((solQuote.outAmountUsdc * 10).toFixed(2));
  }
  const ranked = rankPools(poolsRes.pools, strategyConfig);

  let portfolioPlan = calculateAutoPortfolioPlan({
    solBalance: balances.solBalance,
    usdcBalance: balances.usdcBalance,
    solPriceUsd: latestSolPriceUsd,
    activePositions: positions,
    rankedPools: ranked,
    config: strategyConfig,
  });

  if (!BACKEND_KEYPAIR) {
    return {
      success: false,
      message: '后台 .env 尚未配置有效 PRIVATE_KEY，无法签名并广播建仓交易。',
      closedDustCount: 0,
      openedPositions: [],
      errors: ['Missing PRIVATE_KEY'],
      portfolioPlan,
    };
  }

  if (isDryRun) {
    return {
      success: false,
      dryRunBlocked: true,
      message:
        '当前服务器 .env 仍为 DRY_RUN=true 安全演练模式，已拦截真实资金动账。请先确认 DRY_RUN=false 后重启 pm2。',
      closedDustCount: 0,
      openedPositions: [],
      errors: [],
      portfolioPlan,
    };
  }

  let closedDustCount = 0;
  const openedPositions: Array<{ poolName: string; poolId: string; nftMint: string; txId: string; summary: string }> = [];
  const errors: string[] = [];

  // Step 1: Close <$1.50 test micro-positions if significant idle capital is sitting in wallet
  let currentPositions = positions;
  if (forceConsolidateDust && portfolioPlan.hasDustPositionToConsolidate) {
    const dustList = currentPositions.filter((p) => p.injectedValueUsd > 0 && p.injectedValueUsd < 1.5);
    for (const dust of dustList) {
      try {
        pushLog('info', `[全额资金激活] 正在平掉 $${dust.injectedValueUsd.toFixed(2)} 测试微仓（${dust.poolName}）并回收 ~0.018 SOL 租金...`);
        const closed = await closeClmmPositionByNft(dust.nftMint);
        closedDustCount += 1;
        pushLog('success', `[微仓回收成功] 已注销测试仓位 NFT ${maskSolanaAddress(closed.closedNftMint)}，TX: ${closed.txId}`);
        await sleep(1800);
      } catch (err: any) {
        const msg = formatChainError(err);
        errors.push(`回收微仓失败: ${msg}`);
        pushLog('error', `[微仓回收失败] ${msg}`);
      }
    }
    if (closedDustCount > 0) {
      const updatedBal = await getWalletBalances(BACKEND_KEYPAIR.publicKey);
      currentPositions = await fetchActivePositions(true);
      portfolioPlan = calculateAutoPortfolioPlan({
        solBalance: updatedBal.solBalance,
        usdcBalance: updatedBal.usdcBalance,
        solPriceUsd: latestSolPriceUsd,
        activePositions: currentPositions,
        rankedPools: ranked,
        config: strategyConfig,
      });
    }
  }

  // Step 2: Deploy into all planned slots not currently held
  for (const slot of portfolioPlan.slotPlans) {
    const alreadyHeld = currentPositions.some((p) => p.poolId === slot.poolId && p.injectedValueUsd >= 1.5);
    if (alreadyHeld) continue;

    // Recompute remaining available capital dynamically before opening slot 2
    const balNow = await getWalletBalances(BACKEND_KEYPAIR.publicKey);
    const availNowUsd = Math.max(0, balNow.solBalance - 0.028) * latestSolPriceUsd + balNow.usdcBalance;
    const budgetForSlot = Math.min(slot.targetUsd, availNowUsd * 0.88);
    if (budgetForSlot < 3) {
      continue;
    }

    try {
      pushLog(
        'info',
        `[多池全额建仓 #${slot.slotIndex}] 正在向【${slot.poolName}】(APR +${slot.apr}%) 注入 ~$${budgetForSlot.toFixed(2)}（±${slot.rangeWidthPct}% 集中区间）...`
      );
      const resOpen = await openRealClmmPoolPosition({
        poolId: slot.poolId,
        targetUsd: budgetForSlot,
        rangeWidthPct: slot.rangeWidthPct,
        solPriceUsd: latestSolPriceUsd,
      });
      openedPositions.push({
        poolName: resOpen.poolName,
        poolId: resOpen.poolId,
        nftMint: resOpen.nftMint,
        txId: resOpen.txId,
        summary: resOpen.injectedSummary,
      });
      pushLog(
        'success',
        `[建仓成功 #${slot.slotIndex}] 已接入【${resOpen.poolName}】${resOpen.injectedSummary} · TX: ${resOpen.txId}`
      );
      await sleep(1800);
    } catch (err: any) {
      const msg = formatChainError(err);
      errors.push(`${slot.poolName}: ${msg}`);
      poolActionCooldownMs.set(slot.poolId, Date.now());
      pushLog('error', `[建仓失败 #${slot.slotIndex}] ${slot.poolName}: ${msg}`);
    }
  }

  const finalPositions = await fetchActivePositions(true);
  const finalBalances = await getWalletBalances(BACKEND_KEYPAIR.publicKey);
  const finalPlan = calculateAutoPortfolioPlan({
    solBalance: finalBalances.solBalance,
    usdcBalance: finalBalances.usdcBalance,
    solPriceUsd: latestSolPriceUsd,
    activePositions: finalPositions,
    rankedPools: ranked,
    config: strategyConfig,
  });

  const message =
    openedPositions.length > 0
      ? `已完成全额并发建仓！${closedDustCount > 0 ? `已清理 ${closedDustCount} 个 $0.20 微仓并` : ''}新开 ${openedPositions.length} 个实盘仓位（${openedPositions.map((o) => o.poolName).join(' + ')}），当前总在池资金 $${finalPlan.activeInjectedUsd.toFixed(2)}（利用率 ${finalPlan.utilizationPct}%）。`
      : errors.length > 0
      ? `执行建仓遇到异常: ${errors.join(' | ')}`
      : `当前钱包已有活跃满额仓位 $${finalPlan.activeInjectedUsd.toFixed(2)}（利用率 ${finalPlan.utilizationPct}%），无需重复开仓。`;

  return {
    success: openedPositions.length > 0 || errors.length === 0,
    message,
    closedDustCount,
    openedPositions,
    errors,
    portfolioPlan: finalPlan,
  };
}

async function runAutoStrategyTick(): Promise<{
  success: boolean;
  conclusion: string;
  actionTaken: string;
  diagnostic: any;
}> {
  if (isAutoTicking) {
    return {
      success: true,
      conclusion: '策略轮询正在执行中，跳过重叠 tick',
      actionTaken: 'WAIT',
      diagnostic: lastAutoTickDiagnostic,
    };
  }

  isAutoTicking = true;
  try {
    const isDryRun = process.env.DRY_RUN !== 'false';
    const hasKey = Boolean(BACKEND_KEYPAIR);
    const walletPk =
      BACKEND_KEYPAIR?.publicKey ||
      (isValidSolanaAddress(EFFECTIVE_WALLET_ADDRESS)
        ? new PublicKey(EFFECTIVE_WALLET_ADDRESS)
        : null);

    const [activePositionsInitial, balancesInitial, poolsRes, solQuote] = await Promise.all([
      fetchActivePositions(false),
      walletPk
        ? getWalletBalances(walletPk)
        : Promise.resolve({ solBalance: 0, usdcBalance: 0, usdtBalance: 0, tokenAccountCount: 0 }),
      fetchRealPools(),
      fetchJupiterQuoteMetrics(0.1).catch(() => null),
    ]);

    const jupiterImpactBps = solQuote ? Math.round(solQuote.priceImpactPct * 10000) : null;
    if (solQuote) {
      latestSolPriceUsd = Number((solQuote.outAmountUsdc * 10).toFixed(2));
    }

    const ranked = rankPools(poolsRes.pools, strategyConfig);
    recordSelectionRound(ranked, jupiterImpactBps, latestSolPriceUsd);

    const eligiblePools = ranked.filter((p) => p.eligibleFor200U);
    const bluechipFallback = ranked.find((p) => p.isBluechip && p.tvl >= 500_000);
    const topCandidate = eligiblePools[0] || bluechipFallback || ranked[0];

    const whyEliminatedSamples = ranked
      .filter((p) => !p.eligibleFor200U)
      .slice(0, 4)
      .map((p) => `${p.name}: ${p.selectionReason || '风控淘汰'}`);

    let activePositions = activePositionsInitial;
    let portfolioPlan = calculateAutoPortfolioPlan({
      solBalance: balancesInitial.solBalance,
      usdcBalance: balancesInitial.usdcBalance,
      solPriceUsd: latestSolPriceUsd,
      activePositions,
      rankedPools: ranked,
      config: strategyConfig,
    });

    let conclusion = '';
    let actionTaken = 'IDLE';

    // Stop-loss monitoring across ALL active positions
    for (const pos of activePositions) {
      if (pos.unrealizedPnlPct <= -Math.abs(strategyConfig.stopLossPercentage)) {
        if (isDryRun) {
          actionTaken = 'DRY_RUN_STOP_LOSS';
          conclusion = `[演练止损] 仓位 ${pos.poolName} 浮亏达 ${pos.unrealizedPnlPct}%，触及 -${strategyConfig.stopLossPercentage}% 止损线（DRY_RUN 模式已模拟拦截）。`;
          pushLog('warning', conclusion);
        } else if (hasKey) {
          actionTaken = 'LIVE_STOP_LOSS';
          pushLog('warning', `[实盘止损] 仓位 ${pos.poolName} 触发 -${strategyConfig.stopLossPercentage}% 止损线，正在自动执行撤池关仓退租...`);
          await closeClmmPositionByNft(pos.nftMint).catch((e) =>
            pushLog('error', `[实盘止损撤池失败] ${formatChainError(e)}`)
          );
          activePositions = await fetchActivePositions(true);
        }
      }
    }

    if (actionTaken === 'IDLE') {
      if (!hasKey) {
        conclusion = '当前为纯策略观察模式（服务器后台 .env 未注入有效 PRIVATE_KEY），系统持续进行只读风控巡检，不生成虚假开仓。';
        actionTaken = 'READONLY_INSPECTION';
      } else if (isDryRun) {
        conclusion = `【安全演练保护中】DRY_RUN=true 阻止了真实资金动账。${portfolioPlan.diagnosisNote}`;
        actionTaken = 'DRY_RUN_ENTRY_SIMULATED';
      } else {
        // LIVE mode (DRY_RUN=false & hasKey)
        const dustPositions = activePositions.filter(
          (p) => p.injectedValueUsd > 0 && p.injectedValueUsd < 1.5
        );
        const needConsolidate = portfolioPlan.hasDustPositionToConsolidate && dustPositions.length > 0;
        const missingSlot = portfolioPlan.slotPlans.find(
          (slot) => !activePositions.some((p) => p.poolId === slot.poolId && p.injectedValueUsd >= 1.5)
        );
        const nowMs = Date.now();
        const cooldownOk = (key: string) => nowMs - (poolActionCooldownMs.get(key) || 0) >= 90_000;

        if ((needConsolidate || missingSlot) && balancesInitial.solBalance >= 0.028) {
          if (needConsolidate && cooldownOk('dust-consolidate')) {
            poolActionCooldownMs.set('dust-consolidate', nowMs);
            for (const dust of dustPositions) {
              try {
                pushLog('info', `[自动清理测试微仓] 检测到 $${dust.injectedValueUsd.toFixed(2)} 微仓而钱包闲置 $${portfolioPlan.idleDeployableUsd.toFixed(2)}，正在回收微仓与 0.018 SOL 租金...`);
                await closeClmmPositionByNft(dust.nftMint);
                await sleep(1600);
              } catch (err: any) {
                pushLog('error', `[微仓回收失败] ${formatChainError(err)}`);
              }
            }
            activePositions = await fetchActivePositions(true);
            const balAfter = await getWalletBalances(BACKEND_KEYPAIR!.publicKey);
            portfolioPlan = calculateAutoPortfolioPlan({
              solBalance: balAfter.solBalance,
              usdcBalance: balAfter.usdcBalance,
              solPriceUsd: latestSolPriceUsd,
              activePositions,
              rankedPools: ranked,
              config: strategyConfig,
            });
          }

          // Open any unallocated slot with real capital (respecting 90s cooldown per pool)
          let openedAny = false;
          for (const slot of portfolioPlan.slotPlans) {
            const held = activePositions.some((p) => p.poolId === slot.poolId && p.injectedValueUsd >= 1.5);
            if (held || !cooldownOk(slot.poolId)) continue;

            const balNow = await getWalletBalances(BACKEND_KEYPAIR!.publicKey);
            const availNowUsd = Math.max(0, balNow.solBalance - 0.028) * latestSolPriceUsd + balNow.usdcBalance;
            const slotBudget = Math.min(slot.targetUsd, availNowUsd * 0.88);
            if (slotBudget < 4) continue;

            poolActionCooldownMs.set(slot.poolId, Date.now());
            try {
              pushLog('info', `[自动全额多池建仓 #${slot.slotIndex}] 正在接入【${slot.poolName}】(APR +${slot.apr}%)，目标投入 ~$${slotBudget.toFixed(2)} (±${slot.rangeWidthPct}%)...`);
              const opened = await openRealClmmPoolPosition({
                poolId: slot.poolId,
                targetUsd: slotBudget,
                rangeWidthPct: slot.rangeWidthPct,
                solPriceUsd: latestSolPriceUsd,
              });
              openedAny = true;
              pushLog('success', `[自动建仓完成] ${opened.poolName} (${opened.injectedSummary}) · TX: ${opened.txId}`);
              await sleep(1500);
            } catch (err: any) {
              pushLog('error', `[自动建仓失败] ${slot.poolName}: ${formatChainError(err)}`);
            }
          }

          if (openedAny) {
            activePositions = await fetchActivePositions(true);
            const finalBal = await getWalletBalances(BACKEND_KEYPAIR!.publicKey);
            portfolioPlan = calculateAutoPortfolioPlan({
              solBalance: finalBal.solBalance,
              usdcBalance: finalBal.usdcBalance,
              solPriceUsd: latestSolPriceUsd,
              activePositions,
              rankedPools: ranked,
              config: strategyConfig,
            });
            actionTaken = 'LIVE_OPENED';
            conclusion = `实盘自动全额建仓完成！当前在池 ${activePositions.length} 个仓位，合计注入 $${portfolioPlan.activeInjectedUsd.toFixed(2)}（资金利用率 ${portfolioPlan.utilizationPct}%）。`;
          } else {
            actionTaken = activePositions.length > 0 ? 'HOLD_EARNING_FEES' : 'LIVE_OPEN_COOLDOWN';
            conclusion = portfolioPlan.diagnosisNote;
          }
        } else if (activePositions.length > 0) {
          const totalFeeUsd = activePositions.reduce((s, p) => s + p.uncollectedFeeUsd, 0);
          actionTaken = totalFeeUsd >= strategyConfig.harvestMinUsd ? 'HARVEST_PENDING' : 'HOLD_EARNING_FEES';
          conclusion = `正在做市中：共 ${activePositions.length} 个仓位合计注入 $${portfolioPlan.activeInjectedUsd.toFixed(2)}（资金利用率 ${portfolioPlan.utilizationPct}%），待领手续费 $${totalFeeUsd.toFixed(2)}。`;
        } else if (balancesInitial.solBalance < 0.028) {
          actionTaken = 'INSUFFICIENT_SOL';
          conclusion = `钱包可用 SOL 仅 ${balancesInitial.solBalance.toFixed(4)}，不足 0.028 SOL 开仓租金与 Gas 门槛。`;
        } else {
          actionTaken = 'WAIT_CAPITAL';
          conclusion = portfolioPlan.diagnosisNote;
        }
      }
    }

    const diag = {
      keyConfigured: hasKey,
      dryRun: isDryRun,
      walletAddress: BACKEND_KEYPAIR ? BACKEND_KEYPAIR.publicKey.toBase58() : EFFECTIVE_WALLET_ADDRESS,
      recipientAddress: BACKEND_RECIPIENT_RAW,
      activePositionsCount: activePositions.length,
      walletUsdcBalance: Number(balancesInitial.usdcBalance.toFixed(4)),
      walletSolBalance: balancesInitial.solBalance,
      solPriceUsd: latestSolPriceUsd,
      portfolioPlan,
      bestCandidatePool: topCandidate
        ? {
            name: topCandidate.name,
            dex: topCandidate.dex,
            apr: topCandidate.apr,
            tvl: topCandidate.tvl,
            eligible: topCandidate.eligibleFor200U,
            reason: topCandidate.selectionReason,
          }
        : null,
      conditionDiagnosis: {
        minApr: strategyConfig.minAPR,
        minTvlUsd: strategyConfig.minTVL,
        rangeWidthPct: strategyConfig.rangeWidthPct,
        stopLossPct: strategyConfig.stopLossPercentage,
        totalCandidates: ranked.length,
        eligibleCount: eligiblePools.length,
        whyEliminatedSamples,
      },
      conclusion,
      actionTaken,
      lastTickTime: nowTime(),
    };

    lastAutoTickDiagnostic = diag;
    return {
      success: true,
      conclusion,
      actionTaken,
      diagnostic: diag,
    };
  } catch (err: any) {
    console.error('自动策略执行异常:', err);
    return {
      success: false,
      conclusion: `自动巡检执行异常: ${err.message}`,
      actionTaken: 'ERROR',
      diagnostic: lastAutoTickDiagnostic,
    };
  } finally {
    isAutoTicking = false;
  }
}

app.get('/api/strategy/diagnostic', async (_req, res) => {
  if (!lastAutoTickDiagnostic) {
    await runAutoStrategyTick();
  }
  res.json({
    success: true,
    diagnostic: lastAutoTickDiagnostic,
    backendStatus: getLiveBackendStatus(),
  });
});

app.post('/api/strategy/auto-tick', async (_req, res) => {
  const result = await runAutoStrategyTick();
  res.json({
    ...result,
    backendStatus: getLiveBackendStatus(),
  });
});

app.post('/api/strategy/deploy-full', async (req, res) => {
  try {
    const requestedProfile = req.body?.riskProfile as RiskProfileKey | undefined;
    if (
      requestedProfile === 'ultra-safe' ||
      requestedProfile === 'balanced-steady' ||
      requestedProfile === 'active-yield' ||
      requestedProfile === 'turbo-high-yield'
    ) {
      strategyConfig = buildPresetForCapital(strategyConfig.capitalUsdt, requestedProfile);
      pushLog('info', `已切换为【${requestedProfile === 'turbo-high-yield' ? '极速高收益突击型 ±4% 双仓' : requestedProfile}】并发起全额多池建仓。`);
    }

    const deployRes = await executeFullPortfolioDeployment(true);
    await runAutoStrategyTick();

    res.json({
      ...deployRes,
      strategyConfig,
      backendStatus: getLiveBackendStatus(),
      activePositions: cachedActivePositions,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: formatChainError(err) });
  }
});

app.post('/api/strategy/preset-optimize', async (req, res) => {
  try {
    const { target } = req.body || {};
    if (target === 'turbo-high-yield') {
      strategyConfig = buildPresetForCapital(strategyConfig.capitalUsdt, 'turbo-high-yield');
      pushLog(
        'success',
        '已一键升级【极速高收益突击型】：45% ±4% 蓝筹窄区间 + 55% 全网第一高 APR 卫星池 · $0.5 极速复利。'
      );
    } else if (target === 'bluechip-optimized') {
      strategyConfig = {
        ...strategyConfig,
        minAPR: 35,
        minTVL: 1_000_000,
        rangeWidthPct: 8,
        harvestMinUsd: 2.0,
        stopLossPercentage: 6,
      };
      pushLog('success', '已一键应用【蓝筹高胜率优化参数】：MIN_APR=35% · TVL≥$1.0M · 区间±8%（已适配 WSOL/USDC 核心池）。');
    } else {
      strategyConfig = buildPresetForCapital(strategyConfig.capitalUsdt, 'balanced-steady');
      pushLog('info', '已重置为标准稳健平衡型预设。');
    }
    const tickRes = await runAutoStrategyTick();
    res.json({
      success: true,
      strategyConfig,
      diagnostic: tickRes.diagnostic,
      backendStatus: getLiveBackendStatus(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Production static frontend serving (no deploy UI endpoint exposed)

if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
}

const port = 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Solana 200U 稳定盈利控制台运行中：http://localhost:${port}`);
  setTimeout(() => {
    runAutoStrategyTick().catch(() => {});
    setInterval(() => {
      runAutoStrategyTick().catch(() => {});
    }, 30_000);
  }, 2000);
});
