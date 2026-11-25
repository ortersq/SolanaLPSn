import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_200U_STRATEGY,
  assessLiveTestWalletReadiness,
  buildPresetForCapital,
  calculateImpermanentLossPct,
  calculateLpDepositAmounts,
  computeSafeClmmOtherAmountMax,
  estimateNetYieldForCapital,
  evaluateLiveRiskAlerts,
  evaluateRiskAction,
  formatChainError,
  isValidSolanaAddress,
  maskSolanaAddress,
  rankPools,
  PoolMetrics,
} from './strategyEngine';

test('buildPresetForCapital allocates 200U with 15U gas reserve and 185U active LP', () => {
  assert.equal(DEFAULT_200U_STRATEGY.capitalUsdt, 200);
  assert.equal(DEFAULT_200U_STRATEGY.gasReserveUsdt, 15);
  assert.equal(DEFAULT_200U_STRATEGY.lpActiveUsdt, 185);
  assert.equal(DEFAULT_200U_STRATEGY.minTVL, 2_000_000);
  assert.equal(DEFAULT_200U_STRATEGY.harvestMinUsd, 2.5);

  const safePreset = buildPresetForCapital(200, 'ultra-safe');
  assert.equal(safePreset.minTVL, 3_000_000);
  assert.equal(safePreset.rangeWidthPct, 20);

  const activePreset = buildPresetForCapital(200, 'active-yield');
  assert.equal(activePreset.coreSplitPct, 70);
  assert.equal(activePreset.rangeWidthPct, 6);
  assert.equal(activePreset.autoCompound, true);
  assert.equal(activePreset.minTVL, 500_000);
});

test('rankPools rejects high-IL volatile pools for 200U steady strategy', () => {
  const pools: PoolMetrics[] = [
    {
      id: 'high-il-trap',
      name: 'MEME / USDC',
      dex: 'RAYDIUM CLMM',
      address: '11111111111111111111111111111111',
      tvl: 3_000_000,
      volume24h: 15_000_000,
      apr: 280,
      feeTier: '0.25%',
      priceUsd: '1.2',
      safetyScore: 88,
      ilRisk: '高',
    },
    {
      id: 'wsol-usdc',
      name: 'WSOL / USDC',
      dex: 'RAYDIUM CLMM',
      address: '2QdhepnKRTLjQQPL14MYYvE2j2y97uK2xH2237fK66rY',
      tvl: 5_400_000,
      volume24h: 20_000_000,
      apr: 58,
      feeTier: '0.04%',
      priceUsd: '140.0',
      safetyScore: 96,
      ilRisk: '低',
    },
  ];

  const ranked = rankPools(pools, DEFAULT_200U_STRATEGY);
  assert.equal(ranked[0].id, 'wsol-usdc');
  assert.equal(ranked[0].eligibleFor200U, true);
  assert.equal(ranked[0].autoSelected, true);
  assert.equal(ranked[1].eligibleFor200U, false);

  const activeRanked = rankPools(pools, buildPresetForCapital(200, 'active-yield'));
  assert.equal(activeRanked[0].id, 'wsol-usdc');
  assert.equal(activeRanked[0].eligibleFor200U, true);
  assert.equal(activeRanked[0].poolRole, 'core');
});

test('evaluateRiskAction enforces gas-aware harvest threshold and hard stop-loss', () => {
  // Fees under $2.5 -> HOLD (save Gas)
  assert.equal(
    evaluateRiskAction(
      { pnlPct: 1.0, ilPctAbs: 0.3, tvlDropPct1h: 1, uncollectedFeesUsd: 1.2 },
      DEFAULT_200U_STRATEGY
    ).action,
    'HOLD'
  );
  // Fees >= $2.5 -> HARVEST_AND_SWEEP
  assert.equal(
    evaluateRiskAction(
      { pnlPct: 2.0, ilPctAbs: 0.3, tvlDropPct1h: 1, uncollectedFeesUsd: 2.6 },
      DEFAULT_200U_STRATEGY
    ).action,
    'HARVEST_AND_SWEEP'
  );
  // Drawdown >= 6% -> EMERGENCY_WITHDRAW
  assert.equal(
    evaluateRiskAction(
      { pnlPct: -6.5, ilPctAbs: 0.8, tvlDropPct1h: 2, uncollectedFeesUsd: 0.4 },
      DEFAULT_200U_STRATEGY
    ).action,
    'EMERGENCY_WITHDRAW'
  );
});

test('estimateNetYieldForCapital and helpers compute realistic figures', () => {
  const steadyEst = estimateNetYieldForCapital(185, 60, 10, 'balanced-steady', true);
  const activeEst = estimateNetYieldForCapital(185, 60, 6, 'active-yield', true);
  assert.ok(steadyEst.dailyGrossUsd > 0 && steadyEst.monthlyNetUsd > 0);
  assert.ok(activeEst.monthlyNetUsd > steadyEst.monthlyNetUsd);
  assert.equal(calculateImpermanentLossPct(2), -5.72);
  assert.equal(isValidSolanaAddress('So11111111111111111111111111111111111111112'), true);
  assert.equal(maskSolanaAddress('So11111111111111111111111111111111111111112'), 'So11...1112');
});

test('evaluateLiveRiskAlerts detects volatility traps, shallow pools, and exit slippage breach', () => {
  const ranked = rankPools(
    [
      {
        id: 'trap-1',
        name: 'VOLA / USDC',
        dex: 'RAYDIUM CLMM',
        address: '11111111111111111111111111111111',
        tvl: 800_000,
        volume24h: 3_000_000,
        apr: 260,
        feeTier: '0.25%',
        priceUsd: '0.5',
        safetyScore: 84,
        ilRisk: '高',
      },
      {
        id: 'shallow-1',
        name: 'TINY / SOL',
        dex: 'RAYDIUM CLMM',
        address: '22222222222222222222222222222222',
        tvl: 90_000,
        volume24h: 400_000,
        apr: 90,
        feeTier: '0.01%',
        priceUsd: '1.0',
        safetyScore: 70,
        ilRisk: '中',
      },
    ],
    DEFAULT_200U_STRATEGY
  );

  const alerts = evaluateLiveRiskAlerts({
    pools: ranked,
    jupiterImpactBps: 85,
    heliusLatencyMs: 120,
    privateKeyConfigured: false,
    config: DEFAULT_200U_STRATEGY,
    nowTime: '12:00:00',
  });

  assert.ok(alerts.some((a) => a.category === '撤池滑点过高预警'));
  assert.ok(alerts.some((a) => a.category === 'Token 价格异常波动预警' && a.target === 'VOLA / USDC'));
  assert.ok(alerts.some((a) => a.category === '浅池撤池高滑点预警' && a.target === 'TINY / SOL'));
});

test('calculateLpDepositAmounts splits 185U 50/50 with concentrated price bounds', () => {
  const split = calculateLpDepositAmounts(185, 100, 10);
  assert.equal(split.usdcAmount, 92.5);
  assert.equal(split.solAmount, 0.925);
  assert.equal(split.lowerPriceUsd, 90);
  assert.equal(split.upperPriceUsd, 110);
});

test('assessLiveTestWalletReadiness validates private key, recipient, and balances honestly', () => {
  const noKey = assessLiveTestWalletReadiness({
    step: 'all',
    asset: 'SOL',
    solBalance: 1,
    usdcBalance: 10,
    usdtBalance: 0,
    hasPrivateKey: false,
    hasValidRecipient: true,
  });
  assert.equal(noKey.ok, false);

  const lowSol = assessLiveTestWalletReadiness({
    step: 'all',
    asset: 'SOL',
    solBalance: 0.015,
    usdcBalance: 0,
    usdtBalance: 0,
    hasPrivateKey: true,
    hasValidRecipient: true,
  });
  assert.equal(lowSol.ok, false);
  assert.equal(lowSol.requiredSol, 0.035);

  const lowUsdt = assessLiveTestWalletReadiness({
    step: 'swap',
    asset: 'USDT',
    solBalance: 0.1,
    usdcBalance: 0,
    usdtBalance: 0.02,
    hasPrivateKey: true,
    hasValidRecipient: true,
  });
  assert.equal(lowUsdt.ok, false);

  const ready = assessLiveTestWalletReadiness({
    step: 'all',
    asset: 'SOL',
    solBalance: 0.08,
    usdcBalance: 0,
    usdtBalance: 0,
    hasPrivateKey: true,
    hasValidRecipient: true,
  });
  assert.equal(ready.ok, true);
});

test('formatChainError never returns undefined on plain Solana objects or Raydium errors', () => {
  const solanaObj = { InstructionError: [0, { Custom: 6021 }], txId: 'abc123' };
  const msg1 = formatChainError(solanaObj);
  assert.ok(!msg1.includes('undefined'));
  assert.ok(msg1.includes('6021'));

  assert.ok(!formatChainError(undefined).includes('undefined'));
  assert.ok(!formatChainError({}).includes('undefined'));
  assert.ok(formatChainError('cannot found target token accounts').includes('ATA'));
});

test('computeSafeClmmOtherAmountMax enforces an upper-bound ceiling above SDK slippage output', () => {
  // SDK returns amountA=1367343 and amountSlippageA=1230608 (lower than expected!).
  const safeMax = BigInt(computeSafeClmmOtherAmountMax('1367343', '1230608', 25));
  assert.ok(safeMax > 1367343n);
  assert.equal(safeMax, 1709179n);
  assert.equal(computeSafeClmmOtherAmountMax('0', '0', 25), '0');
});
