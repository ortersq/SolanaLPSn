export interface SelectorWeights {
  aprWeight: number;
  volumeTvlRatioWeight: number;
  safetyWeight: number;
}

export interface PoolMetrics {
  id: string;
  name: string;
  dex: string;
  address: string;
  tvl: number;
  volume24h: number;
  apr: number;
  feeTier: string;
  priceUsd: string;
  priceChange24h?: number;
  safetyScore: number;
  ilRisk: '低' | '中' | '高';
  isBluechip?: boolean;
  url?: string;
}

export interface ScoredPool extends PoolMetrics {
  volTvlRatio: number;
  alphaScore: number;
  eligibleFor200U: boolean;
  poolRole: 'core' | 'satellite' | 'rejected';
  autoSelected: boolean;
  selectionReason: string;
}

export type RiskProfileKey =
  | 'ultra-safe'
  | 'balanced-steady'
  | 'active-yield'
  | 'turbo-high-yield';

export interface StrategyConfig {
  capitalUsdt: number;
  riskProfile: RiskProfileKey;
  gasReserveUsdt: number;
  lpActiveUsdt: number;
  coreSplitPct: number;
  autoCompound: boolean;
  minAPR: number;
  minTVL: number;
  rangeWidthPct: number;
  harvestMinUsd: number;
  stopLossPercentage: number;
  takeProfitSweepUsd: number;
  maxILTolerance: number;
  jitoTipLamports: number;
  slippageBps: number;
  autoWithdrawSafety: boolean;
  multiPositionParallel: boolean;
  smartCapitalAllocation: boolean;
  autoAssetRebalance: boolean;
  rebalanceDriftThresholdPct: number;
  multiCurrencyHedge: boolean;
  autoSelectorWeights: SelectorWeights;
}

export interface ApiKeyRequirement {
  module: string;
  purpose: string;
  needsExtraKey: boolean;
  keyStatus: string;
  notes: string;
}

export const API_KEY_REQUIREMENTS: ApiKeyRequirement[] = [
  {
    module: 'Helius RPC 节点',
    purpose: '读取链上余额、广播加池/撤池/换币交易、防丢单监控',
    needsExtraKey: true,
    keyStatus: '已配置在后台',
    notes: '使用您提供的 Helius API Key，仅在后端与新加坡服务器 .env 中使用。',
  },
  {
    module: 'Jupiter Swap v1 API',
    purpose: '自动兑换代币（如将 SOL 按 50:50 自动换为 USDC、止损时一键换回 USDC）',
    needsExtraKey: false,
    keyStatus: '无需额外 Key（公共免密接口）',
    notes: 'lite-api.jup.ag/swap/v1 免费免密调用，自动寻找最低滑点路由。',
  },
  {
    module: 'Raydium / Orca / Meteora 合约',
    purpose: '链上加池子、CLMM 集中区间做市、收割手续费、紧急撤池子',
    needsExtraKey: false,
    keyStatus: '无需额外 Key（纯链上交互）',
    notes: '通过 @solana/web3.js 直接与链上智能合约交互，依靠服务器本地私钥签名。',
  },
  {
    module: 'SystemProgram 原生转账',
    purpose: '盈利每累积满额时，自动将利润转回您后台设置的冷钱包接收地址',
    needsExtraKey: false,
    keyStatus: '无需额外 Key（Solana 原生指令）',
    notes: '收款地址与签名私钥均配置在服务器后台 .env，网页端不可篡改。',
  },
  {
    module: 'Jito Block Engine（新加坡节点）',
    purpose: '防三明治夹子攻击，并在暴跌触发止损时优先打包撤池子',
    needsExtraKey: false,
    keyStatus: '无需额外 Key（公共端点直连）',
    notes: '直连 singapore.mainnet.block-engine.jito.wtf，附带极低 SOL 小费即可。',
  },
];

export function buildPresetForCapital(
  capitalUsdt: number,
  riskProfile: RiskProfileKey
): StrategyConfig {
  const safeCapital = Math.max(50, Math.min(Number(capitalUsdt) || 200, 100_000));
  // Keep ~7.5% (min 12U, 15U for 200U) strictly as SOL gas & account rent reserve
  const gasReserveUsdt = Number(Math.max(12, Math.min(safeCapital * 0.075, 40)).toFixed(1));
  const lpActiveUsdt = Number((safeCapital - gasReserveUsdt).toFixed(1));

  if (riskProfile === 'ultra-safe') {
    return {
      capitalUsdt: safeCapital,
      riskProfile,
      gasReserveUsdt,
      lpActiveUsdt,
      coreSplitPct: 100,
      autoCompound: false,
      minAPR: 25,
      minTVL: 3_000_000, // >= $3M deep bluechip pools only
      rangeWidthPct: 20, // Wide ±20% range: ultra-low rebalance frequency
      harvestMinUsd: 2.5,
      stopLossPercentage: 5, // Hard -5% drawdown circuit breaker
      takeProfitSweepUsd: 10,
      maxILTolerance: 1.5,
      jitoTipLamports: 500_000,
      slippageBps: 30,
      autoWithdrawSafety: true,
      multiPositionParallel: true,
      smartCapitalAllocation: true,
      autoAssetRebalance: true,
      rebalanceDriftThresholdPct: 15,
      multiCurrencyHedge: true,
      autoSelectorWeights: {
        aprWeight: 0.25,
        volumeTvlRatioWeight: 0.35,
        safetyWeight: 0.4,
      },
    };
  }

  if (riskProfile === 'active-yield') {
    return {
      capitalUsdt: safeCapital,
      riskProfile: 'active-yield',
      gasReserveUsdt,
      lpActiveUsdt,
      coreSplitPct: 70, // 70% Core Bluechip tight CLMM + 30% High-Turnover Satellite Pool
      autoCompound: true,
      minAPR: 60,
      minTVL: 500_000, // >= $500K deep liquidity eliminates micro rug traps while unlocking active pairs
      rangeWidthPct: 6, // Tight ±6% CLMM range boosts fee capture ~2.45x
      harvestMinUsd: 2.0,
      stopLossPercentage: 8, // -8% ($16 on 200U) drawdown exit
      takeProfitSweepUsd: 15, // Auto-compound up to $15 net profit before sweeping
      maxILTolerance: 2.8,
      jitoTipLamports: 1_000_000,
      slippageBps: 60,
      autoWithdrawSafety: true,
      multiPositionParallel: true,
      smartCapitalAllocation: true,
      autoAssetRebalance: true,
      rebalanceDriftThresholdPct: 15,
      multiCurrencyHedge: true,
      autoSelectorWeights: {
        aprWeight: 0.45,
        volumeTvlRatioWeight: 0.35,
        safetyWeight: 0.2,
      },
    };
  }

  if (riskProfile === 'turbo-high-yield') {
    return {
      capitalUsdt: safeCapital,
      riskProfile: 'turbo-high-yield',
      gasReserveUsdt,
      lpActiveUsdt,
      coreSplitPct: 45, // 45% ultra-tight Core CLMM + 55% #1 Highest-APR Satellite CLMM
      autoCompound: true,
      minAPR: 45,
      minTVL: 300_000, // >= $300K real liquidity unlocks top-APR CLMM pairs
      rangeWidthPct: 4, // Ultra-tight ±4% CLMM range boosts fee capture ~3.45x
      harvestMinUsd: 0.5, // Fast compounding for rapid fee turnover
      stopLossPercentage: 10, // -10% drawdown exit
      takeProfitSweepUsd: 5, // Frequent profit sweep at $5 net profit
      maxILTolerance: 4.5,
      jitoTipLamports: 1_200_000,
      slippageBps: 80,
      autoWithdrawSafety: true,
      multiPositionParallel: true,
      smartCapitalAllocation: true,
      autoAssetRebalance: true,
      rebalanceDriftThresholdPct: 15,
      multiCurrencyHedge: true,
      autoSelectorWeights: {
        aprWeight: 0.55,
        volumeTvlRatioWeight: 0.3,
        safetyWeight: 0.15,
      },
    };
  }

  return {
    capitalUsdt: safeCapital,
    riskProfile: 'balanced-steady',
    gasReserveUsdt,
    lpActiveUsdt,
    coreSplitPct: 100,
    autoCompound: true,
    minAPR: 45,
    minTVL: 2_000_000, // >= $2M TVL filter eliminates micro-cap rug pools
    rangeWidthPct: 10, // Concentrated ±10% range boosts fee density ~1.65x vs wide range
    harvestMinUsd: 2.5,
    stopLossPercentage: 6, // Hard -6% ($12 on 200U) drawdown exit
    takeProfitSweepUsd: 10,
    maxILTolerance: 2.0,
    jitoTipLamports: 800_000,
    slippageBps: 50,
    autoWithdrawSafety: true,
    multiPositionParallel: true,
    smartCapitalAllocation: true,
    autoAssetRebalance: true,
    rebalanceDriftThresholdPct: 15,
    multiCurrencyHedge: true,
    autoSelectorWeights: {
      aprWeight: 0.35,
      volumeTvlRatioWeight: 0.35,
      safetyWeight: 0.3,
    },
  };
}

export const DEFAULT_200U_STRATEGY: StrategyConfig = buildPresetForCapital(
  200,
  'balanced-steady'
);

const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidSolanaAddress(address: string): boolean {
  return BASE58_REGEX.test(address.trim());
}

export function maskSolanaAddress(address: string): string {
  const clean = address.trim();
  if (!clean) return '未配置';
  if (clean.length <= 10) return '****';
  return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
}

/**
 * Standard AMM Impermanent Loss percentage given price ratio r = P_new / P_entry.
 */
export function calculateImpermanentLossPct(priceRatio: number): number {
  if (!Number.isFinite(priceRatio) || priceRatio <= 0) {
    return 0;
  }
  const il = (2 * Math.sqrt(priceRatio)) / (1 + priceRatio) - 1;
  return Number((il * 100).toFixed(2));
}

/**
 * Realistic daily / monthly net estimate for small capital (e.g. 200U)
 * factoring CLMM range concentration multiplier, auto-compounding,
 * and realistic monthly rebalance gas + slippage overhead.
 */
export function estimateNetYieldForCapital(
  lpUsdt: number,
  aprPct: number,
  rangeWidthPct: number,
  riskProfile: RiskProfileKey = 'balanced-steady',
  autoCompound = true
): {
  concentrationMultiplier: number;
  effectiveAprPct: number;
  dailyGrossUsd: number;
  monthlyGasAndSlippageUsd: number;
  monthlyNetUsd: number;
  monthlyNetPct: number;
  realisticMinUsd: number;
  realisticMaxUsd: number;
  estimatedWinProbRange: string;
} {
  const concentrationMultiplier =
    rangeWidthPct <= 4
      ? 3.45
      : rangeWidthPct <= 6
      ? 2.45
      : rangeWidthPct <= 10
      ? 1.65
      : rangeWidthPct <= 15
      ? 1.25
      : 1.0;

  const compoundMultiplier = autoCompound ? 1.08 : 1.0;
  // Cap base APR conservatively so temporary spikes don't inflate illusions
  const maxAprCap = riskProfile === 'turbo-high-yield' ? 260 : 160;
  const cappedBaseApr = Math.min(Math.max(aprPct, 10), maxAprCap);
  // Active-yield combines 70% core + 30% satellite; Turbo pushes 45% tight core + 55% top-APR satellite
  const satelliteBlend =
    riskProfile === 'turbo-high-yield' ? 1.45 : riskProfile === 'active-yield' ? 1.2 : 1.0;

  const effectiveAprPct = Number(
    (cappedBaseApr * concentrationMultiplier * compoundMultiplier * satelliteBlend).toFixed(1)
  );
  const dailyGrossUsd = Number(((lpUsdt * (effectiveAprPct / 100)) / 365).toFixed(2));

  // Tight ranges rebalance more frequently -> subtract realistic rebalance gas + swap slippage
  const monthlyGasAndSlippageUsd =
    rangeWidthPct <= 4
      ? Math.max(2.2, Number((lpUsdt * 0.032).toFixed(1)))
      : rangeWidthPct <= 6
      ? 5.2
      : rangeWidthPct <= 10
      ? 3.0
      : 1.8;

  const monthlyGross = dailyGrossUsd * 30;
  const monthlyNetUsd = Number(Math.max(0, monthlyGross - monthlyGasAndSlippageUsd).toFixed(2));
  const monthlyNetPct = lpUsdt > 0 ? Number(((monthlyNetUsd / lpUsdt) * 100).toFixed(1)) : 0;

  const realisticMinUsd = Number(Math.max(0, monthlyNetUsd * 0.6).toFixed(1));
  const realisticMaxUsd = Number((monthlyNetUsd * 1.35).toFixed(1));
  const estimatedWinProbRange =
    riskProfile === 'ultra-safe'
      ? '65% ~ 75%'
      : riskProfile === 'turbo-high-yield'
      ? '35% ~ 50%'
      : riskProfile === 'active-yield'
      ? '45% ~ 55%'
      : '55% ~ 65%';

  return {
    concentrationMultiplier,
    effectiveAprPct,
    dailyGrossUsd,
    monthlyGasAndSlippageUsd,
    monthlyNetUsd,
    monthlyNetPct,
    realisticMinUsd,
    realisticMaxUsd,
    estimatedWinProbRange,
  };
}

export function scorePoolForSteadyProfit(
  pool: PoolMetrics,
  config: StrategyConfig
): {
  volTvlRatio: number;
  alphaScore: number;
  eligibleFor200U: boolean;
  poolRole: 'core' | 'satellite' | 'rejected';
  selectionReason: string;
} {
  const safeTvl = Math.max(pool.tvl, 1);
  const volTvlRatio = Number((pool.volume24h / safeTvl).toFixed(2));

  const w = config.autoSelectorWeights;
  const totalW = Math.max(w.aprWeight + w.volumeTvlRatioWeight + w.safetyWeight, 0.001);
  const wApr = w.aprWeight / totalW;
  const wVol = w.volumeTvlRatioWeight / totalW;
  const wSafe = w.safetyWeight / totalW;

  const aprCap =
    config.riskProfile === 'turbo-high-yield'
      ? 320
      : config.riskProfile === 'active-yield'
      ? 240
      : 180;
  const aprScore = Math.min((Math.max(pool.apr, 0) / aprCap) * 100, 100);
  const activityScore = Math.min(volTvlRatio * 25, 100);
  const safetyComponent = Math.min(Math.max(pool.safetyScore, 0), 100);

  // In turbo mode, allow high-APR pools up to 420% APR provided TVL is deep enough
  const isHighRisk =
    config.riskProfile === 'turbo-high-yield'
      ? pool.apr > 420
      : pool.ilRisk === '高';
  const isCoreBluechip = pool.ilRisk === '低' && pool.tvl >= 1_500_000;
  const tvlTooLow = pool.tvl < config.minTVL;
  const effectiveMinApr =
    (config.riskProfile === 'active-yield' || config.riskProfile === 'turbo-high-yield') &&
    isCoreBluechip
      ? 30
      : config.minAPR;
  const aprTooLow = pool.apr < effectiveMinApr;

  const minSafety =
    config.riskProfile === 'turbo-high-yield'
      ? 68
      : config.riskProfile === 'active-yield'
      ? 80
      : 85;
  const riskRejected =
    isHighRisk ||
    (config.riskProfile === 'ultra-safe' && pool.ilRisk !== '低');

  const riskPenalty = isHighRisk ? 35 : riskRejected ? 20 : 0;
  const tvlPenalty = tvlTooLow ? 25 : 0;

  const rawScore =
    aprScore * wApr +
    activityScore * wVol +
    safetyComponent * wSafe -
    riskPenalty -
    tvlPenalty;

  const alphaScore = Number(Math.min(Math.max(rawScore, 0), 100).toFixed(1));
  const eligibleFor200U =
    !riskRejected && !tvlTooLow && !aprTooLow && pool.safetyScore >= minSafety;

  const poolRole: 'core' | 'satellite' | 'rejected' = !eligibleFor200U
    ? 'rejected'
    : isCoreBluechip
    ? 'core'
    : 'satellite';

  const reasons: string[] = [];
  if (isHighRisk) reasons.push('高波动淘汰（防无常损失穿仓）');
  else if (riskRejected) reasons.push('当前极稳模式仅收低波动蓝筹池');
  if (tvlTooLow) reasons.push(`深度低于 $${(config.minTVL / 1_000_000).toFixed(1)}M 门槛`);
  if (aprTooLow) reasons.push(`年化低于 ${effectiveMinApr}%`);
  if (eligibleFor200U) {
    reasons.push(poolRole === 'core' ? '核心蓝筹压舱池' : '高换手增效卫星池');
    reasons.push(`深度 $${(pool.tvl / 1_000_000).toFixed(2)}M`);
    reasons.push(`换手 ${volTvlRatio}x`);
  }

  return {
    volTvlRatio,
    alphaScore,
    eligibleFor200U,
    poolRole,
    selectionReason: reasons.join(' · '),
  };
}

export function rankPools(pools: PoolMetrics[], config: StrategyConfig): ScoredPool[] {
  const scored: ScoredPool[] = pools.map((pool) => {
    const info = scorePoolForSteadyProfit(pool, config);
    return {
      ...pool,
      ...info,
      autoSelected: false,
    };
  });

  scored.sort((a, b) => {
    if (a.eligibleFor200U !== b.eligibleFor200U) {
      return a.eligibleFor200U ? -1 : 1;
    }
    return b.alphaScore - a.alphaScore;
  });

  if (scored.length > 0) {
    scored[0].autoSelected = true;
  }

  return scored;
}

export interface RiskCheckInput {
  pnlPct: number;
  ilPctAbs: number;
  tvlDropPct1h: number;
  uncollectedFeesUsd: number;
}

export interface RiskDecision {
  action: 'HOLD' | 'HARVEST_AND_SWEEP' | 'REBALANCE_IL' | 'EMERGENCY_WITHDRAW';
  reason: string;
}

export function evaluateRiskAction(
  input: RiskCheckInput,
  config: StrategyConfig
): RiskDecision {
  if (config.autoWithdrawSafety && input.tvlDropPct1h >= 25) {
    return {
      action: 'EMERGENCY_WITHDRAW',
      reason: `池子深度 1 小时内骤降 ${input.tvlDropPct1h}%，触发防撤池紧急退出，全额换回 USDC`,
    };
  }
  if (input.pnlPct <= -Math.abs(config.stopLossPercentage)) {
    return {
      action: 'EMERGENCY_WITHDRAW',
      reason: `回撤达 ${input.pnlPct.toFixed(1)}%，触及 -${config.stopLossPercentage}% 保本止损线，自动撤池避险`,
    };
  }
  if (input.ilPctAbs >= config.maxILTolerance) {
    return {
      action: 'REBALANCE_IL',
      reason: `无常损失达 ${input.ilPctAbs.toFixed(2)}%，超过 ${config.maxILTolerance}% 容忍线，自动重设 ±${config.rangeWidthPct}% 区间`,
    };
  }
  if (input.uncollectedFeesUsd >= config.harvestMinUsd) {
    return {
      action: 'HARVEST_AND_SWEEP',
      reason: `待收手续费 $${input.uncollectedFeesUsd.toFixed(2)} 已达 $${config.harvestMinUsd} 经济收割线（省 Gas），执行收割`,
    };
  }
  return {
    action: 'HOLD',
    reason: '仓位在集中区间内正常赚取手续费，未达收割阈值暂不花 Gas 操作',
  };
}

export type RiskAlertSeverity = 'critical' | 'warning' | 'info' | 'safe';

export interface RiskLogEntry {
  id: string;
  time: string;
  severity: RiskAlertSeverity;
  category: string;
  target: string;
  detail: string;
}

export interface LiveRiskScanInput {
  pools: ScoredPool[];
  jupiterImpactBps: number | null;
  heliusLatencyMs: number | null;
  privateKeyConfigured: boolean;
  config: StrategyConfig;
  nowTime: string;
}

/**
 * Generates real-time, verifiable risk alerts exclusively from live on-chain/API measurements:
 * 1) High-volatility / abnormal APR token pools (imminent IL or price manipulation trap)
 * 2) Shallow TVL pools (high exit slippage risk during emergency withdraw)
 * 3) Live Jupiter exit route price impact vs configured slippageBps
 * 4) Helius RPC latency & backend key isolation guard
 */
export function evaluateLiveRiskAlerts(input: LiveRiskScanInput): RiskLogEntry[] {
  const alerts: RiskLogEntry[] = [];
  const { pools, jupiterImpactBps, heliusLatencyMs, privateKeyConfigured, config, nowTime } = input;

  // 1. Live Jupiter exit slippage check
  if (jupiterImpactBps !== null) {
    if (jupiterImpactBps > config.slippageBps) {
      alerts.push({
        id: `slip-breach-${Date.now()}`,
        time: nowTime,
        severity: 'critical',
        category: '撤池滑点过高预警',
        target: 'SOL / USDC (Jupiter v1)',
        detail: `实时聚合路由冲击达 ${jupiterImpactBps.toFixed(1)} bps，已超过撤池滑点上限 ${config.slippageBps} bps，已触发防滑点保护并切换 Jito 优先通道。`,
      });
    } else {
      alerts.push({
        id: `slip-ok-${Date.now()}`,
        time: nowTime,
        severity: 'safe',
        category: '撤池滑点实测正常',
        target: 'SOL / USDC (Jupiter v1)',
        detail: `实时撤池换币冲击仅 ${jupiterImpactBps.toFixed(2)} bps（熔断上限 ${config.slippageBps} bps），流动性充足可随时低损耗退出。`,
      });
    }
  }

  // 2. Live Raydium pools: abnormal price/APR volatility traps
  const volatilePools = pools.filter(
    (p) => p.ilRisk === '高' || p.apr > 180 || Math.abs(p.priceChange24h || 0) >= 8
  );
  for (const pool of volatilePools.slice(0, 3)) {
    const tvlLabel =
      pool.tvl >= 1_000_000
        ? `$${(pool.tvl / 1_000_000).toFixed(2)}M`
        : `$${Math.round(pool.tvl / 1000)}K`;
    alerts.push({
      id: `vol-${pool.id}`,
      time: nowTime,
      severity: 'critical',
      category: 'Token 价格异常波动预警',
      target: pool.name,
      detail: `监测到 ${pool.name} 年化畸高 (+${pool.apr}%) 且波动剧烈（深度 ${tvlLabel}），无常损失穿仓风险极高，自动风控已拦截入场。`,
    });
  }

  // 3. Live Raydium pools: shallow liquidity -> withdraw slippage risk
  const shallowPools = pools.filter(
    (p) => p.tvl < config.minTVL && !volatilePools.some((v) => v.id === p.id)
  );
  for (const pool of shallowPools.slice(0, 2)) {
    alerts.push({
      id: `shallow-${pool.id}`,
      time: nowTime,
      severity: 'warning',
      category: '浅池撤池高滑点预警',
      target: pool.name,
      detail: `当前 TVL 仅 $${Math.round(pool.tvl / 1000)}K（低于 $${(config.minTVL / 1_000_000).toFixed(1)}M 安全门槛），若遇踩踏撤池将产生高额滑点，已自动过滤。`,
    });
  }

  // 4. Helius RPC latency guard
  if (heliusLatencyMs !== null && heliusLatencyMs > 600) {
    alerts.push({
      id: `rpc-lat-${Date.now()}`,
      time: nowTime,
      severity: 'warning',
      category: 'RPC 节点延迟波动',
      target: 'Helius Mainnet RPC',
      detail: `当前链上查询延迟 ${heliusLatencyMs} ms 偏高，已开启交易超时保护，等待节点稳定后再重设集中区间。`,
    });
  }

  // 5. Backend key guard (never fake positions)
  if (!privateKeyConfigured) {
    alerts.push({
      id: `guard-env-${Date.now()}`,
      time: nowTime,
      severity: 'info',
      category: '后台密钥隔离护栏',
      target: '服务器 .env 守卫',
      detail: `当前为纯策略展示模式（后台尚未注入私钥），系统仅实时扫描主网风险，绝不执行虚假交易或展示虚假仓位。`,
    });
  }

  return alerts;
}

export type PipelineStepKey = 'swap' | 'addLp' | 'removeLp' | 'sweep';
export type PipelineStepStatus = 'passed' | 'readonly_only' | 'warning' | 'failed';
export type PipelineRunMode = 'live' | 'simulate';
export type PipelineTestAsset = 'SOL' | 'USDC' | 'USDT';

export interface PipelineStepResult {
  step: PipelineStepKey;
  title: string;
  status: PipelineStepStatus;
  mode?: PipelineRunMode;
  txId?: string;
  explorerUrl?: string;
  positionNftMint?: string;
  summary: string;
  details: string;
  durationMs: number;
}

export interface WalletReadinessInput {
  step: 'all' | PipelineStepKey;
  asset: PipelineTestAsset;
  solBalance: number;
  usdcBalance: number;
  usdtBalance: number;
  hasPrivateKey: boolean;
  hasValidRecipient: boolean;
}

export function assessLiveTestWalletReadiness(input: WalletReadinessInput): {
  ok: boolean;
  requiredSol: number;
  reason?: string;
  note: string;
} {
  const { step, asset, solBalance, usdcBalance, usdtBalance, hasPrivateKey, hasValidRecipient } = input;

  if (!hasPrivateKey) {
    return {
      ok: false,
      requiredSol: 0.035,
      reason: '服务器后台 .env 未配置有效 PRIVATE_KEY，无法签名并发送真实链上交易。',
      note: '请在服务器 .env 配置 PRIVATE_KEY 后重启服务，或切换至“只读仿真”模式验证接口连通性。',
    };
  }

  if ((step === 'all' || step === 'sweep') && !hasValidRecipient) {
    return {
      ok: false,
      requiredSol: 0.002,
      reason: '服务器后台 .env 未配置有效的 RECIPIENT_ADDRESS 收款公钥，无法执行利润转移测试。',
      note: '请在服务器 .env 配置 RECIPIENT_ADDRESS 后重启服务。',
    };
  }

  const requiredSol =
    step === 'all'
      ? asset === 'SOL'
        ? 0.035
        : 0.025
      : step === 'swap'
      ? asset === 'SOL'
        ? 0.012
        : 0.003
      : step === 'addLp'
      ? 0.022
      : 0.002;

  if (solBalance < requiredSol) {
    return {
      ok: false,
      requiredSol,
      reason: `交易钱包当前余额为 ${solBalance.toFixed(4)} SOL，真实全流程至少需要约 ${requiredSol} SOL（含 0.018 SOL 可退还仓位 NFT 租金及链上 Gas）。`,
      note: '撤池平仓后 0.018 SOL 仓位租金会自动原路退回钱包，实际净耗损仅约 0.0005 SOL 手续费。',
    };
  }

  if ((step === 'all' || step === 'swap') && asset === 'USDC' && usdcBalance < 0.1) {
    return {
      ok: false,
      requiredSol,
      reason: `交易钱包当前 USDC 余额为 ${usdcBalance.toFixed(4)} USDC，不足 0.1 USDC 实测要求（建议改选 0.01 SOL 实测，会自动换出 USDC）。`,
      note: '使用 0.01 SOL 实测可自动换出 USDC 并串联后续加池/撤池闭环。',
    };
  }

  if ((step === 'all' || step === 'swap') && asset === 'USDT' && usdtBalance < 0.1) {
    return {
      ok: false,
      requiredSol,
      reason: `交易钱包当前 USDT 余额为 ${usdtBalance.toFixed(4)} USDT，不足 0.1 USDT 实测要求（建议改选 0.01 SOL 实测）。`,
      note: '使用 0.01 SOL 实测无需预先持有 USDT/USDC 即可完成全流程真实交易测试。',
    };
  }

  return {
    ok: true,
    requiredSol,
    note: `钱包余额充足（${solBalance.toFixed(4)} SOL / ${usdcBalance.toFixed(2)} USDC / ${usdtBalance.toFixed(2)} USDT），即将发送真实 Solana 主网交易。`,
  };
}

export function calculateLpDepositAmounts(
  lpUsdt: number,
  solPriceUsd: number,
  rangeWidthPct: number
): {
  usdcAmount: number;
  solAmount: number;
  lowerPriceUsd: number;
  upperPriceUsd: number;
} {
  const safeLp = Math.max(lpUsdt, 0);
  const safeSolPrice = Math.max(solPriceUsd, 1);
  const halfUsd = safeLp / 2;
  const usdcAmount = Number(halfUsd.toFixed(2));
  const solAmount = Number((halfUsd / safeSolPrice).toFixed(4));
  const lowerPriceUsd = Number((safeSolPrice * (1 - rangeWidthPct / 100)).toFixed(2));
  const upperPriceUsd = Number((safeSolPrice * (1 + rangeWidthPct / 100)).toFixed(2));
  return { usdcAmount, solAmount, lowerPriceUsd, upperPriceUsd };
}

/**
 * Safely converts unknown Solana / Raydium / RPC rejections (including plain objects like
 * `{ InstructionError: [0, { Custom: 6021 }], txId }` where `.message` is undefined) into
 * clear, actionable Chinese + raw diagnostics without ever returning "undefined".
 */
export function formatChainError(err: unknown): string {
  if (err === null || err === undefined) {
    return '链上节点未返回具体错误信息（请查看 TX 日志或重试）';
  }
  let raw = '';
  if (typeof err === 'string') {
    const clean = err.trim();
    raw = clean && clean !== 'undefined' ? clean : '';
  } else if (err instanceof Error) {
    raw = err.message || err.name || '';
    const extra = err as Error & { logs?: string[]; err?: unknown };
    if (Array.isArray(extra.logs) && extra.logs.length > 0) {
      const relevant = extra.logs.slice(-4).join(' | ');
      raw = raw ? `${raw} [${relevant}]` : relevant;
    } else if (!raw && extra.err) {
      raw = JSON.stringify(extra.err);
    }
  } else if (typeof err === 'object') {
    try {
      const ownProps: Record<string, unknown> = {};
      for (const k of Object.getOwnPropertyNames(err)) {
        ownProps[k] = (err as Record<string, unknown>)[k];
      }
      raw = JSON.stringify(Object.keys(ownProps).length > 0 ? ownProps : err);
    } catch {
      raw = String(err);
    }
  } else {
    raw = String(err);
  }

  if (!raw || raw === '{}' || raw === 'undefined') {
    raw = '节点返回空错误对象（可能为 RPC 超时或交易被丢弃）';
  }

  if (raw.includes('6021') || raw.toLowerCase().includes('priceslippagecheck')) {
    return `价格滑点保护触发 (6021): 开仓瞬间池价波动超出 upper bound，已提高上界缓冲（原始: ${raw}）`;
  }
  if (raw.includes('cannot found target token accounts')) {
    return `缺少目标代币关联账户 (ATA): 集中做市需同时持有 WSOL 与 USDC 账户余额（原始: ${raw}）`;
  }
  if (raw.includes('InsufficientFunds') || raw.includes('"Custom":1') || raw.includes('insufficient lamports')) {
    return `钱包可用 SOL 或代币余额不足（请预留 >=0.025 SOL 用于仓位租金与手续费）(${raw})`;
  }
  if (raw.toLowerCase().includes('block height exceeded') || raw.toLowerCase().includes('blockhash not found')) {
    return `交易在区块有效期内未被打包确认 (Blockhash 过期)，系统已支持高频重广播与高优 Fee（原始: ${raw}）`;
  }

  return raw.length > 260 ? `${raw.slice(0, 260)}...` : raw;
}

/**
 * Raydium SDK v2 `PoolUtils.getLiquidityAmountOutFromAmountIn` sets `amountSlippageA/B` to
 * `expectedAmount * (1 - slippage)`, which is smaller than `expectedAmount` when adding liquidity
 * and causes `PriceSlippageCheck (6021)` on `openPositionFromBase`.
 * This helper enforces an upper-bound ceiling `ceil(max(expected, sdkSlippage) * (1 + bufferPct/100))`.
 */
export function computeSafeClmmOtherAmountMax(
  expectedAmountAtomic: string | number | bigint,
  sdkSlippageAmountAtomic: string | number | bigint = 0,
  bufferPct = 25
): string {
  const expected = BigInt(String(expectedAmountAtomic || '0'));
  const sdkVal = BigInt(String(sdkSlippageAmountAtomic || '0'));
  const base = expected > sdkVal ? expected : sdkVal;
  if (base <= 0n) return '0';
  const safeBuffer = BigInt(Math.max(5, Math.round(bufferPct)));
  const ceiling = (base * (100n + safeBuffer) + 99n) / 100n;
  return ceiling.toString();
}

export interface ActiveLpPosition {
  nftMint: string;
  nftMintMasked: string;
  poolId: string;
  poolName: string;
  dex: string;
  priceCurrentUsd: number;
  priceLowerUsd: number;
  priceUpperUsd: number;
  tickLower: number;
  tickUpper: number;
  inRange: boolean;
  tokenASymbol: string;
  tokenBSymbol: string;
  tokenAAmount: number;
  tokenBAmount: number;
  injectedValueUsd: number;
  uncollectedFeeUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  liquidity: string;
  openedAt?: string;
}

export interface PoolSelectionRound {
  round: number;
  time: string;
  timestamp: number;
  candidateCount: number;
  chosenPool: {
    id: string;
    name: string;
    dex: string;
    apr: number;
    tvlUsd: number;
    volume24hUsd: number;
    alphaScore: number;
    role: 'core' | 'satellite' | 'rejected';
    selectionReason: string;
  } | null;
  rejectedSamples: Array<{
    name: string;
    reason: string;
    apr: number;
    tvlUsd: number;
  }>;
  strategyAction: string;
  jupiterSlippageBps: number | null;
  solPriceUsd: number | null;
}

const STABLE_SYMBOLS = new Set(['USDC', 'USDT', 'PYUSD', 'USDS', 'USD1']);

export function calculatePositionMetrics(params: {
  currentPrice: number;
  priceLower: number;
  priceUpper: number;
  amountA: number;
  amountB: number;
  tokenASymbol?: string;
  tokenBSymbol?: string;
  uncollectedFeeUsd?: number;
  solPriceUsd?: number;
}): {
  inRange: boolean;
  injectedValueUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
} {
  const {
    currentPrice,
    priceLower,
    priceUpper,
    amountA,
    amountB,
    tokenASymbol = 'WSOL',
    tokenBSymbol = 'USDC',
    uncollectedFeeUsd = 0,
    solPriceUsd = 0,
  } = params;
  const inRange =
    currentPrice >= Math.min(priceLower, priceUpper) &&
    currentPrice <= Math.max(priceLower, priceUpper);

  const symA = tokenASymbol.toUpperCase();
  const symB = tokenBSymbol.toUpperCase();
  const isStableA = STABLE_SYMBOLS.has(symA);
  const isStableB = STABLE_SYMBOLS.has(symB);
  const isSolA = symA === 'SOL' || symA === 'WSOL';
  const isSolB = symB === 'SOL' || symB === 'WSOL';

  let valA = 0;
  let valB = 0;
  if (isStableB) {
    // Raydium poolInfo.price is MintB per MintA (USD per TokenA)
    valA = amountA * Math.max(currentPrice, 0);
    valB = amountB * 1.0;
  } else if (isStableA) {
    valA = amountA * 1.0;
    valB = currentPrice > 0 ? amountB / currentPrice : 0;
  } else if (isSolA && solPriceUsd > 0) {
    valA = amountA * solPriceUsd;
    valB = currentPrice > 0 ? amountB * (solPriceUsd / currentPrice) : 0;
  } else if (isSolB && solPriceUsd > 0) {
    valB = amountB * solPriceUsd;
    valA = amountA * Math.max(currentPrice, 0) * solPriceUsd;
  } else {
    valA = amountA * Math.max(currentPrice, 0);
    valB = amountB;
  }

  const injectedValueUsd = Number((valA + valB).toFixed(2));
  const unrealizedPnlUsd = Number(uncollectedFeeUsd.toFixed(2));
  const unrealizedPnlPct =
    injectedValueUsd > 0 ? Number(((unrealizedPnlUsd / injectedValueUsd) * 100).toFixed(2)) : 0;

  return {
    inRange,
    injectedValueUsd,
    unrealizedPnlUsd,
    unrealizedPnlPct,
  };
}

export interface AutoPortfolioSlotPlan {
  slotIndex: number;
  poolId: string;
  poolName: string;
  role: 'core' | 'satellite';
  targetUsd: number;
  apr: number;
  rangeWidthPct: number;
}

export interface AutoPortfolioPlan {
  walletTotalUsd: number;
  activeInjectedUsd: number;
  idleDeployableUsd: number;
  utilizationPct: number;
  reserveSol: number;
  deployableSol: number;
  deployableUsdc: number;
  targetSlots: number;
  hasDustPositionToConsolidate: boolean;
  dustPositionUsd: number;
  usdcExceedsInjected: boolean;
  incrementalTriggerActive: boolean;
  incrementalBudgetUsd: number;
  utilizationStatusLabel: string;
  slotPlans: AutoPortfolioSlotPlan[];
  diagnosisNote: string;
}

export function calculateAutoPortfolioPlan(params: {
  solBalance: number;
  usdcBalance: number;
  solPriceUsd: number;
  activePositions: Array<{
    poolId: string;
    poolName: string;
    injectedValueUsd: number;
    inRange?: boolean;
  }>;
  rankedPools: ScoredPool[];
  config: StrategyConfig;
}): AutoPortfolioPlan {
  const {
    solBalance,
    usdcBalance,
    solPriceUsd,
    activePositions,
    rankedPools,
    config,
  } = params;
  const safeSolPrice = Math.max(solPriceUsd || 68, 1);
  const walletTotalUsd = Number((solBalance * safeSolPrice + usdcBalance).toFixed(2));
  const activeInjectedUsd = Number(
    activePositions.reduce((acc, p) => acc + Math.max(0, p.injectedValueUsd), 0).toFixed(2)
  );

  const parallelAllowed = config.multiPositionParallel !== false;
  const smartAllocEnabled = config.smartCapitalAllocation !== false;

  const isDualSlot = parallelAllowed;
  const isTriSlot = parallelAllowed && walletTotalUsd >= 60;
  const targetSlots = !parallelAllowed ? 1 : isTriSlot ? 3 : isDualSlot ? 2 : 1;

  // Reserve 0.048 SOL for multi-position NFTs (~0.018 * 2-3) + gas fees; 0.028 SOL for 1 position
  const reserveSol = targetSlots >= 2 ? 0.048 : 0.028;
  const deployableSol = Number(Math.max(0, solBalance - reserveSol).toFixed(6));
  const deployableUsdc = Number(Math.max(0, usdcBalance).toFixed(4));
  const idleDeployableUsd = Number(
    (deployableSol * safeSolPrice + deployableUsdc).toFixed(2)
  );

  const dustPositions = activePositions.filter(
    (p) => p.injectedValueUsd > 0 && p.injectedValueUsd < 1.5
  );
  const dustPositionUsd = Number(
    dustPositions.reduce((acc, p) => acc + p.injectedValueUsd, 0).toFixed(2)
  );
  const hasDustPositionToConsolidate =
    dustPositions.length > 0 && idleDeployableUsd >= 8;

  const effectiveCapitalBase = activeInjectedUsd + idleDeployableUsd;
  const utilizationPct =
    effectiveCapitalBase > 0
      ? Number(Math.min(100, (activeInjectedUsd / effectiveCapitalBase) * 100).toFixed(1))
      : 0;

  const usdcExceedsInjected = usdcBalance > activeInjectedUsd && usdcBalance >= 2;
  const incrementalTriggerActive =
    smartAllocEnabled && (idleDeployableUsd >= 5 || usdcExceedsInjected);
  const incrementalBudgetUsd = incrementalTriggerActive
    ? Number(Math.min(config.lpActiveUsdt, idleDeployableUsd * 0.88).toFixed(2))
    : 0;

  let utilizationStatusLabel = '等待资金转入';
  if (hasDustPositionToConsolidate) {
    utilizationStatusLabel = '微仓回收 + 自动增量激活就绪';
  } else if (incrementalTriggerActive) {
    utilizationStatusLabel = usdcExceedsInjected
      ? 'USDC 高于在池价值 · 自动增量加仓就绪'
      : '检测到闲置资金 · 自动增量加仓就绪';
  } else if (activeInjectedUsd > 0 && utilizationPct >= 75) {
    utilizationStatusLabel = '资金高利用率做市中';
  } else if (activeInjectedUsd > 0) {
    utilizationStatusLabel = '运行中（已暂停增量加仓）';
  }

  // Target total budget for new/rebalanced deployment (leave ~8% buffer for swap fees/slippage)
  const totalBudgetUsd = Number(
    Math.min(config.lpActiveUsdt, (idleDeployableUsd + dustPositionUsd) * 0.9).toFixed(2)
  );

  const eligibleOrFallback = rankedPools.filter((p) => {
    const upperName = p.name.toUpperCase();
    const hasUsdcOrSol = upperName.includes('USDC') || upperName.includes('WSOL') || upperName.includes('SOL');
    return hasUsdcOrSol && p.tvl >= 250_000;
  });

  const corePool =
    eligibleOrFallback.find((p) => p.poolRole === 'core' || p.name.includes('WSOL / USDC')) ||
    eligibleOrFallback[0];

  // Distinct high-APR satellite pools sorted by risk-adjusted APR
  const satelliteCandidates = eligibleOrFallback
    .filter((p) => p.id !== corePool?.id && p.apr <= 420)
    .sort((a, b) => b.apr - a.apr);

  const satellitePool1 = satelliteCandidates[0];
  const satellitePool2 = satelliteCandidates[1];

  const slotPlans: AutoPortfolioSlotPlan[] = [];
  if (totalBudgetUsd >= 3 && corePool) {
    if (targetSlots >= 3 && satellitePool1 && satellitePool2 && totalBudgetUsd >= 18) {
      const coreUsd = Number((totalBudgetUsd * 0.4).toFixed(2));
      const sat1Usd = Number((totalBudgetUsd * 0.35).toFixed(2));
      const sat2Usd = Number((totalBudgetUsd - coreUsd - sat1Usd).toFixed(2));
      slotPlans.push(
        {
          slotIndex: 1,
          poolId: corePool.id,
          poolName: corePool.name,
          role: 'core',
          targetUsd: coreUsd,
          apr: corePool.apr,
          rangeWidthPct: config.rangeWidthPct,
        },
        {
          slotIndex: 2,
          poolId: satellitePool1.id,
          poolName: satellitePool1.name,
          role: 'satellite',
          targetUsd: sat1Usd,
          apr: satellitePool1.apr,
          rangeWidthPct: Math.max(4, config.rangeWidthPct),
        },
        {
          slotIndex: 3,
          poolId: satellitePool2.id,
          poolName: satellitePool2.name,
          role: 'satellite',
          targetUsd: sat2Usd,
          apr: satellitePool2.apr,
          rangeWidthPct: Math.max(5, config.rangeWidthPct),
        }
      );
    } else if (targetSlots >= 2 && satellitePool1 && totalBudgetUsd >= 8) {
      const coreRatio = Math.min(0.75, Math.max(0.35, config.coreSplitPct / 100));
      const coreUsd = Number((totalBudgetUsd * coreRatio).toFixed(2));
      const satUsd = Number((totalBudgetUsd - coreUsd).toFixed(2));
      slotPlans.push({
        slotIndex: 1,
        poolId: corePool.id,
        poolName: corePool.name,
        role: 'core',
        targetUsd: coreUsd,
        apr: corePool.apr,
        rangeWidthPct: config.rangeWidthPct,
      });
      slotPlans.push({
        slotIndex: 2,
        poolId: satellitePool1.id,
        poolName: satellitePool1.name,
        role: 'satellite',
        targetUsd: satUsd,
        apr: satellitePool1.apr,
        rangeWidthPct: Math.max(4, config.rangeWidthPct),
      });
    } else {
      slotPlans.push({
        slotIndex: 1,
        poolId: corePool.id,
        poolName: corePool.name,
        role: 'core',
        targetUsd: totalBudgetUsd,
        apr: corePool.apr,
        rangeWidthPct: config.rangeWidthPct,
      });
    }
  }

  let diagnosisNote = '';
  if (hasDustPositionToConsolidate) {
    diagnosisNote = `检测到当前仅开启了 $${dustPositionUsd.toFixed(
      2
    )} 测试微仓，但钱包仍有 $${idleDeployableUsd.toFixed(
      2
    )} 闲置资金未投入（资金利用率仅 ${utilizationPct}%）。自动回收微仓并退回 0.018 SOL 租金后，将投入约 $${totalBudgetUsd.toFixed(
      2
    )} 进 ${slotPlans.length} 个高年化池加速赚费。`;
  } else if (incrementalTriggerActive && activePositions.length > 0) {
    diagnosisNote = `${
      usdcExceedsInjected
        ? `检测到钱包 USDC (${usdcBalance.toFixed(2)}) 高于当前在池价值 ($${activeInjectedUsd.toFixed(2)})`
        : `检测到钱包尚余 $${idleDeployableUsd.toFixed(2)} 空余资金`
    }，智能资金分配已就绪：可自动增量注入 ~$${incrementalBudgetUsd.toFixed(2)}${
      parallelAllowed ? '（多仓位并行直开新池，不关停原仓）' : ''
    }。`;
  } else if (activeInjectedUsd > 0) {
    diagnosisNote = `当前共运行 ${activePositions.length} 个活跃做市仓位，已投入 $${activeInjectedUsd.toFixed(
      2
    )}（资金利用率 ${utilizationPct}%）。`;
  } else {
    diagnosisNote = `当前空仓待建，可用本金约 $${idleDeployableUsd.toFixed(2)}（可建 ${slotPlans.length} 个${
      parallelAllowed ? '并行' : '集中'
    }池）。`;
  }

  return {
    walletTotalUsd,
    activeInjectedUsd,
    idleDeployableUsd,
    utilizationPct,
    reserveSol,
    deployableSol,
    deployableUsdc,
    targetSlots,
    hasDustPositionToConsolidate,
    dustPositionUsd,
    usdcExceedsInjected,
    incrementalTriggerActive,
    incrementalBudgetUsd,
    utilizationStatusLabel,
    slotPlans,
    diagnosisNote,
  };
}

export function buildSelectionRoundFromPools(params: {
  roundNumber: number;
  pools: ScoredPool[];
  jupiterSlippageBps: number | null;
  solPriceUsd: number | null;
  timeStr: string;
  timestamp?: number;
}): PoolSelectionRound {
  const {
    roundNumber,
    pools,
    jupiterSlippageBps,
    solPriceUsd,
    timeStr,
    timestamp = Date.now(),
  } = params;
  const winner = pools.find((p) => p.autoSelected || p.eligibleFor200U) || pools[0] || null;

  const rejected = pools
    .filter((p) => !p.eligibleFor200U)
    .slice(0, 4)
    .map((p) => ({
      name: p.name,
      reason: p.selectionReason || (p.ilRisk === '高' ? '无常损失过高淘汰' : '深度不达标淘汰'),
      apr: p.apr,
      tvlUsd: p.tvl,
    }));

  let strategyAction = '全网风控扫描完成：未发现符合极低回撤要求的安全池，维持空仓避险';
  if (winner) {
    if (winner.alphaScore >= 80) {
      strategyAction = `优选【${winner.name}】核心蓝筹池做市（评分 ${winner.alphaScore}/100 · 年化 +${winner.apr}%）`;
    } else {
      strategyAction = `次优池【${winner.name}】在列，当前处于谨慎做市观察状态`;
    }
  }

  return {
    round: roundNumber,
    time: timeStr,
    timestamp,
    candidateCount: pools.length,
    chosenPool: winner
      ? {
          id: winner.id,
          name: winner.name,
          dex: winner.dex,
          apr: winner.apr,
          tvlUsd: winner.tvl,
          volume24hUsd: winner.volume24h,
          alphaScore: winner.alphaScore,
          role: winner.poolRole,
          selectionReason: winner.selectionReason,
        }
      : null,
    rejectedSamples: rejected,
    strategyAction,
    jupiterSlippageBps,
    solPriceUsd,
  };
}

export type AutonomousSwitchMode = 'OPEN_NEW' | 'ROTATE_SWAP' | 'HOLD_OPTIMAL';

export interface PoolComparisonItem {
  poolId: string;
  poolName: string;
  apr: number;
  volatilityLabel: '低波动' | '中波动' | '高波动';
  volatilityPctEstimate: number;
  riskAdjustedScore: number;
  tvlUsd: number;
  volTvlRatio: number;
  ilRisk: '低' | '中' | '高';
  isCurrentlyHeld: boolean;
}

export interface AutonomousHighYieldRecommendation {
  decision: AutonomousSwitchMode;
  shouldAct: boolean;
  actionButtonLabel: string;
  headline: string;
  reason: string;
  targetPool: PoolComparisonItem | null;
  sourcePositionToReplace: {
    poolId: string;
    poolName: string;
    nftMint?: string;
    injectedValueUsd: number;
    currentApr: number;
  } | null;
  deployBudgetUsd: number;
  aprGainPct: number;
  estimatedExtraMonthlyUsd: number;
  comparisons: PoolComparisonItem[];
}

export function evaluateAutonomousHighYieldSwitch(params: {
  rankedPools: ScoredPool[];
  activePositions: Array<{
    poolId: string;
    poolName: string;
    nftMint?: string;
    injectedValueUsd: number;
  }>;
  idleDeployableUsd: number;
  usdcBalance?: number;
  config: StrategyConfig;
}): AutonomousHighYieldRecommendation {
  const { rankedPools, activePositions, idleDeployableUsd, usdcBalance = 0, config } = params;
  const parallelEnabled = config.multiPositionParallel !== false;
  const smartAllocEnabled = config.smartCapitalAllocation !== false;

  const heldPoolIds = new Set(
    activePositions.filter((p) => p.injectedValueUsd >= 1.5).map((p) => p.poolId)
  );
  const activeInjectedTotal = activePositions.reduce(
    (sum, p) => sum + Math.max(0, p.injectedValueUsd),
    0
  );
  const hasIncrementalIdle =
    idleDeployableUsd >= 5 || (usdcBalance > activeInjectedTotal && usdcBalance >= 2);

  // Build APR vs Volatility comparison list for deployable SOL/USDC-paired pools
  const candidatePools = rankedPools.filter((p) => {
    const upper = p.name.toUpperCase();
    const hasMajorQuote = upper.includes('USDC') || upper.includes('WSOL') || upper.includes('SOL');
    return hasMajorQuote && p.tvl >= 250_000 && p.apr <= 420;
  });

  const comparisons: PoolComparisonItem[] = candidatePools.slice(0, 6).map((p) => {
    const baseVol = p.ilRisk === '低' ? 18 : p.ilRisk === '中' ? 42 : 76;
    const changeBoost = Math.min(24, Math.abs(p.priceChange24h || 0) * 1.5);
    const volatilityPctEstimate = Number((baseVol + changeBoost).toFixed(1));
    const volatilityLabel: '低波动' | '中波动' | '高波动' =
      p.ilRisk === '低' ? '低波动' : p.ilRisk === '中' ? '中波动' : '高波动';
    const tvlFactor = p.tvl >= 1_000_000 ? 1.12 : p.tvl >= 400_000 ? 1.0 : 0.88;
    const riskAdjustedScore = Number(
      ((p.apr / Math.sqrt(Math.max(volatilityPctEstimate, 10))) * tvlFactor).toFixed(1)
    );

    return {
      poolId: p.id,
      poolName: p.name,
      apr: p.apr,
      volatilityLabel,
      volatilityPctEstimate,
      riskAdjustedScore,
      tvlUsd: p.tvl,
      volTvlRatio: p.volTvlRatio,
      ilRisk: p.ilRisk,
      isCurrentlyHeld: heldPoolIds.has(p.id),
    };
  });

  comparisons.sort((a, b) => b.riskAdjustedScore - a.riskAdjustedScore);

  // Filter pools allowed under current risk guardrails (ultra-safe rejects medium/high volatility; others accept TVL >= 300K)
  const safeHigherPools = comparisons.filter((c) => {
    if (c.isCurrentlyHeld) return false;
    if (config.riskProfile === 'ultra-safe') {
      return c.ilRisk === '低' && c.tvlUsd >= 1_500_000;
    }
    return c.tvlUsd >= Math.min(config.minTVL, 300_000) && c.ilRisk !== '高';
  });

  const bestCandidate = safeHigherPools[0] || comparisons.find((c) => !c.isCurrentlyHeld) || null;

  // Map active positions with current APR & score
  const activeDetails = activePositions
    .filter((p) => p.injectedValueUsd > 0)
    .map((p) => {
      const matched = rankedPools.find((r) => r.id === p.poolId);
      const matchedComp = comparisons.find((c) => c.poolId === p.poolId);
      const currentApr = matched?.apr ?? 45;
      const riskAdjustedScore = matchedComp?.riskAdjustedScore ?? Number((currentApr / Math.sqrt(18)).toFixed(1));
      return {
        poolId: p.poolId,
        poolName: p.poolName,
        nftMint: p.nftMint,
        injectedValueUsd: p.injectedValueUsd,
        currentApr,
        riskAdjustedScore,
      };
    })
    .sort((a, b) => a.currentApr - b.currentApr);

  const weakestActive = activeDetails[0] || null;
  const realActiveCount = activeDetails.filter((a) => a.injectedValueUsd >= 1.5).length;

  if (!bestCandidate) {
    return {
      decision: 'HOLD_OPTIMAL',
      shouldAct: false,
      actionButtonLabel: '当前已是扫描池最优选择',
      headline: '暂无可替代的更高性价比矿池，自主决定维持现状',
      reason: '已扫描全部实时池子，未发现明显优于当前持仓的安全高收益池。',
      targetPool: null,
      sourcePositionToReplace: null,
      deployBudgetUsd: 0,
      aprGainPct: 0,
      estimatedExtraMonthlyUsd: 0,
      comparisons,
    };
  }

  const concentrationBoost =
    config.rangeWidthPct <= 4 ? 3.2 : config.rangeWidthPct <= 6 ? 2.4 : 1.6;

  // Branch 1: Smart incremental funds available AND (parallel allowed OR zero real active positions) -> OPEN_NEW directly
  if (hasIncrementalIdle && (smartAllocEnabled || realActiveCount === 0) && (parallelEnabled || realActiveCount === 0)) {
    const budget = Number(Math.min(config.lpActiveUsdt, Math.max(idleDeployableUsd, usdcBalance) * 0.88).toFixed(2));
    const baseAprRef = weakestActive ? weakestActive.currentApr : 0;
    const aprGainPct = Number(Math.max(0, bestCandidate.apr - baseAprRef).toFixed(1));
    const estimatedExtraMonthlyUsd = Number(
      (((budget * (Math.min(bestCandidate.apr, 260) / 100)) * concentrationBoost) / 12).toFixed(2)
    );
    const hasDustOnly = realActiveCount === 0 && activeDetails.some((a) => a.injectedValueUsd < 1.5);
    const usdcTriggerText =
      usdcBalance > activeInjectedTotal && activeInjectedTotal > 0
        ? `（当前 USDC $${usdcBalance.toFixed(2)} > 已注入 $${activeInjectedTotal.toFixed(2)}，已触发智能增量加仓）`
        : '';

    return {
      decision: 'OPEN_NEW',
      shouldAct: true,
      actionButtonLabel: '切换高收益池（直接用闲置资金新开）',
      headline: `检测到 $${idleDeployableUsd.toFixed(2)} 空余资金 → 多仓位并行直开【${bestCandidate.poolName}】`,
      reason: hasDustOnly
        ? `钱包有 $${idleDeployableUsd.toFixed(2)} 闲置资金且仅存微仓，系统自主决定回收微仓并直接新开高年化【${bestCandidate.poolName}】(APR +${bestCandidate.apr}% · ${bestCandidate.volatilityLabel})，预计多赚约 +$${estimatedExtraMonthlyUsd}/月。`
        : `开启多仓位并行与智能资金分配后，系统检测到空余资金$${idleDeployableUsd.toFixed(2)}${usdcTriggerText}，决定不关停现有仓位，直接分散新开【${bestCandidate.poolName}】(APR +${bestCandidate.apr}% · ${bestCandidate.volatilityLabel}) 并发加速赚币！`,
      targetPool: bestCandidate,
      sourcePositionToReplace: hasDustOnly ? weakestActive : null,
      deployBudgetUsd: budget,
      aprGainPct,
      estimatedExtraMonthlyUsd,
      comparisons,
    };
  }

  // Branch 2: Either no idle funds (< $5) OR parallel disabled with existing active position -> evaluate ROTATE_SWAP vs HOLD_OPTIMAL
  if (!weakestActive) {
    return {
      decision: 'HOLD_OPTIMAL',
      shouldAct: false,
      actionButtonLabel: '余额不足 $5，暂无法自动开仓',
      headline: `当前空仓且可用资金仅 $${idleDeployableUsd.toFixed(2)}，等待资金转入`,
      reason: `候选高收益池【${bestCandidate.poolName}】年化 +${bestCandidate.apr}%，但当前可用流动资金低于 $5 建仓下限。`,
      targetPool: bestCandidate,
      sourcePositionToReplace: null,
      deployBudgetUsd: 0,
      aprGainPct: 0,
      estimatedExtraMonthlyUsd: 0,
      comparisons,
    };
  }

  const aprGainPct = Number((bestCandidate.apr - weakestActive.currentApr).toFixed(1));
  const extraFromIdle = parallelEnabled ? 0 : idleDeployableUsd * 0.85;
  const budgetForRotate = Number((weakestActive.injectedValueUsd * 0.96 + extraFromIdle).toFixed(2));
  const extraMonthlyUsd = Number(
    (
      ((budgetForRotate * (Math.max(0, Math.min(aprGainPct, 200)) / 100)) * concentrationBoost) /
      12
    ).toFixed(2)
  );
  const worthRotating =
    aprGainPct >= 20 && bestCandidate.riskAdjustedScore >= weakestActive.riskAdjustedScore * 1.12;

  if (worthRotating) {
    return {
      decision: 'ROTATE_SWAP',
      shouldAct: true,
      actionButtonLabel: '切换高收益池（自动平旧仓换入新池）',
      headline: `${
        parallelEnabled ? '无多余闲置资金' : '单仓聚焦模式'
      }且收益提升显著 (+${aprGainPct}% APR) → 自动换仓至【${bestCandidate.poolName}】`,
      reason: `${
        parallelEnabled ? '钱包无多余闲置资金，' : '已关闭多仓位并行（专注单仓最高收益），'
      }对比【${weakestActive.poolName}】(+${weakestActive.currentApr}% APR) 与【${bestCandidate.poolName}】(+${bestCandidate.apr}% APR · ${bestCandidate.volatilityLabel})，收益差额足够覆盖撤池换币 Gas 与滑点（月净增约 +$${extraMonthlyUsd}），系统决定自动平旧仓并换入高收益池。`,
      targetPool: bestCandidate,
      sourcePositionToReplace: weakestActive,
      deployBudgetUsd: budgetForRotate,
      aprGainPct,
      estimatedExtraMonthlyUsd: extraMonthlyUsd,
      comparisons,
    };
  }

  return {
    decision: 'HOLD_OPTIMAL',
    shouldAct: false,
    actionButtonLabel: '当前持仓已是最优（暂不换仓）',
    headline: `无闲置资金且现有仓位收益比占优 → 自主决定不换仓`,
    reason: `【${bestCandidate.poolName}】相对当前仓位【${weakestActive.poolName}】年化差仅 ${
      aprGainPct >= 0 ? `+${aprGainPct}%` : `${aprGainPct}%`
    }（或波动风险偏高），频繁撤池换币反会白损 Gas 与滑点，系统自主决定继续持有当前仓位赚费。`,
    targetPool: bestCandidate,
    sourcePositionToReplace: null,
    deployBudgetUsd: 0,
    aprGainPct,
    estimatedExtraMonthlyUsd: 0,
    comparisons,
  };
}

export type RebalanceTriggerType =
  | 'BALANCED'
  | 'DEPTH_DROP_REDUCE'
  | 'SHARE_DRIFT_REBALANCE'
  | 'PAUSED';

export interface RebalancePositionAllocation {
  poolId: string;
  poolName: string;
  nftMint?: string;
  currentUsd: number;
  currentSharePct: number;
  targetSharePct: number;
  driftPct: number;
  poolTvlUsd: number;
  baselineTvlUsd: number;
  tvlChangePct: number;
  inRange: boolean;
  needsAdjustment: boolean;
  actionNote: string;
}

export interface AutoRebalancePlan {
  enabled: boolean;
  shouldRebalance: boolean;
  triggerType: RebalanceTriggerType;
  driftThresholdPct: number;
  depthDropThresholdPct: number;
  maxAbsDriftPct: number;
  maxDepthDropPct: number;
  headline: string;
  reason: string;
  sourcePositionToTrim: {
    poolId: string;
    poolName: string;
    nftMint?: string;
    currentUsd: number;
    reduceUsd: number;
    closeFull: boolean;
  } | null;
  targetPoolToBoost: {
    poolId: string;
    poolName: string;
    boostUsd: number;
  } | null;
  allocations: RebalancePositionAllocation[];
}

export function evaluateAutoAssetRebalance(params: {
  activePositions: Array<{
    poolId: string;
    poolName: string;
    nftMint?: string;
    injectedValueUsd: number;
    inRange?: boolean;
  }>;
  rankedPools: ScoredPool[];
  baselinePoolTvls?: Record<string, number>;
  config: StrategyConfig;
}): AutoRebalancePlan {
  const { activePositions, rankedPools, baselinePoolTvls = {}, config } = params;
  const enabled = config.autoAssetRebalance !== false;
  const driftThresholdPct = Math.max(8, Math.min(35, config.rebalanceDriftThresholdPct || 15));
  const depthDropThresholdPct = 25;

  const realPositions = activePositions.filter((p) => p.injectedValueUsd >= 1.5);
  const totalActiveUsd = realPositions.reduce((s, p) => s + p.injectedValueUsd, 0);

  // Compute optimal target shares across active positions (weighted by core/satellite role & risk-adjusted TVL)
  const rawWeights = realPositions.map((pos) => {
    const matched = rankedPools.find((r) => r.id === pos.poolId);
    const isCore = pos.poolName.toUpperCase().includes('WSOL / USDC') || matched?.poolRole === 'core';
    if (realPositions.length === 1) return 100;
    if (isCore) {
      return Math.max(35, Math.min(65, config.coreSplitPct < 100 ? config.coreSplitPct : 50));
    }
    const tvlBoost = matched && matched.tvl >= 2_000_000 ? 1.1 : 1.0;
    return 40 * tvlBoost;
  });
  const sumWeights = rawWeights.reduce((a, b) => a + b, 0) || 1;

  const allocations: RebalancePositionAllocation[] = realPositions.map((pos, idx) => {
    const matched = rankedPools.find((r) => r.id === pos.poolId);
    const poolTvlUsd = matched?.tvl ?? 0;
    const baselineTvlUsd = baselinePoolTvls[pos.poolId] || poolTvlUsd;
    const tvlChangePct =
      baselineTvlUsd > 0 && poolTvlUsd > 0
        ? Number((((poolTvlUsd - baselineTvlUsd) / baselineTvlUsd) * 100).toFixed(1))
        : 0;
    const currentSharePct =
      totalActiveUsd > 0 ? Number(((pos.injectedValueUsd / totalActiveUsd) * 100).toFixed(1)) : 0;
    const targetSharePct = Number(((rawWeights[idx] / sumWeights) * 100).toFixed(1));
    const driftPct = Number((currentSharePct - targetSharePct).toFixed(1));

    const severeDepthDrop =
      (poolTvlUsd > 0 && tvlChangePct <= -depthDropThresholdPct) ||
      (poolTvlUsd > 0 && poolTvlUsd < Math.min(config.minTVL * 0.6, 250_000));
    const driftExceeded = realPositions.length >= 2 && Math.abs(driftPct) >= driftThresholdPct;

    let actionNote = '比例健康';
    if (severeDepthDrop) {
      actionNote = `池深骤降 (${tvlChangePct}%) · 需撤出重配`;
    } else if (driftExceeded) {
      actionNote =
        driftPct > 0
          ? `超配 +${driftPct}% · 待减仓配平`
          : `低配 ${driftPct}% · 待增补配平`;
    } else if (pos.inRange === false) {
      actionNote = '区间越界 · 待校准';
    }

    return {
      poolId: pos.poolId,
      poolName: pos.poolName,
      nftMint: pos.nftMint,
      currentUsd: Number(pos.injectedValueUsd.toFixed(2)),
      currentSharePct,
      targetSharePct,
      driftPct,
      poolTvlUsd,
      baselineTvlUsd,
      tvlChangePct,
      inRange: pos.inRange !== false,
      needsAdjustment: severeDepthDrop || driftExceeded,
      actionNote,
    };
  });

  const maxAbsDriftPct = allocations.reduce(
    (m, a) => Math.max(m, Math.abs(a.driftPct)),
    0
  );
  const maxDepthDropPct = allocations.reduce(
    (m, a) => (a.tvlChangePct < 0 ? Math.max(m, Math.abs(a.tvlChangePct)) : m),
    0
  );

  if (!enabled) {
    return {
      enabled: false,
      shouldRebalance: false,
      triggerType: 'PAUSED',
      driftThresholdPct,
      depthDropThresholdPct,
      maxAbsDriftPct: Number(maxAbsDriftPct.toFixed(1)),
      maxDepthDropPct: Number(maxDepthDropPct.toFixed(1)),
      headline: '自动资产重平衡已暂停（仅监测仓位占比与池深变化）',
      reason: '开启后当仓位占比偏离超过 ±' + driftThresholdPct + '% 或池子深度骤降 ≥25% 时将全自动调仓。',
      sourcePositionToTrim: null,
      targetPoolToBoost: null,
      allocations,
    };
  }

  if (realPositions.length === 0) {
    return {
      enabled: true,
      shouldRebalance: false,
      triggerType: 'BALANCED',
      driftThresholdPct,
      depthDropThresholdPct,
      maxAbsDriftPct: 0,
      maxDepthDropPct: 0,
      headline: '自动重平衡守护已就绪（当前空仓，建仓后自动维持多池比例）',
      reason: `实时监控各仓位流动性占比（阈值 ±${driftThresholdPct}%）与池子深度波动（骤降 ≥${depthDropThresholdPct}% 自动移仓），无需手动干预。`,
      sourcePositionToTrim: null,
      targetPoolToBoost: null,
      allocations: [],
    };
  }

  // Priority 1: Severe pool liquidity/TVL depth drop on an active position
  const depthShockPos = allocations
    .filter(
      (a) =>
        (a.poolTvlUsd > 0 && a.tvlChangePct <= -depthDropThresholdPct) ||
        (a.poolTvlUsd > 0 && a.poolTvlUsd < Math.min(config.minTVL * 0.6, 250_000))
    )
    .sort((a, b) => a.tvlChangePct - b.tvlChangePct)[0];

  if (depthShockPos) {
    const safeAlternative =
      rankedPools
        .filter(
          (r) =>
            r.id !== depthShockPos.poolId &&
            r.tvl >= Math.max(300_000, config.minTVL * 0.8) &&
            r.ilRisk !== '高' &&
            (r.name.toUpperCase().includes('USDC') || r.name.toUpperCase().includes('SOL'))
        )
        .sort((a, b) => b.alphaScore - a.alphaScore)[0] ||
      allocations
        .filter((a) => a.poolId !== depthShockPos.poolId)
        .map((a) => ({ id: a.poolId, name: a.poolName }))[0];

    return {
      enabled: true,
      shouldRebalance: Boolean(safeAlternative),
      triggerType: 'DEPTH_DROP_REDUCE',
      driftThresholdPct,
      depthDropThresholdPct,
      maxAbsDriftPct: Number(maxAbsDriftPct.toFixed(1)),
      maxDepthDropPct: Number(maxDepthDropPct.toFixed(1)),
      headline: `池深剧烈下降 (${depthShockPos.poolName} ${depthShockPos.tvlChangePct}%) → 自动抽离并重平衡`,
      reason: `监测到【${depthShockPos.poolName}】池子深度出现剧烈缩水（变化 ${depthShockPos.tvlChangePct}%，当前 TVL $${Math.round(depthShockPos.poolTvlUsd / 1000)}K），系统无需人工确认自动撤出该仓位 $${depthShockPos.currentUsd.toFixed(2)} 并重分配至高深度池【${safeAlternative?.name || 'WSOL / USDC'}】。`,
      sourcePositionToTrim: {
        poolId: depthShockPos.poolId,
        poolName: depthShockPos.poolName,
        nftMint: depthShockPos.nftMint,
        currentUsd: depthShockPos.currentUsd,
        reduceUsd: depthShockPos.currentUsd,
        closeFull: true,
      },
      targetPoolToBoost: safeAlternative
        ? {
            poolId: safeAlternative.id,
            poolName: safeAlternative.name,
            boostUsd: Number((depthShockPos.currentUsd * 0.96).toFixed(2)),
          }
        : null,
      allocations,
    };
  }

  // Priority 2: Parallel allocation share drift exceeds threshold
  if (realPositions.length >= 2) {
    const overweight = [...allocations].sort((a, b) => b.driftPct - a.driftPct)[0];
    const underweight = [...allocations].sort((a, b) => a.driftPct - b.driftPct)[0];

    if (
      overweight &&
      underweight &&
      overweight.poolId !== underweight.poolId &&
      overweight.driftPct >= driftThresholdPct &&
      overweight.currentUsd >= 8
    ) {
      const targetUsdForOverweight = Number(
        ((totalActiveUsd * overweight.targetSharePct) / 100).toFixed(2)
      );
      const reduceUsd = Number(Math.max(3, overweight.currentUsd - targetUsdForOverweight).toFixed(2));
      return {
        enabled: true,
        shouldRebalance: true,
        triggerType: 'SHARE_DRIFT_REBALANCE',
        driftThresholdPct,
        depthDropThresholdPct,
        maxAbsDriftPct: Number(maxAbsDriftPct.toFixed(1)),
        maxDepthDropPct: Number(maxDepthDropPct.toFixed(1)),
        headline: `并行仓位占比偏离达 ${overweight.driftPct}% → 自动重平衡资金比例`,
        reason: `【${overweight.poolName}】当前占总仓位 ${overweight.currentSharePct}%（超出目标 ${overweight.targetSharePct}% 阈值 ±${driftThresholdPct}%），而【${underweight.poolName}】仅占 ${underweight.currentSharePct}%，系统自动调出约 $${reduceUsd.toFixed(2)} 补足低配仓位以恢复最优平衡比例。`,
        sourcePositionToTrim: {
          poolId: overweight.poolId,
          poolName: overweight.poolName,
          nftMint: overweight.nftMint,
          currentUsd: overweight.currentUsd,
          reduceUsd,
          closeFull: false,
        },
        targetPoolToBoost: {
          poolId: underweight.poolId,
          poolName: underweight.poolName,
          boostUsd: Number((reduceUsd * 0.96).toFixed(2)),
        },
        allocations,
      };
    }
  }

  return {
    enabled: true,
    shouldRebalance: false,
    triggerType: 'BALANCED',
    driftThresholdPct,
    depthDropThresholdPct,
    maxAbsDriftPct: Number(maxAbsDriftPct.toFixed(1)),
    maxDepthDropPct: Number(maxDepthDropPct.toFixed(1)),
    headline: `全仓比例与池深稳健（最大偏离 ${maxAbsDriftPct.toFixed(1)}% ≤ ±${driftThresholdPct}%）`,
    reason: `当前 ${realPositions.length} 个并行仓位资金比例均在最优分配阈值内，各池 TVL 深度正常，无需无效换仓损耗 Gas。`,
    sourcePositionToTrim: null,
    targetPoolToBoost: null,
    allocations,
  };
}

export type SafeWithdrawTriggerType =
  | 'SAFE_HOLD'
  | 'LIQUIDITY_DEPLETION'
  | 'IL_THRESHOLD_EXCEEDED'
  | 'PAUSED';

export interface SafeWithdrawPositionRisk {
  poolId: string;
  poolName: string;
  nftMint?: string;
  currentUsd: number;
  estimatedIlPct: number;
  poolTvlUsd: number;
  baselineTvlUsd: number;
  tvlDropPct: number;
  volTvlRatio: number;
  depletionTicks: number;
  inRange: boolean;
  breachType: 'NONE' | 'LIQUIDITY_DEPLETION' | 'IL_THRESHOLD_EXCEEDED';
  shouldWithdraw: boolean;
  reason: string;
}

export interface SafeWithdrawPlan {
  enabled: boolean;
  shouldAutoWithdraw: boolean;
  triggerType: SafeWithdrawTriggerType;
  maxILTolerancePct: number;
  depletionTvlDropPct: number;
  persistentTicksRequired: number;
  maxObservedIlPct: number;
  maxDepletionTicks: number;
  headline: string;
  reason: string;
  positionsAtRisk: SafeWithdrawPositionRisk[];
}

export function evaluateSafeWithdrawSafety(params: {
  activePositions: Array<{
    poolId: string;
    poolName: string;
    nftMint?: string;
    injectedValueUsd: number;
    priceCurrentUsd?: number;
    priceLowerUsd?: number;
    priceUpperUsd?: number;
    unrealizedPnlPct?: number;
    inRange?: boolean;
  }>;
  rankedPools: ScoredPool[];
  baselinePoolTvls?: Record<string, number>;
  depletionStreaks?: Record<string, number>;
  config: StrategyConfig;
}): SafeWithdrawPlan {
  const {
    activePositions,
    rankedPools,
    baselinePoolTvls = {},
    depletionStreaks = {},
    config,
  } = params;

  const enabled = config.autoWithdrawSafety !== false;
  const maxILTolerancePct = Math.max(0.5, Number(config.maxILTolerance || 2.5));
  const depletionTvlDropPct = 25;
  const persistentTicksRequired = 2;

  const realPositions = activePositions.filter((p) => p.injectedValueUsd >= 1.5);

  const evaluated: SafeWithdrawPositionRisk[] = realPositions.map((pos) => {
    const matched = rankedPools.find((r) => r.id === pos.poolId);
    const poolTvlUsd = matched?.tvl ?? 0;
    const baselineTvlUsd = baselinePoolTvls[pos.poolId] || poolTvlUsd;
    const tvlDropPct =
      baselineTvlUsd > 0 && poolTvlUsd > 0 && poolTvlUsd < baselineTvlUsd
        ? Number((((baselineTvlUsd - poolTvlUsd) / baselineTvlUsd) * 100).toFixed(1))
        : 0;
    const volTvlRatio =
      matched && poolTvlUsd > 0 ? Number((matched.volume24h / poolTvlUsd).toFixed(2)) : 0;

    // Estimate concentrated CLMM IL from price deviation relative to range midpoint & negative PnL
    let concentratedIlPct = 0;
    const lower = Number(pos.priceLowerUsd || 0);
    const upper = Number(pos.priceUpperUsd || 0);
    const curr = Number(pos.priceCurrentUsd || 0);
    if (lower > 0 && upper > lower && curr > 0) {
      const mid = (lower + upper) / 2;
      const ratio = mid > 0 ? curr / mid : 1;
      const baseIl = Math.abs(calculateImpermanentLossPct(ratio));
      // Concentrated liquidity amplifies IL inversely with relative range width
      const halfSpanPct = Math.max(2, ((upper - lower) / (2 * mid)) * 100);
      const concentrationFactor = Math.min(3.5, Math.max(1, 25 / halfSpanPct));
      concentratedIlPct = Number((baseIl * concentrationFactor).toFixed(2));
    }
    const drawdownIlFloor =
      typeof pos.unrealizedPnlPct === 'number' && pos.unrealizedPnlPct < 0
        ? Math.abs(pos.unrealizedPnlPct)
        : 0;
    const estimatedIlPct = Number(
      Math.max(concentratedIlPct, drawdownIlFloor).toFixed(2)
    );

    const isLiquidityDepletingNow =
      (poolTvlUsd > 0 && tvlDropPct >= depletionTvlDropPct) ||
      (poolTvlUsd > 0 && poolTvlUsd < Math.min(config.minTVL * 0.5, 250_000)) ||
      (pos.inRange === false && poolTvlUsd > 0 && volTvlRatio < 0.05);

    const streakCount =
      depletionStreaks[pos.poolId] ?? (isLiquidityDepletingNow ? 1 : 0);
    const persistentDepletion = isLiquidityDepletingNow && streakCount >= persistentTicksRequired;
    const ilExceeded = estimatedIlPct >= maxILTolerancePct;

    let breachType: SafeWithdrawPositionRisk['breachType'] = 'NONE';
    let shouldWithdraw = false;
    let reason = `流动性深度与无常损失均正常（IL ${estimatedIlPct.toFixed(2)}% < 阈值 ${maxILTolerancePct}%）`;

    if (persistentDepletion) {
      breachType = 'LIQUIDITY_DEPLETION';
      shouldWithdraw = true;
      reason = `连续 ${streakCount} 轮检测到池子流动性枯竭（TVL 回撤 ${tvlDropPct}%，当前 $${Math.round(poolTvlUsd / 1000)}K），触发自动撤池转 USDC`;
    } else if (ilExceeded) {
      breachType = 'IL_THRESHOLD_EXCEEDED';
      shouldWithdraw = true;
      reason = `估算无常损失/回撤达 ${estimatedIlPct.toFixed(2)}%，超过安全阈值 ${maxILTolerancePct}%，触发自动撤池并兑换 USDC 落袋`;
    } else if (isLiquidityDepletingNow) {
      reason = `流动性出现第 ${streakCount}/${persistentTicksRequired} 轮萎缩预警（连续达标将自动撤池转 USDC）`;
    }

    return {
      poolId: pos.poolId,
      poolName: pos.poolName,
      nftMint: pos.nftMint,
      currentUsd: Number(pos.injectedValueUsd.toFixed(2)),
      estimatedIlPct,
      poolTvlUsd,
      baselineTvlUsd,
      tvlDropPct,
      volTvlRatio,
      depletionTicks: streakCount,
      inRange: pos.inRange !== false,
      breachType,
      shouldWithdraw,
      reason,
    };
  });

  evaluated.sort((a, b) => Number(b.shouldWithdraw) - Number(a.shouldWithdraw) || b.estimatedIlPct - a.estimatedIlPct);

  const maxObservedIlPct = evaluated.reduce((m, p) => Math.max(m, p.estimatedIlPct), 0);
  const maxDepletionTicks = evaluated.reduce((m, p) => Math.max(m, p.depletionTicks), 0);

  if (!enabled) {
    return {
      enabled: false,
      shouldAutoWithdraw: false,
      triggerType: 'PAUSED',
      maxILTolerancePct,
      depletionTvlDropPct,
      persistentTicksRequired,
      maxObservedIlPct: Number(maxObservedIlPct.toFixed(2)),
      maxDepletionTicks,
      headline: '自动安全回撤守护已暂停（仍可随时点击一键安全回撤转 USDC）',
      reason: `当前仅实时监测各仓位流动性枯竭与无常损失（IL 阈值 ${maxILTolerancePct}%），手动点击「一键安全回撤」仍可立即全部撤出并转为 USDC。`,
      positionsAtRisk: evaluated,
    };
  }

  if (realPositions.length === 0) {
    return {
      enabled: true,
      shouldAutoWithdraw: false,
      triggerType: 'SAFE_HOLD',
      maxILTolerancePct,
      depletionTvlDropPct,
      persistentTicksRequired,
      maxObservedIlPct: 0,
      maxDepletionTicks: 0,
      headline: `安全回撤守护已就绪（IL 熔断 ${maxILTolerancePct}% · 持续枯竭 ≥${persistentTicksRequired} 轮）`,
      reason: '当前暂无在池活跃仓位，建仓后一旦遇到持续流动性枯竭或无常损失超限，将自动撤出全部资产并兑换为 USDC 存入钱包。',
      positionsAtRisk: [],
    };
  }

  const depletionBreach = evaluated.find((p) => p.breachType === 'LIQUIDITY_DEPLETION');
  if (depletionBreach) {
    return {
      enabled: true,
      shouldAutoWithdraw: true,
      triggerType: 'LIQUIDITY_DEPLETION',
      maxILTolerancePct,
      depletionTvlDropPct,
      persistentTicksRequired,
      maxObservedIlPct: Number(maxObservedIlPct.toFixed(2)),
      maxDepletionTicks,
      headline: `检测到持续流动性枯竭（${depletionBreach.poolName}）→ 自动安全回撤并转存 USDC`,
      reason: depletionBreach.reason,
      positionsAtRisk: evaluated,
    };
  }

  const ilBreach = evaluated.find((p) => p.breachType === 'IL_THRESHOLD_EXCEEDED');
  if (ilBreach) {
    return {
      enabled: true,
      shouldAutoWithdraw: true,
      triggerType: 'IL_THRESHOLD_EXCEEDED',
      maxILTolerancePct,
      depletionTvlDropPct,
      persistentTicksRequired,
      maxObservedIlPct: Number(maxObservedIlPct.toFixed(2)),
      maxDepletionTicks,
      headline: `无常损失超阈值（${ilBreach.poolName} IL ${ilBreach.estimatedIlPct.toFixed(2)}% ≥ ${maxILTolerancePct}%）→ 自动安全回撤并转存 USDC`,
      reason: ilBreach.reason,
      positionsAtRisk: evaluated,
    };
  }

  return {
    enabled: true,
    shouldAutoWithdraw: false,
    triggerType: 'SAFE_HOLD',
    maxILTolerancePct,
    depletionTvlDropPct,
    persistentTicksRequired,
    maxObservedIlPct: Number(maxObservedIlPct.toFixed(2)),
    maxDepletionTicks,
    headline: `仓位安全稳健（最高 IL ${maxObservedIlPct.toFixed(2)}% < 阈值 ${maxILTolerancePct}%）`,
    reason: `已监控 ${evaluated.length} 个活跃仓位，流动性深度与无常损失均处于安全线内；如需落袋避险，可随时点击「一键安全回撤（转 USDC）」。`,
    positionsAtRisk: evaluated,
  };
}

export interface PositionRangeDeviation {
  poolId: string;
  poolName: string;
  nftMint?: string;
  currentPriceUsd: number;
  rangeLowerUsd: number;
  rangeUpperUsd: number;
  rangeMidUsd: number;
  /** Signed % offset from range midpoint: 0% = dead center, ±100% = boundary edge, >±100% = out of range */
  rangeOffsetPct: number;
  absOffsetPct: number;
  inRange: boolean;
  cumulativePnlUsd: number;
  uncollectedFeeUsd: number;
  needsIntervention: boolean;
  interventionHint: string;
}

export function computePositionRangeDeviation(pos: {
  poolId: string;
  poolName: string;
  nftMint?: string;
  priceCurrentUsd: number;
  priceLowerUsd: number;
  priceUpperUsd: number;
  inRange?: boolean;
  unrealizedPnlUsd: number;
  uncollectedFeeUsd: number;
}): PositionRangeDeviation {
  const lower = Math.min(pos.priceLowerUsd || 0, pos.priceUpperUsd || 0);
  const upper = Math.max(pos.priceLowerUsd || 0, pos.priceUpperUsd || 0);
  const current = Number(pos.priceCurrentUsd || 0);
  const mid = lower > 0 && upper > lower ? (lower + upper) / 2 : current;
  const halfWidth = upper > lower ? (upper - lower) / 2 : 0;

  let rangeOffsetPct = 0;
  if (halfWidth > 0 && current > 0) {
    rangeOffsetPct = Number((((current - mid) / halfWidth) * 100).toFixed(1));
  }
  const absOffsetPct = Number(Math.abs(rangeOffsetPct).toFixed(1));
  const inRange =
    typeof pos.inRange === 'boolean'
      ? pos.inRange
      : lower > 0 && upper > lower
      ? current >= lower && current <= upper
      : true;

  const needsIntervention = !inRange || absOffsetPct >= 75;
  let interventionHint = '处于做市区间核心区 · 无需介入';
  if (!inRange) {
    interventionHint = `价格已偏离区间 (${rangeOffsetPct > 0 ? '+' : ''}${rangeOffsetPct}%) · 暂停计息，建议自动重设区间`;
  } else if (absOffsetPct >= 75) {
    interventionHint = `接近区间边界 (${rangeOffsetPct > 0 ? '+' : ''}${rangeOffsetPct}%) · 关注是否重平衡`;
  }

  return {
    poolId: pos.poolId,
    poolName: pos.poolName,
    nftMint: pos.nftMint,
    currentPriceUsd: Number(current.toFixed(4)),
    rangeLowerUsd: Number(lower.toFixed(4)),
    rangeUpperUsd: Number(upper.toFixed(4)),
    rangeMidUsd: Number(mid.toFixed(4)),
    rangeOffsetPct,
    absOffsetPct,
    inRange,
    cumulativePnlUsd: Number((pos.unrealizedPnlUsd || 0).toFixed(2)),
    uncollectedFeeUsd: Number((pos.uncollectedFeeUsd || 0).toFixed(3)),
    needsIntervention,
    interventionHint,
  };
}

export type AutoCompoundStatus = 'COMPOUND_READY' | 'MONITORING' | 'PAUSED';

export interface AutoCompoundTarget {
  poolId: string;
  poolName: string;
  nftMint: string;
  uncollectedFeeUsd: number;
  injectedValueUsd: number;
}

export interface AutoCompoundPlan {
  enabled: boolean;
  status: AutoCompoundStatus;
  shouldCompound: boolean;
  harvestMinUsd: number;
  totalPendingYieldUsd: number;
  estimatedApyBoostPct: number;
  headline: string;
  reason: string;
  targets: AutoCompoundTarget[];
}

export function evaluateAutoCompoundOpportunity(params: {
  activePositions: Array<{
    poolId: string;
    poolName: string;
    nftMint?: string;
    uncollectedFeeUsd: number;
    injectedValueUsd: number;
  }>;
  config: StrategyConfig;
  referenceAprPct?: number;
}): AutoCompoundPlan {
  const { activePositions, config, referenceAprPct = 58 } = params;
  const enabled = config.autoCompound !== false;
  const harvestMinUsd = Math.max(0.25, Number(config.harvestMinUsd || 1.5));
  const realPositions = activePositions.filter((p) => p.injectedValueUsd > 0 && p.nftMint);
  const totalPendingYieldUsd = Number(
    realPositions.reduce((sum, p) => sum + Math.max(0, p.uncollectedFeeUsd || 0), 0).toFixed(3)
  );

  // Continuous compounding snowball lift vs simple APR: (1 + r/n)^n - 1 - r
  const r = Math.min(3.5, Math.max(0.1, referenceAprPct / 100));
  const estimatedApyBoostPct = enabled
    ? Number((((Math.pow(1 + r / 52, 52) - 1) - r) * 100).toFixed(1))
    : 0;

  if (!enabled) {
    return {
      enabled: false,
      status: 'PAUSED',
      shouldCompound: false,
      harvestMinUsd,
      totalPendingYieldUsd,
      estimatedApyBoostPct: 0,
      headline: `自动复利模式已暂停（当前待收取收益 $${totalPendingYieldUsd.toFixed(3)}）`,
      reason: '关闭自动复利后，手续费耕作收益将留在仓位内累积而不自动领取再注入。开启即可恢复 APY 滚雪球复投。',
      targets: [],
    };
  }

  const readyTargets: AutoCompoundTarget[] = realPositions
    .filter((p) => (p.uncollectedFeeUsd || 0) >= harvestMinUsd)
    .map((p) => ({
      poolId: p.poolId,
      poolName: p.poolName,
      nftMint: p.nftMint!,
      uncollectedFeeUsd: Number(p.uncollectedFeeUsd.toFixed(3)),
      injectedValueUsd: Number(p.injectedValueUsd.toFixed(2)),
    }));

  // Also trigger portfolio-wide if combined pending yield across parallel positions exceeds threshold
  const allActiveTargets: AutoCompoundTarget[] =
    readyTargets.length > 0
      ? readyTargets
      : totalPendingYieldUsd >= harvestMinUsd
      ? realPositions
          .filter((p) => (p.uncollectedFeeUsd || 0) > 0)
          .map((p) => ({
            poolId: p.poolId,
            poolName: p.poolName,
            nftMint: p.nftMint!,
            uncollectedFeeUsd: Number(p.uncollectedFeeUsd.toFixed(3)),
            injectedValueUsd: Number(p.injectedValueUsd.toFixed(2)),
          }))
      : [];

  if (allActiveTargets.length > 0) {
    return {
      enabled: true,
      status: 'COMPOUND_READY',
      shouldCompound: true,
      harvestMinUsd,
      totalPendingYieldUsd,
      estimatedApyBoostPct,
      headline: `检测到 $${totalPendingYieldUsd.toFixed(2)} 待收耕作收益 → 触发自动领取并复投`,
      reason: `待收取手续费已达到 $${harvestMinUsd.toFixed(2)} 复利起投线（覆盖 Solana Gas 后净正收益），系统将全自动领取并重新注入流动性放大复利滚雪球。`,
      targets: allActiveTargets,
    };
  }

  return {
    enabled: true,
    status: 'MONITORING',
    shouldCompound: false,
    harvestMinUsd,
    totalPendingYieldUsd,
    estimatedApyBoostPct,
    headline:
      realPositions.length > 0
        ? `自动复利监听中：待收收益 $${totalPendingYieldUsd.toFixed(3)} / 起投线 $${harvestMinUsd.toFixed(2)}`
        : `自动复利模式已开启（起投线 $${harvestMinUsd.toFixed(2)} · 滚雪球增益 +${estimatedApyBoostPct}% APY）`,
    reason:
      realPositions.length > 0
        ? `当前待收取耕作收益尚未达到 $${harvestMinUsd.toFixed(2)} 复利起投阈值，系统继续免 Gas 累计手续费，达标后即刻自动复投。`
        : '建仓产生做市手续费并达到复利起投阈值后，将自动触发领取并重注入（Auto-Compound）。',
    targets: [],
  };
}

export interface SolanaLendingReserve {
  protocol: 'Kamino Finance' | 'Solend (Save)';
  marketAddress: string;
  reserveAddress: string;
  symbol: string;
  mint: string;
  maxLtv: number;
  borrowApyPct: number;
  supplyApyPct: number;
  totalSupplyUsd: number;
  totalBorrowUsd: number;
  pythOracle?: string;
  switchboardOracle?: string;
  supplyPubkey?: string;
  collateralMint?: string;
  collateralSupplyPubkey?: string;
  feeReceiver?: string;
  decimals?: number;
}

export type HedgeLegMode =
  | 'DIRECT_BORROW_SHORT'
  | 'SOL_BETA_PROXY_SHORT'
  | 'STABLE_EXEMPT'
  | 'UNAVAILABLE';

export interface TokenExposureLeg {
  symbol: string;
  mint: string;
  lpExposureAmount: number;
  lpExposureUsd: number;
  hedgeMode: HedgeLegMode;
  lendingProtocol: string;
  borrowReserveSymbol: string;
  borrowReserveAddress: string;
  borrowMint: string;
  targetShortUsd: number;
  targetBorrowAmount: number;
  requiredCollateralUsdc: number;
  targetLtvPct: number;
  borrowApyPct: number;
  collateralSupplyApyPct: number;
  netCarryAprPct: number;
  ilEliminationPct: number;
  statusLabel: string;
  reason: string;
}

export type MultiCurrencyHedgeStatus =
  | 'HEDGED_NEUTRAL'
  | 'HEDGE_READY'
  | 'INSUFFICIENT_COLLATERAL'
  | 'MONITORING'
  | 'PAUSED';

export interface MultiCurrencyHedgePlan {
  enabled: boolean;
  status: MultiCurrencyHedgeStatus;
  shouldExecuteHedge: boolean;
  lendingProtocolLabel: string;
  totalVolatileExposureUsd: number;
  totalShortTargetUsd: number;
  requiredUsdcCollateralUsd: number;
  availableUsdcCollateralUsd: number;
  activeShortDebtUsd: number;
  activeCollateralUsd: number;
  netDeltaPct: number;
  ilEliminatedPct: number;
  weightedBorrowCostAprPct: number;
  collateralEarnAprPct: number;
  netCarryAprPct: number;
  headline: string;
  reason: string;
  legs: TokenExposureLeg[];
  supportedReservesCount: number;
  topBorrowReserves: Array<{
    protocol: string;
    symbol: string;
    borrowApyPct: number;
    supplyApyPct: number;
    maxLtvPct: number;
    tvlUsd: number;
  }>;
}

const HEDGE_STABLE_SYMBOLS = new Set([
  'USDC',
  'USDT',
  'PYUSD',
  'USDS',
  'USD1',
  'USDG',
  'UXD',
  'EURC',
]);

function normalizeHedgeSymbol(sym: string): string {
  const up = (sym || '').trim().toUpperCase();
  if (up === 'WSOL') return 'SOL';
  if (up === 'WETH') return 'ETH';
  if (up === 'WBTC') return 'cbBTC'.toUpperCase();
  return up;
}

export function evaluateMultiCurrencyHedgePlan(params: {
  activePositions: Array<{
    poolId: string;
    poolName: string;
    tokenASymbol: string;
    tokenBSymbol: string;
    tokenAAmount: number;
    tokenBAmount: number;
    priceCurrentUsd: number;
    injectedValueUsd: number;
  }>;
  reserves: SolanaLendingReserve[];
  walletUsdcBalance: number;
  solPriceUsd?: number;
  activeShortDebtUsd?: number;
  activeCollateralUsd?: number;
  config: StrategyConfig;
}): MultiCurrencyHedgePlan {
  const {
    activePositions,
    reserves,
    walletUsdcBalance,
    solPriceUsd = 85,
    activeShortDebtUsd = 0,
    activeCollateralUsd = 0,
    config,
  } = params;

  const enabled = config.multiCurrencyHedge !== false;
  const availableUsdcCollateralUsd = Number(Math.max(0, walletUsdcBalance || 0).toFixed(2));
  const cleanDebtUsd = Number(Math.max(0, activeShortDebtUsd || 0).toFixed(2));
  const cleanCollUsd = Number(Math.max(0, activeCollateralUsd || 0).toFixed(2));

  // Best reserve per normalized symbol (lowest borrow APY among liquid reserves >= $100K TVL)
  const reserveBySym = new Map<string, SolanaLendingReserve>();
  for (const r of reserves) {
    const key = normalizeHedgeSymbol(r.symbol);
    const existing = reserveBySym.get(key);
    const rLiquid = r.totalSupplyUsd >= 100_000;
    const exLiquid = existing ? existing.totalSupplyUsd >= 100_000 : false;
    if (
      !existing ||
      (rLiquid && !exLiquid) ||
      (rLiquid === exLiquid && r.borrowApyPct < existing.borrowApyPct)
    ) {
      reserveBySym.set(key, r);
    }
  }

  const usdcReserve = reserveBySym.get('USDC');
  const collateralEarnAprPct = Number((usdcReserve?.supplyApyPct ?? 4.15).toFixed(2));
  const solReserve = reserveBySym.get('SOL');

  const topBorrowReserves = Array.from(reserveBySym.values())
    .filter((r) => r.totalSupplyUsd >= 500_000)
    .sort((a, b) => b.totalSupplyUsd - a.totalSupplyUsd)
    .slice(0, 6)
    .map((r) => ({
      protocol: r.protocol,
      symbol: r.symbol,
      borrowApyPct: Number(r.borrowApyPct.toFixed(2)),
      supplyApyPct: Number(r.supplyApyPct.toFixed(2)),
      maxLtvPct: Math.round((r.maxLtv || 0.7) * 100),
      tvlUsd: Math.round(r.totalSupplyUsd),
    }));

  const lendingProtocolLabel =
    reserves.some((r) => r.protocol === 'Solend (Save)') &&
    reserves.some((r) => r.protocol === 'Kamino Finance')
      ? 'Solend (Save) + Kamino Finance 实时利率优选'
      : reserves[0]?.protocol || 'Kamino Finance / Solend 原生借贷';

  if (!enabled) {
    return {
      enabled: false,
      status: 'PAUSED',
      shouldExecuteHedge: false,
      lendingProtocolLabel,
      totalVolatileExposureUsd: 0,
      totalShortTargetUsd: 0,
      requiredUsdcCollateralUsd: 0,
      availableUsdcCollateralUsd,
      activeShortDebtUsd: cleanDebtUsd,
      activeCollateralUsd: cleanCollUsd,
      netDeltaPct: activePositions.some((p) => p.injectedValueUsd > 0) ? 100 : 0,
      ilEliminatedPct: 0,
      weightedBorrowCostAprPct: 0,
      collateralEarnAprPct,
      netCarryAprPct: collateralEarnAprPct,
      headline: '多币种空头对冲已暂停（当前承担 100% 币价方向性波动与无常损失风险）',
      reason:
        '开启「多币种对冲」后，系统将自动扫描所有活跃 LP 仓位的非稳定币多头敞口，并在 Solana 原生借贷协议存入 USDC 抵押借出等值空头头寸兑回稳定币，构建 Delta-Neutral 中性策略消除无常损失。',
      legs: [],
      supportedReservesCount: reserveBySym.size,
      topBorrowReserves,
    };
  }

  // Aggregate per-symbol exposure across all active LP positions >= $0.5
  const exposureBySymbol = new Map<
    string,
    { rawSymbol: string; amount: number; usd: number }
  >();

  for (const pos of activePositions) {
    if ((pos.injectedValueUsd || 0) <= 0) continue;
    const symA = (pos.tokenASymbol || 'WSOL').toUpperCase();
    const symB = (pos.tokenBSymbol || 'USDC').toUpperCase();
    const isStableA = HEDGE_STABLE_SYMBOLS.has(symA);
    const isStableB = HEDGE_STABLE_SYMBOLS.has(symB);
    const isSolA = symA === 'SOL' || symA === 'WSOL';
    const isSolB = symB === 'SOL' || symB === 'WSOL';
    const price = Number(pos.priceCurrentUsd || 0);

    let valA = 0;
    let valB = 0;
    if (isStableB) {
      valA = (pos.tokenAAmount || 0) * Math.max(price, 0);
      valB = pos.tokenBAmount || 0;
    } else if (isStableA) {
      valA = pos.tokenAAmount || 0;
      valB = price > 0 ? (pos.tokenBAmount || 0) / price : 0;
    } else if (isSolA && solPriceUsd > 0) {
      valA = (pos.tokenAAmount || 0) * solPriceUsd;
      valB = price > 0 ? (pos.tokenBAmount || 0) * (solPriceUsd / price) : 0;
    } else if (isSolB && solPriceUsd > 0) {
      valB = (pos.tokenBAmount || 0) * solPriceUsd;
      valA = (pos.tokenAAmount || 0) * Math.max(price, 0) * solPriceUsd;
    } else {
      valA = (pos.tokenAAmount || 0) * Math.max(price, 0);
      valB = pos.tokenBAmount || 0;
    }

    const addLeg = (rawSym: string, amt: number, usdVal: number) => {
      if (usdVal < 0.1) return;
      const norm = normalizeHedgeSymbol(rawSym);
      const prev = exposureBySymbol.get(norm);
      if (prev) {
        prev.amount += amt;
        prev.usd += usdVal;
      } else {
        exposureBySymbol.set(norm, { rawSymbol: rawSym, amount: amt, usd: usdVal });
      }
    };

    if (!isStableA) addLeg(symA, pos.tokenAAmount || 0, valA);
    if (!isStableB) addLeg(symB, pos.tokenBAmount || 0, valB);
  }

  const legs: TokenExposureLeg[] = [];
  let totalVolatileExposureUsd = 0;
  let totalShortTargetUsd = 0;
  let requiredUsdcCollateralUsd = 0;
  let weightedBorrowCostNumerator = 0;
  let weightedIlNumerator = 0;

  for (const [normSym, exp] of exposureBySymbol.entries()) {
    const expUsd = Number(exp.usd.toFixed(2));
    totalVolatileExposureUsd += expUsd;

    const directReserve = reserveBySym.get(normSym);
    if (directReserve) {
      // Safe target LTV capped at <= 55% (or 75% of maxLtv) to eliminate liquidation risk
      const safeTargetLtv = Math.min(0.55, Math.max(0.35, (directReserve.maxLtv || 0.7) * 0.75));
      const reqColl = Number((expUsd / safeTargetLtv).toFixed(2));
      const netCarry = Number((collateralEarnAprPct - directReserve.borrowApyPct).toFixed(2));

      totalShortTargetUsd += expUsd;
      requiredUsdcCollateralUsd += reqColl;
      weightedBorrowCostNumerator += expUsd * directReserve.borrowApyPct;
      weightedIlNumerator += expUsd * 100;

      legs.push({
        symbol: normSym,
        mint: directReserve.mint,
        lpExposureAmount: Number(exp.amount.toFixed(6)),
        lpExposureUsd: expUsd,
        hedgeMode: 'DIRECT_BORROW_SHORT',
        lendingProtocol: directReserve.protocol,
        borrowReserveSymbol: directReserve.symbol,
        borrowReserveAddress: directReserve.reserveAddress,
        borrowMint: directReserve.mint,
        targetShortUsd: expUsd,
        targetBorrowAmount: Number(exp.amount.toFixed(6)),
        requiredCollateralUsdc: reqColl,
        targetLtvPct: Math.round(safeTargetLtv * 100),
        borrowApyPct: Number(directReserve.borrowApyPct.toFixed(2)),
        collateralSupplyApyPct: collateralEarnAprPct,
        netCarryAprPct: netCarry,
        ilEliminationPct: 100,
        statusLabel: `${directReserve.protocol} 1:1 借币做空`,
        reason: `质押 $${reqColl.toFixed(2)} USDC（LTV ${Math.round(safeTargetLtv * 100)}%），借出 ${exp.amount.toFixed(4)} ${directReserve.symbol} 现货卖空为 USDC，精准 1:1 抵消 LP 多头与无常损失。`,
      });
    } else if (solReserve) {
      // Solana ecosystem beta proxy short hedge via SOL when micro-cap altcoin isn't listed on lending markets
      const betaRatio = 0.85;
      const proxyShortUsd = Number((expUsd * betaRatio).toFixed(2));
      const safeTargetLtv = Math.min(0.55, Math.max(0.35, (solReserve.maxLtv || 0.74) * 0.75));
      const reqColl = Number((proxyShortUsd / safeTargetLtv).toFixed(2));
      const solAmt = solPriceUsd > 0 ? Number((proxyShortUsd / solPriceUsd).toFixed(5)) : 0;
      const netCarry = Number((collateralEarnAprPct - solReserve.borrowApyPct).toFixed(2));

      totalShortTargetUsd += proxyShortUsd;
      requiredUsdcCollateralUsd += reqColl;
      weightedBorrowCostNumerator += proxyShortUsd * solReserve.borrowApyPct;
      weightedIlNumerator += expUsd * 75;

      legs.push({
        symbol: normSym,
        mint: '',
        lpExposureAmount: Number(exp.amount.toFixed(4)),
        lpExposureUsd: expUsd,
        hedgeMode: 'SOL_BETA_PROXY_SHORT',
        lendingProtocol: solReserve.protocol,
        borrowReserveSymbol: 'SOL (Beta 代理空头)',
        borrowReserveAddress: solReserve.reserveAddress,
        borrowMint: solReserve.mint,
        targetShortUsd: proxyShortUsd,
        targetBorrowAmount: solAmt,
        requiredCollateralUsdc: reqColl,
        targetLtvPct: Math.round(safeTargetLtv * 100),
        borrowApyPct: Number(solReserve.borrowApyPct.toFixed(2)),
        collateralSupplyApyPct: collateralEarnAprPct,
        netCarryAprPct: netCarry,
        ilEliminationPct: 75,
        statusLabel: `${solReserve.protocol} SOL 相关性代理对冲`,
        reason: `${normSym} 暂无原生借贷池，通过 ${solReserve.protocol} 借空 ${solAmt} SOL（$${proxyShortUsd.toFixed(2)}）对冲约 75% Solana 大盘 Beta 波动。`,
      });
    } else {
      legs.push({
        symbol: normSym,
        mint: '',
        lpExposureAmount: Number(exp.amount.toFixed(4)),
        lpExposureUsd: expUsd,
        hedgeMode: 'UNAVAILABLE',
        lendingProtocol: '暂无可用借贷市场',
        borrowReserveSymbol: '-',
        borrowReserveAddress: '',
        borrowMint: '',
        targetShortUsd: 0,
        targetBorrowAmount: 0,
        requiredCollateralUsdc: 0,
        targetLtvPct: 0,
        borrowApyPct: 0,
        collateralSupplyApyPct: collateralEarnAprPct,
        netCarryAprPct: 0,
        ilEliminationPct: 0,
        statusLabel: '待接入借贷池',
        reason: `暂未获取到 ${normSym} 或 SOL 的实时借贷流动性储备。`,
      });
    }
  }

  totalVolatileExposureUsd = Number(totalVolatileExposureUsd.toFixed(2));
  totalShortTargetUsd = Number(totalShortTargetUsd.toFixed(2));
  requiredUsdcCollateralUsd = Number(requiredUsdcCollateralUsd.toFixed(2));

  const weightedBorrowCostAprPct =
    totalShortTargetUsd > 0
      ? Number((weightedBorrowCostNumerator / totalShortTargetUsd).toFixed(2))
      : Number((solReserve?.borrowApyPct ?? 4.03).toFixed(2));
  const netCarryAprPct = Number((collateralEarnAprPct - weightedBorrowCostAprPct).toFixed(2));

  const theoreticalIlCoverage =
    totalVolatileExposureUsd > 0
      ? Math.round(weightedIlNumerator / totalVolatileExposureUsd)
      : 100;

  if (totalVolatileExposureUsd < 1) {
    return {
      enabled: true,
      status: 'MONITORING',
      shouldExecuteHedge: false,
      lendingProtocolLabel,
      totalVolatileExposureUsd: 0,
      totalShortTargetUsd: 0,
      requiredUsdcCollateralUsd: 0,
      availableUsdcCollateralUsd,
      activeShortDebtUsd: cleanDebtUsd,
      activeCollateralUsd: cleanCollUsd,
      netDeltaPct: 0,
      ilEliminatedPct: 100,
      weightedBorrowCostAprPct,
      collateralEarnAprPct,
      netCarryAprPct,
      headline: `多币种 Delta-Neutral 对冲就绪（Solend / Kamino 实时借 SOL 成本 ${weightedBorrowCostAprPct.toFixed(2)}%）`,
      reason:
        '当前暂无高额波动币种 LP 敞口；一旦建仓买入非稳定币流动性，系统将自动计算多头净敞口并在 Solana 原生借贷协议发起 1:1 空头对冲，消除单边下跌与无常损失。',
      legs: [],
      supportedReservesCount: reserveBySym.size,
      topBorrowReserves,
    };
  }

  const hedgeRatio = totalShortTargetUsd > 0 ? Math.min(1, cleanDebtUsd / totalShortTargetUsd) : 0;
  const netDeltaPct = Number(Math.max(0, (1 - hedgeRatio) * 100).toFixed(1));
  const ilEliminatedPct = Math.round(theoreticalIlCoverage * hedgeRatio);

  if (hedgeRatio >= 0.85) {
    return {
      enabled: true,
      status: 'HEDGED_NEUTRAL',
      shouldExecuteHedge: false,
      lendingProtocolLabel,
      totalVolatileExposureUsd,
      totalShortTargetUsd,
      requiredUsdcCollateralUsd,
      availableUsdcCollateralUsd,
      activeShortDebtUsd: cleanDebtUsd,
      activeCollateralUsd: cleanCollUsd,
      netDeltaPct,
      ilEliminatedPct,
      weightedBorrowCostAprPct,
      collateralEarnAprPct,
      netCarryAprPct,
      headline: `Delta-Neutral 中性对冲运行中（链上空头 $${cleanDebtUsd.toFixed(2)} · 消除 ${ilEliminatedPct}% 无常损失）`,
      reason: `已通过 Solana 原生借贷协议抵押 $${cleanCollUsd.toFixed(2)} 并发起 $${cleanDebtUsd.toFixed(2)} 空头负债，净价格敞口降至 ${netDeltaPct}%，稳吃做市手续费 + 抵押生息。`,
      legs,
      supportedReservesCount: reserveBySym.size,
      topBorrowReserves,
    };
  }

  const remainingShortNeed = Math.max(0, totalShortTargetUsd - cleanDebtUsd);
  const remainingCollNeed = Number(
    (
      requiredUsdcCollateralUsd *
      (totalShortTargetUsd > 0 ? remainingShortNeed / totalShortTargetUsd : 1)
    ).toFixed(2)
  );

  if (availableUsdcCollateralUsd < Math.max(3, remainingCollNeed * 0.9)) {
    return {
      enabled: true,
      status: 'INSUFFICIENT_COLLATERAL',
      shouldExecuteHedge: false,
      lendingProtocolLabel,
      totalVolatileExposureUsd,
      totalShortTargetUsd,
      requiredUsdcCollateralUsd,
      availableUsdcCollateralUsd,
      activeShortDebtUsd: cleanDebtUsd,
      activeCollateralUsd: cleanCollUsd,
      netDeltaPct,
      ilEliminatedPct,
      weightedBorrowCostAprPct,
      collateralEarnAprPct,
      netCarryAprPct,
      headline: `待补充 USDC 保证金以开启完全中性对冲（需 $${remainingCollNeed.toFixed(2)} · 可用 $${availableUsdcCollateralUsd.toFixed(2)}）`,
      reason: `检测到 $${totalVolatileExposureUsd.toFixed(2)} 波动币种敞口（理论可消除 ${theoreticalIlCoverage}% 无常损失），但按安全 LTV ≤55% 需 $${remainingCollNeed.toFixed(2)} USDC 抵押保证金，当前钱包空余 USDC 不足，已自动跳过高杠杆开空以免强平风险。`,
      legs,
      supportedReservesCount: reserveBySym.size,
      topBorrowReserves,
    };
  }

  return {
    enabled: true,
    status: 'HEDGE_READY',
    shouldExecuteHedge: remainingShortNeed >= 2.5,
    lendingProtocolLabel,
    totalVolatileExposureUsd,
    totalShortTargetUsd,
    requiredUsdcCollateralUsd,
    availableUsdcCollateralUsd,
    activeShortDebtUsd: cleanDebtUsd,
    activeCollateralUsd: cleanCollUsd,
    netDeltaPct,
    ilEliminatedPct: theoreticalIlCoverage,
    weightedBorrowCostAprPct,
    collateralEarnAprPct,
    netCarryAprPct,
    headline: `对冲就绪：可抵押 $${remainingCollNeed.toFixed(2)} USDC 借空 $${remainingShortNeed.toFixed(2)} 实现 Delta-Neutral 中性做市`,
    reason: `钱包 USDC 保证金充足（$${availableUsdcCollateralUsd.toFixed(2)}），系统已匹配最低借币利率（加权成本 ${weightedBorrowCostAprPct}% vs 抵押生息 ${collateralEarnAprPct}%），可执行原生借贷空头对冲消除 ${theoreticalIlCoverage}% 方向性 IL 风险。`,
    legs,
    supportedReservesCount: reserveBySym.size,
    topBorrowReserves,
  };
}






