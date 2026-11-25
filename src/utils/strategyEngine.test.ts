import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_200U_STRATEGY,
  buildPresetForCapital,
  calculateImpermanentLossPct,
  estimateNetYieldForCapital,
  evaluateRiskAction,
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
