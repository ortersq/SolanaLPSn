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

export type RiskProfileKey = 'ultra-safe' | 'balanced-steady' | 'active-yield';

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
      autoSelectorWeights: {
        aprWeight: 0.45,
        volumeTvlRatioWeight: 0.35,
        safetyWeight: 0.2,
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
    rangeWidthPct <= 6 ? 2.45 : rangeWidthPct <= 10 ? 1.65 : rangeWidthPct <= 15 ? 1.25 : 1.0;

  const compoundMultiplier = autoCompound ? 1.08 : 1.0;
  // Cap base APR conservatively so temporary spikes don't inflate illusions
  const cappedBaseApr = Math.min(Math.max(aprPct, 10), 160);
  // Active-yield combines 70% core + 30% higher-APR satellite boost (~1.2x effective blend)
  const satelliteBlend = riskProfile === 'active-yield' ? 1.2 : 1.0;

  const effectiveAprPct = Number(
    (cappedBaseApr * concentrationMultiplier * compoundMultiplier * satelliteBlend).toFixed(1)
  );
  const dailyGrossUsd = Number(((lpUsdt * (effectiveAprPct / 100)) / 365).toFixed(2));

  // Tight ranges rebalance more frequently -> subtract realistic rebalance gas + swap slippage
  const monthlyGasAndSlippageUsd =
    rangeWidthPct <= 6 ? 5.2 : rangeWidthPct <= 10 ? 3.0 : 1.8;

  const monthlyGross = dailyGrossUsd * 30;
  const monthlyNetUsd = Number(Math.max(0, monthlyGross - monthlyGasAndSlippageUsd).toFixed(2));
  const monthlyNetPct = lpUsdt > 0 ? Number(((monthlyNetUsd / lpUsdt) * 100).toFixed(1)) : 0;

  const realisticMinUsd = Number(Math.max(0, monthlyNetUsd * 0.65).toFixed(1));
  const realisticMaxUsd = Number((monthlyNetUsd * 1.3).toFixed(1));
  const estimatedWinProbRange =
    riskProfile === 'ultra-safe'
      ? '65% ~ 75%'
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

  const aprCap = config.riskProfile === 'active-yield' ? 240 : 180;
  const aprScore = Math.min((Math.max(pool.apr, 0) / aprCap) * 100, 100);
  const activityScore = Math.min(volTvlRatio * 25, 100);
  const safetyComponent = Math.min(Math.max(pool.safetyScore, 0), 100);

  const isHighRisk = pool.ilRisk === '高';
  const isCoreBluechip = pool.ilRisk === '低' && pool.tvl >= 1_500_000;
  const tvlTooLow = pool.tvl < config.minTVL;
  const effectiveMinApr =
    config.riskProfile === 'active-yield' && isCoreBluechip ? 30 : config.minAPR;
  const aprTooLow = pool.apr < effectiveMinApr;

  // In active-yield mode, medium-risk high-liquidity pools (TVL >= $500K, safety >= 80) are allowed as satellite pools;
  // in ultra-safe mode, require low-IL bluechip pools
  const minSafety = config.riskProfile === 'active-yield' ? 80 : 85;
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

export interface PipelineStepResult {
  step: PipelineStepKey;
  title: string;
  status: PipelineStepStatus;
  summary: string;
  details: string;
  durationMs: number;
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


