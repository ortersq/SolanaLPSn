import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_200U_STRATEGY,
  assessLiveTestWalletReadiness,
  buildPresetForCapital,
  buildSelectionRoundFromPools,
  calculateAutoPortfolioPlan,
  calculateImpermanentLossPct,
  calculateLpDepositAmounts,
  calculatePositionMetrics,
  computePositionRangeDeviation,
  computeSafeClmmOtherAmountMax,
  estimateNetYieldForCapital,
  evaluateAutoAssetRebalance,
  evaluateAutoCompoundOpportunity,
  evaluateAutonomousHighYieldSwitch,
  evaluateLiveRiskAlerts,
  evaluateMultiCurrencyHedgePlan,
  evaluateRiskAction,
  evaluateSafeWithdrawSafety,
  formatChainError,
  getMaxPoolExposureShare,
  getOptimalRangeWidthForPool,
  isLowIlAnchorPool,
  isValidSolanaAddress,
  maskSolanaAddress,
  rankPools,
  PoolMetrics,
  SolanaLendingReserve,
  StrategyConfig,
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
  assert.equal(activePreset.coreSplitPct, 75);
  assert.equal(activePreset.rangeWidthPct, 3);
  assert.equal(activePreset.stopLossPercentage, 5);
  assert.equal(activePreset.autoCompound, true);
  assert.equal(activePreset.minTVL, 100_000);
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

test('calculatePositionMetrics calculates inRange, USD value and unrealized PnL', () => {
  const inRangeRes = calculatePositionMetrics({
    currentPrice: 140,
    priceLower: 125,
    priceUpper: 155,
    amountA: 0.5, // 0.5 SOL
    amountB: 70, // 70 USDC
    tokenASymbol: 'WSOL',
    tokenBSymbol: 'USDC',
    uncollectedFeeUsd: 1.45,
  });

  assert.equal(inRangeRes.inRange, true);
  assert.equal(inRangeRes.injectedValueUsd, 140); // 0.5 * 140 + 70
  assert.equal(inRangeRes.unrealizedPnlUsd, 1.45);
  assert.equal(inRangeRes.unrealizedPnlPct, 1.04);

  const outOfRangeRes = calculatePositionMetrics({
    currentPrice: 160,
    priceLower: 125,
    priceUpper: 155,
    amountA: 0,
    amountB: 140,
    tokenASymbol: 'WSOL',
    tokenBSymbol: 'USDC',
    uncollectedFeeUsd: 0,
  });
  assert.equal(outOfRangeRes.inRange, false);
});

test('buildSelectionRoundFromPools creates a comprehensive round record with winner and rejected reasons', () => {
  const samplePools = rankPools(
    [
      {
        id: 'wsol-usdc-pool',
        name: 'WSOL / USDC',
        dex: 'RAYDIUM CLMM',
        address: '2QdhepnKRTLjQQPL14MYYvE2j2y97uK2xH2237fK66rY',
        tvl: 6_000_000,
        volume24h: 22_000_000,
        apr: 62.5,
        feeTier: '0.04%',
        priceUsd: '142.0',
        safetyScore: 96,
        ilRisk: '低',
      },
      {
        id: 'meme-pool',
        name: 'MEME / SOL',
        dex: 'RAYDIUM CLMM',
        address: '11111111111111111111111111111111',
        tvl: 1_200_000,
        volume24h: 5_000_000,
        apr: 290,
        feeTier: '0.25%',
        priceUsd: '0.04',
        safetyScore: 80,
        ilRisk: '高',
      },
    ],
    DEFAULT_200U_STRATEGY
  );

  const round = buildSelectionRoundFromPools({
    roundNumber: 1,
    pools: samplePools,
    jupiterSlippageBps: 3.5,
    solPriceUsd: 142.5,
    timeStr: '12:00:00',
  });

  assert.equal(round.round, 1);
  assert.equal(round.chosenPool?.name, 'WSOL / USDC');
  assert.equal(round.candidateCount, 2);
  assert.ok(round.rejectedSamples.some((r) => r.name === 'MEME / SOL'));
  assert.ok(round.strategyAction.includes('WSOL / USDC'));
});

test('calculatePositionMetrics accurately prices Token/USDC non-SOL pairs', () => {
  const cardsUsdc = calculatePositionMetrics({
    currentPrice: 0.25, // $0.25 USDC per CARDS
    priceLower: 0.23,
    priceUpper: 0.27,
    amountA: 40, // 40 CARDS = $10
    amountB: 10, // 10 USDC = $10
    tokenASymbol: 'CARDS',
    tokenBSymbol: 'USDC',
    uncollectedFeeUsd: 0.42,
  });
  assert.equal(cardsUsdc.inRange, true);
  assert.equal(cardsUsdc.injectedValueUsd, 20);
  assert.equal(cardsUsdc.unrealizedPnlUsd, 0.42);
  assert.equal(cardsUsdc.unrealizedPnlPct, 2.1);
});

test('turbo-high-yield unlocks high-APR pools and calculateAutoPortfolioPlan detects $0.20 dust vs idle wallet equity', () => {
  const turboCfg = buildPresetForCapital(200, 'turbo-high-yield');
  assert.equal(turboCfg.rangeWidthPct, 3);
  assert.equal(turboCfg.minTVL, 80_000);
  assert.equal(turboCfg.harvestMinUsd, 0.35);
  assert.equal(turboCfg.stopLossPercentage, 18);

  const pools: PoolMetrics[] = [
    {
      id: '3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv',
      name: 'WSOL / USDC',
      dex: 'RAYDIUM CLMM',
      address: '3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv',
      tvl: 5_648_896,
      volume24h: 21_068_801,
      apr: 54.5,
      feeTier: '0.04%',
      priceUsd: '68.0',
      safetyScore: 96,
      ilRisk: '低',
    },
    {
      id: 'FjuBy7jjf9DXj9d3R7cHpvcnoFW2iQxf7F7P3vqx4Jza',
      name: 'SPCX / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'FjuBy7jjf9DXj9d3R7cHpvcnoFW2iQxf7F7P3vqx4Jza',
      tvl: 2_223_318,
      volume24h: 4_212_853,
      apr: 173.1,
      feeTier: '0.25%',
      priceUsd: '1.25',
      safetyScore: 92,
      ilRisk: '中',
    },
    {
      id: 'HnhpJPJgBG2KwniMTNW8cVBHvk1hFog3RC3kjnyc23tD',
      name: 'CARDS / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'HnhpJPJgBG2KwniMTNW8cVBHvk1hFog3RC3kjnyc23tD',
      tvl: 3_286_414,
      volume24h: 2_294_344,
      apr: 101.9,
      feeTier: '0.40%',
      priceUsd: '0.25',
      safetyScore: 92,
      ilRisk: '中',
    },
  ];

  const ranked = rankPools(pools, turboCfg);
  assert.ok(ranked.every((p) => p.eligibleFor200U));

  const plan = calculateAutoPortfolioPlan({
    solBalance: 0.218551,
    usdcBalance: 16.2,
    solPriceUsd: 68,
    activePositions: [
      {
        poolId: '3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv',
        poolName: 'WSOL / USDC',
        injectedValueUsd: 0.2,
        inRange: true,
      },
    ],
    rankedPools: ranked,
    config: turboCfg,
  });

  assert.equal(plan.hasDustPositionToConsolidate, true);
  assert.equal(plan.dustPositionUsd, 0.2);
  assert.ok(plan.idleDeployableUsd > 25);
  assert.ok(plan.utilizationPct < 2);
  assert.equal(plan.slotPlans.length, 2);
  assert.equal(plan.slotPlans[0].poolName, 'SPCX / USDC');
  assert.equal(plan.slotPlans[1].poolName, 'WSOL / USDC');
  assert.ok(plan.slotPlans[0].targetUsd > 14);
  assert.ok(plan.slotPlans[1].targetUsd > 7);
});

test('evaluateAutonomousHighYieldSwitch opens new pool when idle funds exist, rotates when dry and +APR>=20%, and holds when optimal', () => {
  const turboCfg = buildPresetForCapital(200, 'turbo-high-yield');
  const samplePools: PoolMetrics[] = [
    {
      id: 'wsol-usdc-id',
      name: 'WSOL / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'wsol-usdc-id',
      tvl: 5_600_000,
      volume24h: 21_000_000,
      apr: 54.5,
      feeTier: '0.04%',
      priceUsd: '85.0',
      safetyScore: 96,
      ilRisk: '低',
    },
    {
      id: 'spcx-usdc-id',
      name: 'SPCX / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'spcx-usdc-id',
      tvl: 2_200_000,
      volume24h: 4_200_000,
      apr: 173.1,
      feeTier: '0.25%',
      priceUsd: '1.25',
      safetyScore: 92,
      ilRisk: '中',
    },
  ];
  const ranked = rankPools(samplePools, turboCfg);

  // 1. Idle funds >= $5 -> OPEN_NEW (keep existing position, open SPCX/USDC)
  const openNewDecision = evaluateAutonomousHighYieldSwitch({
    rankedPools: ranked,
    activePositions: [
      {
        poolId: 'wsol-usdc-id',
        poolName: 'WSOL / USDC',
        nftMint: 'nft-wsol',
        injectedValueUsd: 14,
      },
    ],
    idleDeployableUsd: 16,
    config: turboCfg,
  });
  assert.equal(openNewDecision.decision, 'OPEN_NEW');
  assert.equal(openNewDecision.shouldAct, true);
  assert.equal(openNewDecision.targetPool?.poolId, 'spcx-usdc-id');
  assert.equal(openNewDecision.sourcePositionToReplace, null);

  // 2. No idle funds (< $5) + significant APR boost (+118.6%) -> ROTATE_SWAP
  const rotateDecision = evaluateAutonomousHighYieldSwitch({
    rankedPools: ranked,
    activePositions: [
      {
        poolId: 'wsol-usdc-id',
        poolName: 'WSOL / USDC',
        nftMint: 'nft-wsol',
        injectedValueUsd: 28,
      },
    ],
    idleDeployableUsd: 1.5,
    config: turboCfg,
  });
  assert.equal(rotateDecision.decision, 'ROTATE_SWAP');
  assert.equal(rotateDecision.shouldAct, true);
  assert.equal(rotateDecision.targetPool?.poolId, 'spcx-usdc-id');
  assert.equal(rotateDecision.sourcePositionToReplace?.nftMint, 'nft-wsol');

  // 3. No idle funds (< $5) + already in best pool (tiny APR delta) -> HOLD_OPTIMAL
  const tinyDiffPools = rankPools(
    [
      samplePools[1],
      {
        ...samplePools[0],
        apr: 175.0,
      },
    ],
    turboCfg
  );
  const holdDecision = evaluateAutonomousHighYieldSwitch({
    rankedPools: tinyDiffPools,
    activePositions: [
      {
        poolId: 'spcx-usdc-id',
        poolName: 'SPCX / USDC',
        nftMint: 'nft-spcx',
        injectedValueUsd: 28,
      },
    ],
    idleDeployableUsd: 1.0,
    config: turboCfg,
  });
  assert.equal(holdDecision.decision, 'HOLD_OPTIMAL');
  assert.equal(holdDecision.shouldAct, false);
});

test('multiPositionParallel diversifies across parallel pools and smartCapitalAllocation detects USDC > injected incremental deployment', () => {
  const cfg = buildPresetForCapital(200, 'turbo-high-yield');
  assert.equal(cfg.multiPositionParallel, true);
  assert.equal(cfg.smartCapitalAllocation, true);

  const ranked = rankPools(
    [
      {
        id: 'wsol-usdc-id',
        name: 'WSOL / USDC',
        dex: 'RAYDIUM CLMM',
        address: 'wsol-usdc-id',
        tvl: 5_600_000,
        volume24h: 21_000_000,
        apr: 54.5,
        feeTier: '0.04%',
        priceUsd: '85.0',
        safetyScore: 96,
        ilRisk: '低',
      },
      {
        id: 'spcx-usdc-id',
        name: 'SPCX / USDC',
        dex: 'RAYDIUM CLMM',
        address: 'spcx-usdc-id',
        tvl: 2_200_000,
        volume24h: 4_200_000,
        apr: 173.1,
        feeTier: '0.25%',
        priceUsd: '1.25',
        safetyScore: 92,
        ilRisk: '中',
      },
      {
        id: 'cards-usdc-id',
        name: 'CARDS / USDC',
        dex: 'RAYDIUM CLMM',
        address: 'cards-usdc-id',
        tvl: 3_200_000,
        volume24h: 2_300_000,
        apr: 101.9,
        feeTier: '0.40%',
        priceUsd: '0.25',
        safetyScore: 92,
        ilRisk: '中',
      },
    ],
    cfg
  );

  // Case A: Wallet USDC ($16.2) exceeds active injected ($10.0) with parallel enabled -> incremental trigger active & 2-3 slots planned
  const planParallel = calculateAutoPortfolioPlan({
    solBalance: 0.21,
    usdcBalance: 16.2,
    solPriceUsd: 85,
    activePositions: [
      {
        poolId: 'wsol-usdc-id',
        poolName: 'WSOL / USDC',
        injectedValueUsd: 10,
      },
    ],
    rankedPools: ranked,
    config: cfg,
  });
  assert.equal(planParallel.usdcExceedsInjected, true);
  assert.equal(planParallel.incrementalTriggerActive, true);
  assert.ok(planParallel.slotPlans.length >= 2);
  assert.ok(planParallel.incrementalBudgetUsd >= 10);

  // Case B: multiPositionParallel = false restricts slotPlans to 1 and chooses ROTATE_SWAP instead of parallel OPEN_NEW
  const singleFocusCfg: StrategyConfig = {
    ...cfg,
    multiPositionParallel: false,
  };
  const planSingle = calculateAutoPortfolioPlan({
    solBalance: 0.21,
    usdcBalance: 16.2,
    solPriceUsd: 85,
    activePositions: [
      {
        poolId: 'wsol-usdc-id',
        poolName: 'WSOL / USDC',
        injectedValueUsd: 10,
      },
    ],
    rankedPools: ranked,
    config: singleFocusCfg,
  });
  assert.equal(planSingle.targetSlots, 1);
  assert.equal(planSingle.slotPlans.length, 1);

  const rotateWhenSingle = evaluateAutonomousHighYieldSwitch({
    rankedPools: ranked,
    activePositions: [
      {
        poolId: 'wsol-usdc-id',
        poolName: 'WSOL / USDC',
        nftMint: 'nft-wsol',
        injectedValueUsd: 10,
      },
    ],
    idleDeployableUsd: 20,
    usdcBalance: 16.2,
    config: singleFocusCfg,
  });
  assert.equal(rotateWhenSingle.decision, 'ROTATE_SWAP');

  // Case C: smartCapitalAllocation = false disables automatic incremental trigger
  const pausedAllocPlan = calculateAutoPortfolioPlan({
    solBalance: 0.21,
    usdcBalance: 16.2,
    solPriceUsd: 85,
    activePositions: [
      {
        poolId: 'wsol-usdc-id',
        poolName: 'WSOL / USDC',
        injectedValueUsd: 10,
      },
    ],
    rankedPools: ranked,
    config: {
      ...cfg,
      smartCapitalAllocation: false,
    },
  });
  assert.equal(pausedAllocPlan.incrementalTriggerActive, false);
  assert.equal(pausedAllocPlan.incrementalBudgetUsd, 0);
});

test('evaluateAutoAssetRebalance detects severe pool depth drops, share drift, balanced allocations, and paused mode', () => {
  const cfg = buildPresetForCapital(200, 'turbo-high-yield');
  assert.equal(cfg.autoAssetRebalance, true);
  assert.equal(cfg.rebalanceDriftThresholdPct, 15);

  const ranked = rankPools(
    [
      {
        id: 'wsol-usdc-id',
        name: 'WSOL / USDC',
        dex: 'RAYDIUM CLMM',
        address: 'wsol-usdc-id',
        tvl: 5_600_000,
        volume24h: 21_000_000,
        apr: 54.5,
        feeTier: '0.04%',
        priceUsd: '85.0',
        safetyScore: 96,
        ilRisk: '低',
      },
      {
        id: 'spcx-usdc-id',
        name: 'SPCX / USDC',
        dex: 'RAYDIUM CLMM',
        address: 'spcx-usdc-id',
        tvl: 1_100_000, // dropped > 50% from 2.4M baseline!
        volume24h: 2_000_000,
        apr: 173.1,
        feeTier: '0.25%',
        priceUsd: '1.25',
        safetyScore: 90,
        ilRisk: '中',
      },
      {
        id: 'cards-usdc-id',
        name: 'CARDS / USDC',
        dex: 'RAYDIUM CLMM',
        address: 'cards-usdc-id',
        tvl: 3_200_000,
        volume24h: 2_300_000,
        apr: 101.9,
        feeTier: '0.40%',
        priceUsd: '0.25',
        safetyScore: 92,
        ilRisk: '中',
      },
    ],
    cfg
  );

  // 1. Severe pool depth drop (-54.2% TVL shock on SPCX/USDC) -> DEPTH_DROP_REDUCE
  const depthShockPlan = evaluateAutoAssetRebalance({
    activePositions: [
      { poolId: 'wsol-usdc-id', poolName: 'WSOL / USDC', nftMint: 'nft-wsol', injectedValueUsd: 15, inRange: true },
      { poolId: 'spcx-usdc-id', poolName: 'SPCX / USDC', nftMint: 'nft-spcx', injectedValueUsd: 15, inRange: true },
    ],
    rankedPools: ranked,
    baselinePoolTvls: { 'wsol-usdc-id': 5_600_000, 'spcx-usdc-id': 2_400_000 },
    config: cfg,
  });
  assert.equal(depthShockPlan.triggerType, 'DEPTH_DROP_REDUCE');
  assert.equal(depthShockPlan.shouldRebalance, true);
  assert.equal(depthShockPlan.sourcePositionToTrim?.poolId, 'spcx-usdc-id');
  assert.equal(depthShockPlan.sourcePositionToTrim?.closeFull, true);
  assert.ok(depthShockPlan.targetPoolToBoost && depthShockPlan.targetPoolToBoost.poolId !== 'spcx-usdc-id');

  // 2. Parallel share drift (> 15% drift: $32 vs $6 with stable TVL) -> SHARE_DRIFT_REBALANCE
  const driftPlan = evaluateAutoAssetRebalance({
    activePositions: [
      { poolId: 'wsol-usdc-id', poolName: 'WSOL / USDC', nftMint: 'nft-wsol', injectedValueUsd: 32, inRange: true },
      { poolId: 'cards-usdc-id', poolName: 'CARDS / USDC', nftMint: 'nft-cards', injectedValueUsd: 6, inRange: true },
    ],
    rankedPools: ranked,
    baselinePoolTvls: { 'wsol-usdc-id': 5_600_000, 'cards-usdc-id': 3_200_000 },
    config: cfg,
  });
  assert.equal(driftPlan.triggerType, 'SHARE_DRIFT_REBALANCE');
  assert.equal(driftPlan.shouldRebalance, true);
  assert.equal(driftPlan.sourcePositionToTrim?.poolId, 'wsol-usdc-id');
  assert.equal(driftPlan.targetPoolToBoost?.poolId, 'cards-usdc-id');
  assert.ok(driftPlan.maxAbsDriftPct >= 15);

  // 3. Balanced parallel allocations ($15 vs $15) -> BALANCED (no unnecessary gas)
  const balancedPlan = evaluateAutoAssetRebalance({
    activePositions: [
      { poolId: 'wsol-usdc-id', poolName: 'WSOL / USDC', nftMint: 'nft-wsol', injectedValueUsd: 15, inRange: true },
      { poolId: 'cards-usdc-id', poolName: 'CARDS / USDC', nftMint: 'nft-cards', injectedValueUsd: 15, inRange: true },
    ],
    rankedPools: ranked,
    baselinePoolTvls: { 'wsol-usdc-id': 5_600_000, 'cards-usdc-id': 3_200_000 },
    config: cfg,
  });
  assert.equal(balancedPlan.triggerType, 'BALANCED');
  assert.equal(balancedPlan.shouldRebalance, false);

  // 4. Paused toggle -> PAUSED
  const pausedPlan = evaluateAutoAssetRebalance({
    activePositions: [
      { poolId: 'wsol-usdc-id', poolName: 'WSOL / USDC', nftMint: 'nft-wsol', injectedValueUsd: 32, inRange: true },
      { poolId: 'cards-usdc-id', poolName: 'CARDS / USDC', nftMint: 'nft-cards', injectedValueUsd: 6, inRange: true },
    ],
    rankedPools: ranked,
    baselinePoolTvls: { 'wsol-usdc-id': 5_600_000, 'cards-usdc-id': 3_200_000 },
    config: { ...cfg, autoAssetRebalance: false },
  });
  assert.equal(pausedPlan.triggerType, 'PAUSED');
  assert.equal(pausedPlan.shouldRebalance, false);
});

test('evaluateSafeWithdrawSafety detects persistent liquidity depletion, IL threshold breach, safe hold, and paused state', () => {
  const cfg = buildPresetForCapital(200, 'balanced-steady'); // maxILTolerance = 2.0%, autoWithdrawSafety = true
  const ranked = rankPools(
    [
      {
        id: 'wsol-usdc-id',
        name: 'WSOL / USDC',
        dex: 'RAYDIUM CLMM',
        address: 'wsol-usdc-id',
        tvl: 5_200_000,
        volume24h: 18_000_000,
        apr: 54,
        feeTier: '0.04%',
        priceUsd: '85',
        safetyScore: 96,
        ilRisk: '低',
      },
      {
        id: 'dry-pool-id',
        name: 'DRY / USDC',
        dex: 'RAYDIUM CLMM',
        address: 'dry-pool-id',
        tvl: 180_000, // severe depletion below baseline & floor
        volume24h: 5_000,
        apr: 120,
        feeTier: '0.25%',
        priceUsd: '1.0',
        safetyScore: 70,
        ilRisk: '中',
      },
    ],
    cfg
  );

  // 1. Persistent liquidity depletion (>= 2 ticks) triggers LIQUIDITY_DEPLETION
  const depletionPlan = evaluateSafeWithdrawSafety({
    activePositions: [
      {
        poolId: 'dry-pool-id',
        poolName: 'DRY / USDC',
        nftMint: 'nft-dry',
        injectedValueUsd: 20,
        priceCurrentUsd: 1.0,
        priceLowerUsd: 0.9,
        priceUpperUsd: 1.1,
        unrealizedPnlPct: -0.5,
        inRange: true,
      },
    ],
    rankedPools: ranked,
    baselinePoolTvls: { 'dry-pool-id': 800_000 },
    depletionStreaks: { 'dry-pool-id': 2 },
    config: cfg,
  });
  assert.equal(depletionPlan.triggerType, 'LIQUIDITY_DEPLETION');
  assert.equal(depletionPlan.shouldAutoWithdraw, true);
  assert.equal(depletionPlan.positionsAtRisk[0].shouldWithdraw, true);

  // 2. Impermanent loss exceeding maxILTolerance triggers IL_THRESHOLD_EXCEEDED
  const ilPlan = evaluateSafeWithdrawSafety({
    activePositions: [
      {
        poolId: 'wsol-usdc-id',
        poolName: 'WSOL / USDC',
        nftMint: 'nft-wsol',
        injectedValueUsd: 30,
        priceCurrentUsd: 62, // sharp divergence vs [76.5, 93.5] range
        priceLowerUsd: 76.5,
        priceUpperUsd: 93.5,
        unrealizedPnlPct: -3.4,
        inRange: false,
      },
    ],
    rankedPools: ranked,
    baselinePoolTvls: { 'wsol-usdc-id': 5_200_000 },
    depletionStreaks: { 'wsol-usdc-id': 0 },
    config: cfg,
  });
  assert.ok(
    ilPlan.triggerType === 'IL_THRESHOLD_EXCEEDED' || ilPlan.triggerType === 'LIQUIDITY_DEPLETION'
  );
  assert.equal(ilPlan.shouldAutoWithdraw, true);
  assert.ok(ilPlan.maxObservedIlPct >= cfg.maxILTolerance);

  // 3. Healthy position stays SAFE_HOLD
  const safePlan = evaluateSafeWithdrawSafety({
    activePositions: [
      {
        poolId: 'wsol-usdc-id',
        poolName: 'WSOL / USDC',
        nftMint: 'nft-wsol',
        injectedValueUsd: 30,
        priceCurrentUsd: 85.2,
        priceLowerUsd: 76.5,
        priceUpperUsd: 93.5,
        unrealizedPnlPct: 0.8,
        inRange: true,
      },
    ],
    rankedPools: ranked,
    baselinePoolTvls: { 'wsol-usdc-id': 5_200_000 },
    depletionStreaks: { 'wsol-usdc-id': 0 },
    config: cfg,
  });
  assert.equal(safePlan.triggerType, 'SAFE_HOLD');
  assert.equal(safePlan.shouldAutoWithdraw, false);

  // 4. Paused mode returns PAUSED
  const pausedSafePlan = evaluateSafeWithdrawSafety({
    activePositions: [
      {
        poolId: 'wsol-usdc-id',
        poolName: 'WSOL / USDC',
        nftMint: 'nft-wsol',
        injectedValueUsd: 30,
        priceCurrentUsd: 62,
        priceLowerUsd: 76.5,
        priceUpperUsd: 93.5,
        unrealizedPnlPct: -3.4,
        inRange: false,
      },
    ],
    rankedPools: ranked,
    config: { ...cfg, autoWithdrawSafety: false },
  });
  assert.equal(pausedSafePlan.triggerType, 'PAUSED');
  assert.equal(pausedSafePlan.shouldAutoWithdraw, false);
});

test('computePositionRangeDeviation & evaluateAutoCompoundOpportunity compute offsets and compound readiness accurately', () => {
  // 1. Range midpoint = 0%, edge = ±100%, near edge >=75% needs intervention, outside >100%
  const centered = computePositionRangeDeviation({
    poolId: 'p1',
    poolName: 'WSOL / USDC',
    nftMint: 'nft1',
    priceCurrentUsd: 100,
    priceLowerUsd: 90,
    priceUpperUsd: 110,
    inRange: true,
    unrealizedPnlUsd: 2.5,
    uncollectedFeeUsd: 1.8,
  });
  assert.equal(centered.rangeOffsetPct, 0);
  assert.equal(centered.needsIntervention, false);

  const nearUpper = computePositionRangeDeviation({
    poolId: 'p1',
    poolName: 'WSOL / USDC',
    nftMint: 'nft1',
    priceCurrentUsd: 108,
    priceLowerUsd: 90,
    priceUpperUsd: 110,
    inRange: true,
    unrealizedPnlUsd: 3.2,
    uncollectedFeeUsd: 2.1,
  });
  assert.equal(nearUpper.rangeOffsetPct, 80);
  assert.equal(nearUpper.needsIntervention, true);

  const outLow = computePositionRangeDeviation({
    poolId: 'p1',
    poolName: 'WSOL / USDC',
    nftMint: 'nft1',
    priceCurrentUsd: 88,
    priceLowerUsd: 90,
    priceUpperUsd: 110,
    inRange: false,
    unrealizedPnlUsd: -1.4,
    uncollectedFeeUsd: 0.4,
  });
  assert.equal(outLow.rangeOffsetPct, -120);
  assert.equal(outLow.needsIntervention, true);

  // 2. Auto-Compound ready when fees >= harvestMinUsd and autoCompound enabled
  const cfg = buildPresetForCapital(200, 'active-yield'); // harvestMinUsd = 2.0, autoCompound = true
  const readyCompound = evaluateAutoCompoundOpportunity({
    activePositions: [
      { poolId: 'p1', poolName: 'WSOL / USDC', nftMint: 'nft1', uncollectedFeeUsd: 2.45, injectedValueUsd: 60 },
      { poolId: 'p2', poolName: 'CARDS / USDC', nftMint: 'nft2', uncollectedFeeUsd: 0.3, injectedValueUsd: 40 },
    ],
    config: cfg,
    referenceAprPct: 90,
  });
  assert.equal(readyCompound.status, 'COMPOUND_READY');
  assert.equal(readyCompound.shouldCompound, true);
  assert.equal(readyCompound.targets.length, 1);
  assert.ok(readyCompound.estimatedApyBoostPct > 0);

  // 3. Monitoring when below harvestMinUsd
  const monitoringCompound = evaluateAutoCompoundOpportunity({
    activePositions: [
      { poolId: 'p1', poolName: 'WSOL / USDC', nftMint: 'nft1', uncollectedFeeUsd: 0.4, injectedValueUsd: 60 },
    ],
    config: cfg,
    referenceAprPct: 90,
  });
  assert.equal(monitoringCompound.status, 'MONITORING');
  assert.equal(monitoringCompound.shouldCompound, false);

  // 4. Paused when autoCompound is false
  const pausedCompound = evaluateAutoCompoundOpportunity({
    activePositions: [
      { poolId: 'p1', poolName: 'WSOL / USDC', nftMint: 'nft1', uncollectedFeeUsd: 5.0, injectedValueUsd: 60 },
    ],
    config: { ...cfg, autoCompound: false },
    referenceAprPct: 90,
  });
  assert.equal(pausedCompound.status, 'PAUSED');
  assert.equal(pausedCompound.shouldCompound, false);
});

test('evaluateMultiCurrencyHedgePlan computes delta-neutral short legs, safe LTV collateral, and status transitions', () => {
  const cfg = buildPresetForCapital(200, 'active-yield');
  assert.equal(cfg.multiCurrencyHedge, true);

  const reserves: SolanaLendingReserve[] = [
    {
      protocol: 'Solend (Save)',
      marketAddress: '4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY',
      reserveAddress: '8PbodeaosQP19SjYFx855UMqWxH2HynZLdBXmsrbac36',
      symbol: 'SOL',
      mint: 'So11111111111111111111111111111111111111112',
      maxLtv: 0.74,
      borrowApyPct: 4.03,
      supplyApyPct: 1.84,
      totalSupplyUsd: 95_000_000,
      totalBorrowUsd: 62_000_000,
    },
    {
      protocol: 'Kamino Finance',
      marketAddress: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF',
      reserveAddress: 'usdcRes1',
      symbol: 'USDC',
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      maxLtv: 0.8,
      borrowApyPct: 5.78,
      supplyApyPct: 4.15,
      totalSupplyUsd: 163_000_000,
      totalBorrowUsd: 112_000_000,
    },
    {
      protocol: 'Kamino Finance',
      marketAddress: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF',
      reserveAddress: 'cbbtcRes1',
      symbol: 'cbBTC',
      mint: 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',
      maxLtv: 0.79,
      borrowApyPct: 0.2,
      supplyApyPct: 0.01,
      totalSupplyUsd: 44_000_000,
      totalBorrowUsd: 8_000_000,
    },
  ];

  // 1. HEDGE_READY when volatile LP exposure exists and wallet USDC covers safe <=55% LTV collateral
  const readyPlan = evaluateMultiCurrencyHedgePlan({
    activePositions: [
      {
        poolId: 'p1',
        poolName: 'WSOL / USDC',
        tokenASymbol: 'WSOL',
        tokenBSymbol: 'USDC',
        tokenAAmount: 0.25,
        tokenBAmount: 20,
        priceCurrentUsd: 80,
        injectedValueUsd: 40,
      },
      {
        poolId: 'p2',
        poolName: 'cbBTC / USDC',
        tokenASymbol: 'cbBTC',
        tokenBSymbol: 'USDC',
        tokenAAmount: 0.0002,
        tokenBAmount: 20,
        priceCurrentUsd: 100_000,
        injectedValueUsd: 40,
      },
    ],
    reserves,
    walletUsdcBalance: 85,
    solPriceUsd: 80,
    activeShortDebtUsd: 0,
    activeCollateralUsd: 0,
    config: cfg,
  });

  assert.equal(readyPlan.status, 'HEDGE_READY');
  assert.equal(readyPlan.shouldExecuteHedge, true);
  assert.equal(readyPlan.totalVolatileExposureUsd, 40);
  assert.equal(readyPlan.totalShortTargetUsd, 40);
  assert.equal(readyPlan.legs.length, 2);
  assert.equal(readyPlan.legs[0].hedgeMode, 'DIRECT_BORROW_SHORT');
  assert.equal(readyPlan.ilEliminatedPct, 100);
  assert.ok(readyPlan.requiredUsdcCollateralUsd > 70);

  // 2. HEDGED_NEUTRAL when on-chain lending short debt covers >=85% of target short
  const neutralPlan = evaluateMultiCurrencyHedgePlan({
    activePositions: [
      {
        poolId: 'p1',
        poolName: 'WSOL / USDC',
        tokenASymbol: 'WSOL',
        tokenBSymbol: 'USDC',
        tokenAAmount: 0.5,
        tokenBAmount: 40,
        priceCurrentUsd: 80,
        injectedValueUsd: 80,
      },
    ],
    reserves,
    walletUsdcBalance: 10,
    solPriceUsd: 80,
    activeShortDebtUsd: 38,
    activeCollateralUsd: 75,
    config: cfg,
  });

  assert.equal(neutralPlan.status, 'HEDGED_NEUTRAL');
  assert.equal(neutralPlan.shouldExecuteHedge, false);
  assert.ok(neutralPlan.netDeltaPct <= 5);
  assert.ok(neutralPlan.ilEliminatedPct >= 95);

  // 3. INSUFFICIENT_COLLATERAL when wallet USDC is below safe LTV margin
  const insufficientPlan = evaluateMultiCurrencyHedgePlan({
    activePositions: [
      {
        poolId: 'p1',
        poolName: 'WSOL / USDC',
        tokenASymbol: 'WSOL',
        tokenBSymbol: 'USDC',
        tokenAAmount: 1.0,
        tokenBAmount: 80,
        priceCurrentUsd: 80,
        injectedValueUsd: 160,
      },
    ],
    reserves,
    walletUsdcBalance: 15,
    solPriceUsd: 80,
    config: cfg,
  });
  assert.equal(insufficientPlan.status, 'INSUFFICIENT_COLLATERAL');
  assert.equal(insufficientPlan.shouldExecuteHedge, false);

  // 4. PAUSED when multiCurrencyHedge is false
  const pausedPlan = evaluateMultiCurrencyHedgePlan({
    activePositions: [
      {
        poolId: 'p1',
        poolName: 'WSOL / USDC',
        tokenASymbol: 'WSOL',
        tokenBSymbol: 'USDC',
        tokenAAmount: 0.5,
        tokenBAmount: 40,
        priceCurrentUsd: 80,
        injectedValueUsd: 80,
      },
    ],
    reserves,
    walletUsdcBalance: 100,
    solPriceUsd: 80,
    config: { ...cfg, multiCurrencyHedge: false },
  });
  assert.equal(pausedPlan.status, 'PAUSED');
  assert.equal(pausedPlan.shouldExecuteHedge, false);
  assert.equal(pausedPlan.ilEliminatedPct, 0);
});

test('turbo-high-yield skips below-minAPR core pool and small portfolios avoid gas-wasting share-drift rebalance churn', () => {
  const turboCfg = buildPresetForCapital(200, 'turbo-high-yield'); // minAPR = 45
  const ranked = rankPools(
    [
      {
        id: 'wsol-usdc-low',
        name: 'WSOL / USDC',
        dex: 'RAYDIUM CLMM',
        address: 'wsol-usdc-low',
        tvl: 5_550_000,
        volume24h: 12_800_000,
        apr: 33.7, // Below minAPR 45%
        feeTier: '0.04%',
        priceUsd: '72.3',
        safetyScore: 96,
        ilRisk: '低',
      },
      {
        id: 'wsol-hsol-high',
        name: 'WSOL / hSOL',
        dex: 'RAYDIUM CLMM',
        address: 'wsol-hsol-high',
        tvl: 2_100_000,
        volume24h: 1_300_000,
        apr: 223.2,
        feeTier: '0.01%',
        priceUsd: '0.84',
        safetyScore: 92,
        ilRisk: '中',
      },
      {
        id: 'spcx-usdc-high',
        name: 'SPCX / USDC',
        dex: 'RAYDIUM CLMM',
        address: 'spcx-usdc-high',
        tvl: 2_370_000,
        volume24h: 3_860_000,
        apr: 148.9,
        feeTier: '0.25%',
        priceUsd: '132.3',
        safetyScore: 92,
        ilRisk: '中',
      },
    ],
    turboCfg
  );

  const plan = calculateAutoPortfolioPlan({
    solBalance: 0.35,
    usdcBalance: 15,
    solPriceUsd: 72.3,
    activePositions: [],
    rankedPools: ranked,
    config: turboCfg,
  });

  // Slot 1 & 2 should select eligible high-APR pools rather than forcing 33.7% WSOL/USDC
  assert.ok(plan.slotPlans.length >= 2);
  assert.ok(plan.slotPlans.every((s) => s.poolId !== 'wsol-usdc-low'));

  // Sub-cent fees (e.g. $0.0197) are preserved cleanly in calculatePositionMetrics
  const subCentMetrics = calculatePositionMetrics({
    currentPrice: 132.3,
    priceLower: 120.7,
    priceUpper: 136.1,
    amountA: 0.0128,
    amountB: 5.44,
    tokenASymbol: 'SPCX',
    tokenBSymbol: 'USDC',
    uncollectedFeeUsd: 0.0197,
  });
  assert.equal(subCentMetrics.unrealizedPnlUsd, 0.02);

  // Small $18 portfolio does not churn on SHARE_DRIFT_REBALANCE for tiny $3-$4 differences
  const smallDriftPlan = evaluateAutoAssetRebalance({
    activePositions: [
      { poolId: 'spcx-usdc-high', poolName: 'SPCX / USDC', nftMint: 'n1', injectedValueUsd: 11, inRange: true },
      { poolId: 'wsol-hsol-high', poolName: 'WSOL / hSOL', nftMint: 'n2', injectedValueUsd: 5, inRange: true },
    ],
    rankedPools: ranked,
    baselinePoolTvls: { 'spcx-usdc-high': 2_370_000, 'wsol-hsol-high': 2_100_000 },
    config: turboCfg,
  });
  assert.equal(smallDriftPlan.shouldRebalance, false);
  assert.equal(smallDriftPlan.triggerType, 'BALANCED');
});

test('yield optimizations: correlated narrow range, 7d APR stability, <$60 2-slot cap + dust cleanup at low SOL, and rent-free top-up', () => {
  const turboCfg = buildPresetForCapital(200, 'turbo-high-yield'); // rangeWidthPct = 3
  const activeCfg = buildPresetForCapital(200, 'active-yield'); // rangeWidthPct = 4

  // 1. Correlated LST & stable pairs get ultra-narrow optimal ranges while volatile pairs keep config rangeWidthPct
  assert.equal(getOptimalRangeWidthForPool('WSOL / hSOL', activeCfg), 2);
  assert.equal(getOptimalRangeWidthForPool('WSOL / JitoSOL', turboCfg), 2);
  assert.equal(getOptimalRangeWidthForPool('USDC / USDT', activeCfg), 1);
  assert.equal(getOptimalRangeWidthForPool('SPCX / USDC', activeCfg), 3);
  assert.equal(getOptimalRangeWidthForPool('SPCX / USDC', turboCfg), 3);

  // 2. 7d sustained APR beats flash-spike 1-day APR with weak 7d follow-through
  const rankedSustained = rankPools(
    [
      {
        id: 'flash-spike',
        name: 'SPIKE / USDC',
        dex: 'RAYDIUM CLMM',
        address: 'flash-spike',
        tvl: 1_500_000,
        volume24h: 2_000_000,
        apr: 145,
        apr7d: 8, // 1-day spike trap
        fee24hUsd: 4000,
        feeTier: '0.25%',
        priceUsd: '1.0',
        safetyScore: 84,
        ilRisk: '中',
      },
      {
        id: 'sustained-lst',
        name: 'WSOL / hSOL',
        dex: 'RAYDIUM CLMM',
        address: 'sustained-lst',
        tvl: 2_250_000,
        volume24h: 1_100_000,
        apr: 173,
        apr7d: 134, // strong 7d fee yield
        fee24hUsd: 10_784,
        feeTier: '1.00%',
        priceUsd: '0.84',
        safetyScore: 92,
        ilRisk: '低',
      },
      {
        id: 'spcx-usdc',
        name: 'SPCX / USDC',
        dex: 'RAYDIUM CLMM',
        address: 'spcx-usdc',
        tvl: 2_380_000,
        volume24h: 3_740_000,
        apr: 143,
        apr7d: 78,
        fee24hUsd: 9_375,
        feeTier: '0.25%',
        priceUsd: '132.0',
        safetyScore: 92,
        ilRisk: '中',
      },
    ],
    activeCfg
  );
  assert.equal(rankedSustained[0].id, 'sustained-lst');
  assert.ok(
    rankedSustained.findIndex((p) => p.id === 'sustained-lst') <
      rankedSustained.findIndex((p) => p.id === 'flash-spike')
  );

  // 3. Low-SOL ($0.021) + $17.61 USDC + $0.22 dust still triggers dust consolidation & caps <$60 equity at 2 slots with ±2% LST range
  const liveSnapshotPlan = calculateAutoPortfolioPlan({
    solBalance: 0.021063,
    usdcBalance: 17.6144,
    solPriceUsd: 73,
    activePositions: [
      { poolId: 'spcx-usdc', poolName: 'SPCX / USDC', injectedValueUsd: 10.82, inRange: true },
      { poolId: 'sustained-lst', poolName: 'WSOL / hSOL', injectedValueUsd: 0.22, inRange: true },
    ],
    rankedPools: rankedSustained,
    config: activeCfg,
  });
  assert.equal(liveSnapshotPlan.hasDustPositionToConsolidate, true);
  assert.equal(liveSnapshotPlan.targetSlots, 2);
  assert.equal(liveSnapshotPlan.slotPlans.length, 2);
  const hsolSlot = liveSnapshotPlan.slotPlans.find((s) => s.poolName === 'WSOL / hSOL');
  assert.equal(hsolSlot?.rangeWidthPct, 2);

  // 4. When both slots on <$60 equity are already held in-range and idle USDC arrives, recommend rent-free topUpExistingPosition
  const topUpRec = evaluateAutonomousHighYieldSwitch({
    rankedPools: rankedSustained,
    activePositions: [
      { poolId: 'sustained-lst', poolName: 'WSOL / hSOL', nftMint: 'nft-hsol', injectedValueUsd: 14, inRange: true },
      { poolId: 'spcx-usdc', poolName: 'SPCX / USDC', nftMint: 'nft-spcx', injectedValueUsd: 11, inRange: true },
    ],
    idleDeployableUsd: 12,
    usdcBalance: 12,
    config: activeCfg,
  });
  assert.equal(topUpRec.decision, 'OPEN_NEW');
  assert.equal(topUpRec.shouldAct, true);
  assert.equal(topUpRec.topUpExistingPosition?.nftMint, 'nft-hsol');
  assert.equal(topUpRec.topUpExistingPosition?.poolId, 'sustained-lst');
});

test('calculateAutoPortfolioPlan flags duplicate smaller same-pool NFTs and dust even when idle USDC < $6', () => {
  const activeCfg = buildPresetForCapital(30, 'active-yield');
  const pools: PoolMetrics[] = [
    {
      id: 'hsol-pool',
      name: 'WSOL / hSOL',
      dex: 'RAYDIUM CLMM',
      address: 'hsol-pool',
      feeTier: '1.00%',
      priceUsd: '$0.84',
      apr: 168,
      apr7d: 134,
      tvl: 2_270_000,
      volume24h: 1_040_000,
      fee24hUsd: 10_400,
      safetyScore: 95,
      ilRisk: '低',
      isBluechip: true,
    },
    {
      id: 'spcx-pool',
      name: 'SPCX / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'spcx-pool',
      feeTier: '0.25%',
      priceUsd: '$133.00',
      apr: 142,
      apr7d: 78,
      tvl: 2_380_000,
      volume24h: 3_500_000,
      fee24hUsd: 8_750,
      safetyScore: 84,
      ilRisk: '中',
      isBluechip: false,
    },
  ];
  const ranked = rankPools(pools, activeCfg);

  // Live duplicate case: $14.09 WSOL/hSOL + $0.64 WSOL/hSOL + $10.77 SPCX/USDC with only $3.25 USDC idle
  const plan = calculateAutoPortfolioPlan({
    solBalance: 0.020168,
    usdcBalance: 3.2496,
    solPriceUsd: 73.11,
    activePositions: [
      { poolId: 'hsol-pool', poolName: 'WSOL / hSOL', injectedValueUsd: 14.09, inRange: true },
      { poolId: 'hsol-pool', poolName: 'WSOL / hSOL', injectedValueUsd: 0.64, inRange: true },
      { poolId: 'spcx-pool', poolName: 'SPCX / USDC', injectedValueUsd: 10.77, inRange: true },
    ],
    rankedPools: ranked,
    config: activeCfg,
  });

  assert.equal(plan.hasDustPositionToConsolidate, true);
  assert.equal(plan.dustPositionUsd, 0.64);

  // Also flag smaller duplicate NFT (< $5) even if >= $1.50
  const dupPlan = calculateAutoPortfolioPlan({
    solBalance: 0.025,
    usdcBalance: 2,
    solPriceUsd: 73,
    activePositions: [
      { poolId: 'hsol-pool', poolName: 'WSOL / hSOL', injectedValueUsd: 14.09, inRange: true },
      { poolId: 'hsol-pool', poolName: 'WSOL / hSOL', injectedValueUsd: 3.2, inRange: true },
    ],
    rankedPools: ranked,
    config: activeCfg,
  });
  assert.equal(dupPlan.hasDustPositionToConsolidate, true);
  assert.equal(dupPlan.dustPositionUsd, 3.2);
});

test('max-profit mode unlocks $80K+ 1000%+ APR pools, rotates aggressively, and recenters out-of-range positions', () => {
  const turboCfg = buildPresetForCapital(200, 'turbo-high-yield');
  const activeCfg = buildPresetForCapital(200, 'active-yield');

  const pools: PoolMetrics[] = [
    {
      id: 'vvv-usdc',
      name: 'VVV / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'vvv-usdc',
      feeTier: '1.00%',
      priceUsd: '$4.20',
      tvl: 122_201,
      volume24h: 462_900,
      fee24hUsd: 4629,
      apr: 1382.5,
      apr7d: 763,
      safetyScore: 64,
      ilRisk: '中',
      isBluechip: false,
    },
    {
      id: 'spcx-usdc',
      name: 'SPCX / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'spcx-usdc',
      feeTier: '0.25%',
      priceUsd: '$133.00',
      tvl: 2_370_924,
      volume24h: 3_705_200,
      fee24hUsd: 9263,
      apr: 142.6,
      apr7d: 78.5,
      safetyScore: 92,
      ilRisk: '中',
      isBluechip: false,
    },
    {
      id: 'wsol-hsol',
      name: 'WSOL / hSOL',
      dex: 'RAYDIUM CLMM',
      address: 'wsol-hsol',
      feeTier: '1.00%',
      priceUsd: '$0.84',
      tvl: 2_271_684,
      volume24h: 1_031_700,
      fee24hUsd: 10317,
      apr: 165.8,
      apr7d: 134.2,
      safetyScore: 94,
      ilRisk: '低',
      isBluechip: true,
    },
  ];

  // Both turbo-high-yield and active-yield unlock VVV/USDC ($122K TVL, 1382.5% APR) and rank it #1
  const turboRanked = rankPools(pools, turboCfg);
  const activeRanked = rankPools(pools, activeCfg);
  assert.equal(turboRanked[0].id, 'vvv-usdc');
  assert.equal(turboRanked[0].eligibleFor200U, true);
  assert.equal(activeRanked[0].id, 'vvv-usdc');
  assert.equal(activeRanked[0].eligibleFor200U, true);

  // ROTATE_SWAP triggers from 142.6% SPCX/USDC into 1382.5% VVV/USDC when dry
  const rot = evaluateAutonomousHighYieldSwitch({
    rankedPools: turboRanked,
    activePositions: [
      { poolId: 'wsol-hsol', poolName: 'WSOL / hSOL', nftMint: 'n1', injectedValueUsd: 14, inRange: true },
      { poolId: 'spcx-usdc', poolName: 'SPCX / USDC', nftMint: 'n2', injectedValueUsd: 11, inRange: true },
    ],
    idleDeployableUsd: 2.0,
    usdcBalance: 2.0,
    config: turboCfg,
  });
  assert.equal(rot.decision, 'ROTATE_SWAP');
  assert.equal(rot.shouldAct, true);
  assert.equal(rot.targetPool?.poolId, 'vvv-usdc');
  assert.equal(rot.sourcePositionToReplace?.poolId, 'spcx-usdc');

  // Out-of-range position triggers OUT_OF_RANGE_RECENTER so capital never sits at $0/day
  const recenter = evaluateAutoAssetRebalance({
    activePositions: [
      { poolId: 'wsol-hsol', poolName: 'WSOL / hSOL', nftMint: 'n1', injectedValueUsd: 14, inRange: true },
      { poolId: 'spcx-usdc', poolName: 'SPCX / USDC', nftMint: 'n2', injectedValueUsd: 11, inRange: false },
    ],
    rankedPools: turboRanked,
    baselinePoolTvls: { 'wsol-hsol': 2_271_684, 'spcx-usdc': 2_370_924 },
    config: turboCfg,
  });
  assert.equal(recenter.shouldRebalance, true);
  assert.equal(recenter.triggerType, 'OUT_OF_RANGE_RECENTER');
  assert.equal(recenter.sourcePositionToTrim?.poolId, 'spcx-usdc');
  assert.equal(recenter.targetPoolToBoost?.poolId, 'vvv-usdc');
});

test('meme-coin anti-rug defense: rejects freeze/1-day rugs, preserves RWA & sustained pools, caps <$300K exposure, and triggers 1-tick flash-rug & blacklist', () => {
  const turboCfg = buildPresetForCapital(200, 'turbo-high-yield');

  const pools: PoolMetrics[] = [
    {
      id: 'rug-freeze-meme',
      name: 'SCAM / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'rug-freeze-meme',
      feeTier: '1.00%',
      priceUsd: '0.01',
      tvl: 190_000,
      volume24h: 950_000,
      apr: 1900,
      apr7d: 600,
      vol7d: 2_800_000,
      safetyScore: 64,
      ilRisk: '中',
      hasUnverifiedFreezeAuthority: true,
    },
    {
      id: 'rug-1day-meme',
      name: 'ONEDAY / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'rug-1day-meme',
      feeTier: '1.00%',
      priceUsd: '0.05',
      tvl: 145_000,
      volume24h: 490_000,
      vol7d: 510_000, // Almost 100% of 7d volume happened today -> 1-day pump & rug trap
      apr: 1650,
      apr7d: 90,
      safetyScore: 64,
      ilRisk: '中',
    },
    {
      id: 'vvv-sustained',
      name: 'VVV / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'vvv-sustained',
      feeTier: '1.00%',
      priceUsd: '4.20',
      tvl: 122_201,
      volume24h: 443_000,
      vol7d: 2_920_000, // ~6.6x sustained 7d volume
      apr: 1357.8,
      apr7d: 762.6,
      apr30d: 448.2,
      burnPercent: 0,
      safetyScore: 64,
      ilRisk: '中',
      isMemeRiskPool: true,
    },
    {
      id: 'spcx-rwa',
      name: 'SPCX / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'spcx-rwa',
      feeTier: '0.25%',
      priceUsd: '133.0',
      tvl: 2_370_924,
      volume24h: 3_705_200,
      vol7d: 22_000_000,
      apr: 142.6,
      apr7d: 78.5,
      safetyScore: 92,
      ilRisk: '中',
      isRwaOrVerified: true, // Verified RWA equity (USDC/RWA compliance freeze is NOT meme rug freeze)
    },
  ];

  // 1. Freeze trap & 1-day meme pump are blocked; VVV/USDC & SPCX/USDC pass
  const ranked = rankPools(pools, turboCfg);
  const freezeRes = ranked.find((p) => p.id === 'rug-freeze-meme');
  const oneDayRes = ranked.find((p) => p.id === 'rug-1day-meme');
  const vvvRes = ranked.find((p) => p.id === 'vvv-sustained');
  const spcxRes = ranked.find((p) => p.id === 'spcx-rwa');

  assert.equal(freezeRes?.eligibleFor200U, false);
  assert.equal(freezeRes?.alphaScore, 0);
  assert.equal(oneDayRes?.eligibleFor200U, false);
  assert.equal(oneDayRes?.alphaScore, 0);
  assert.equal(vvvRes?.eligibleFor200U, true);
  assert.equal(spcxRes?.eligibleFor200U, true);

  // 2. Exposure cap: <$300K shallow volatile VVV/USDC is capped <= 38% in 2-slot plan, pairing with deep SPCX/USDC anchor
  const plan = calculateAutoPortfolioPlan({
    solBalance: 0.5,
    usdcBalance: 160,
    solPriceUsd: 80,
    activePositions: [],
    rankedPools: ranked,
    config: turboCfg,
  });
  const vvvSlot = plan.slotPlans.find((s) => s.poolId === 'vvv-sustained');
  const spcxSlot = plan.slotPlans.find((s) => s.poolId === 'spcx-rwa');
  assert.ok(vvvSlot && spcxSlot);
  const totalPlanned = plan.slotPlans.reduce((s, x) => s + x.targetUsd, 0);
  assert.ok(vvvSlot.targetUsd / totalPlanned <= 0.39);
  assert.ok(spcxSlot.targetUsd > vvvSlot.targetUsd);

  // 3a. Instant 1-tick flash-rug withdraw when TVL drops >= 35% in a single tick (streak = 1)
  const flashRugPools = rankPools(
    pools.map((p) => (p.id === 'vvv-sustained' ? { ...p, tvl: 70_000 } : p)),
    turboCfg
  );
  const flashWithdraw = evaluateSafeWithdrawSafety({
    activePositions: [
      {
        poolId: 'vvv-sustained',
        poolName: 'VVV / USDC',
        nftMint: 'nft-vvv',
        injectedValueUsd: 40,
        priceCurrentUsd: 4.1,
        priceLowerUsd: 4.0,
        priceUpperUsd: 4.4,
        unrealizedPnlPct: 0.2,
        inRange: true,
      },
    ],
    rankedPools: flashRugPools,
    baselinePoolTvls: { 'vvv-sustained': 122_201 },
    depletionStreaks: { 'vvv-sustained': 1 }, // Only 1 tick!
    config: turboCfg,
  });
  assert.equal(flashWithdraw.shouldAutoWithdraw, true);
  assert.equal(flashWithdraw.triggerType, 'LIQUIDITY_DEPLETION');

  // 3b. Price crash >8% below CLMM lower bound on volatile token triggers IL_THRESHOLD_EXCEEDED even if unrealizedPnlPct >= 0
  const crashWithdraw = evaluateSafeWithdrawSafety({
    activePositions: [
      {
        poolId: 'vvv-sustained',
        poolName: 'VVV / USDC',
        nftMint: 'nft-vvv',
        injectedValueUsd: 40,
        priceCurrentUsd: 3.1, // -22.5% below $4.0 lower bound!
        priceLowerUsd: 4.0,
        priceUpperUsd: 4.4,
        unrealizedPnlPct: 0.1,
        inRange: false,
      },
    ],
    rankedPools: ranked,
    baselinePoolTvls: { 'vvv-sustained': 122_201 },
    depletionStreaks: { 'vvv-sustained': 0 },
    config: turboCfg,
  });
  assert.equal(crashWithdraw.shouldAutoWithdraw, true);
  assert.equal(crashWithdraw.triggerType, 'IL_THRESHOLD_EXCEEDED');

  // 4. Post-rug blacklist blocks re-entry into 'vvv-sustained'
  const blacklistedRanked = rankPools(pools, turboCfg, new Set(['vvv-sustained']));
  const blacklistedVvv = blacklistedRanked.find((p) => p.id === 'vvv-sustained');
  assert.equal(blacklistedVvv?.eligibleFor200U, false);
  assert.equal(blacklistedVvv?.antiRugStatus, 'blocked');
});

test('evaluateAutonomousHighYieldSwitch never recommends topUpExistingPosition on shallow pool already above 38% cap', () => {
  const turboCfg = buildPresetForCapital(200, 'turbo-high-yield');
  const pools: PoolMetrics[] = [
    {
      id: 'vvv-shallow',
      name: 'VVV / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'BJcSKhxWzJPs6H3pi7LddVa6PryM8NH2T1hZAeFEHeDU',
      tvl: 122_000,
      volume24h: 360_000,
      vol7d: 2_800_000,
      apr: 1113,
      apr7d: 758,
      apr30d: 447,
      feeTier: '0.25%',
      priceUsd: '4.1',
      safetyScore: 86,
      ilRisk: '中',
    },
    {
      id: 'nflx-rwa',
      name: 'NFLX / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'E3muPLAM111111111111111111111111111111111111',
      tvl: 190_000,
      volume24h: 350_000,
      vol7d: 2_000_000,
      apr: 470,
      apr7d: 320,
      feeTier: '0.25%',
      priceUsd: '88',
      safetyScore: 90,
      ilRisk: '中',
      isRwaOrVerified: true,
    },
    {
      id: 'wsol-hsol',
      name: 'WSOL / hSOL',
      dex: 'RAYDIUM CLMM',
      address: '9m6cYJ8dd26Smzh35qDvFjkyqvMWYw1CwG5R5F7xWg9Q',
      tvl: 2_270_000,
      volume24h: 3_100_000,
      vol7d: 20_000_000,
      apr: 144,
      apr7d: 120,
      feeTier: '0.01%',
      priceUsd: '73',
      safetyScore: 98,
      ilRisk: '低',
      isBluechip: true,
    },
    {
      id: 'ttwo-safe',
      name: 'TTWO / GTA6',
      dex: 'RAYDIUM CLMM',
      address: 'TTWO111111111111111111111111111111111111111',
      tvl: 185_000,
      volume24h: 280_000,
      vol7d: 1_900_000,
      apr: 583,
      apr7d: 400,
      feeTier: '0.25%',
      priceUsd: '10',
      safetyScore: 90,
      ilRisk: '中',
      isRwaOrVerified: true,
    },
  ];

  const ranked = rankPools(pools, turboCfg);
  assert.equal(getMaxPoolExposureShare(ranked.find((p) => p.id === 'vvv-shallow')), 0.38);
  assert.equal(getMaxPoolExposureShare(ranked.find((p) => p.id === 'wsol-hsol')), 1);

  const rec = evaluateAutonomousHighYieldSwitch({
    rankedPools: ranked,
    activePositions: [
      { poolId: 'vvv-shallow', poolName: 'VVV / USDC', nftMint: 'nft-vvv', injectedValueUsd: 307, inRange: true },
      { poolId: 'nflx-rwa', poolName: 'NFLX / USDC', nftMint: 'nft-nflx', injectedValueUsd: 75, inRange: true },
      { poolId: 'wsol-hsol', poolName: 'WSOL / hSOL', nftMint: 'nft-hsol', injectedValueUsd: 14, inRange: true },
    ],
    idleDeployableUsd: 40,
    usdcBalance: 40,
    config: turboCfg,
  });

  // Must NEVER suggest topping up VVV/USDC when it is already 70%+ of equity!
  assert.notEqual(rec.topUpExistingPosition?.poolId, 'vvv-shallow');
});

test('high-utilization >=$100 portfolio requires >=$15 idle before triggering incremental top-up', () => {
  const turboCfg = buildPresetForCapital(200, 'turbo-high-yield');
  const pools: PoolMetrics[] = [
    {
      id: 'wsol-hsol',
      name: 'WSOL / hSOL',
      dex: 'RAYDIUM CLMM',
      address: '9m6cYJ8dd26Smzh35qDvFjkyqvMWYw1CwG5R5F7xWg9Q',
      tvl: 2_270_000,
      volume24h: 3_100_000,
      vol7d: 20_000_000,
      apr: 144,
      apr7d: 120,
      apr30d: 110,
      feeTier: '0.01%',
      priceUsd: '73',
      safetyScore: 98,
      ilRisk: '低',
      isBluechip: true,
    },
    {
      id: 'vvv-shallow',
      name: 'VVV / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'BJcSKhxWzJPs6H3pi7LddVa6PryM8NH2T1hZAeFEHeDU',
      tvl: 122_000,
      volume24h: 360_000,
      vol7d: 2_800_000,
      apr: 1113,
      apr7d: 758,
      apr30d: 447,
      feeTier: '0.25%',
      priceUsd: '4.1',
      safetyScore: 86,
      ilRisk: '中',
    },
    {
      id: 'nflx-rwa',
      name: 'NFLX / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'E3muPLAM111111111111111111111111111111111111',
      tvl: 190_000,
      volume24h: 350_000,
      vol7d: 2_000_000,
      apr: 470,
      apr7d: 320,
      apr30d: 280,
      feeTier: '0.25%',
      priceUsd: '88',
      safetyScore: 90,
      ilRisk: '中',
      isRwaOrVerified: true,
    },
  ];
  const ranked = rankPools(pools, turboCfg);

  const activePositions = [
    { poolId: 'wsol-hsol', poolName: 'WSOL / hSOL', nftMint: 'nft-hsol', injectedValueUsd: 89.75, inRange: true },
    { poolId: 'vvv-shallow', poolName: 'VVV / USDC', nftMint: 'nft-vvv', injectedValueUsd: 95.47, inRange: true },
    { poolId: 'nflx-rwa', poolName: 'NFLX / USDC', nftMint: 'nft-nflx', injectedValueUsd: 75.85, inRange: true },
  ];

  // With $261.07 active LP and 0.1815 SOL (~$9.75 deployable after 0.048 SOL reserve), should NOT churn gas
  const lowSparePlan = calculateAutoPortfolioPlan({
    solBalance: 0.1815,
    usdcBalance: 0,
    solPriceUsd: 73.06,
    activePositions,
    rankedPools: ranked,
    config: turboCfg,
  });
  assert.equal(lowSparePlan.incrementalTriggerActive, false);
  assert.equal(lowSparePlan.utilizationStatusLabel, '资金高利用率做市中');

  const lowSpareRec = evaluateAutonomousHighYieldSwitch({
    rankedPools: ranked,
    activePositions,
    idleDeployableUsd: lowSparePlan.idleDeployableUsd,
    usdcBalance: 0,
    config: turboCfg,
  });
  assert.equal(lowSpareRec.decision, 'HOLD_OPTIMAL');
  assert.equal(lowSpareRec.shouldAct, false);

  // With $18+ idle deployable funds, incremental deployment triggers normally
  const highSparePlan = calculateAutoPortfolioPlan({
    solBalance: 0.3,
    usdcBalance: 0,
    solPriceUsd: 73.06,
    activePositions,
    rankedPools: ranked,
    config: turboCfg,
  });
  assert.equal(highSparePlan.incrementalTriggerActive, true);
  assert.ok(highSparePlan.incrementalBudgetUsd >= 15);
});

test('non-losing healthy pools never trigger unnecessary close/rebalance/withdraw/compound gas waste', () => {
  const turboCfg = buildPresetForCapital(200, 'turbo-high-yield');
  const steadyCfg = buildPresetForCapital(200, 'balanced-steady'); // minTVL = 2M

  const pools: PoolMetrics[] = [
    {
      id: 'wsol-hsol',
      name: 'WSOL / hSOL',
      dex: 'RAYDIUM CLMM',
      address: '9m6cYJ8dd26Smzh35qDvFjkyqvMWYw1CwG5R5F7xWg9Q',
      tvl: 2_270_000,
      volume24h: 3_100_000,
      vol7d: 20_000_000,
      apr: 144,
      apr7d: 120,
      feeTier: '0.01%',
      priceUsd: '73',
      safetyScore: 98,
      ilRisk: '低',
      isBluechip: true,
    },
    {
      id: 'vvv-usdc',
      name: 'VVV / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'BJcSKhxWzJPs6H3pi7LddVa6PryM8NH2T1hZAeFEHeDU',
      tvl: 122_000,
      volume24h: 360_000,
      vol7d: 2_800_000,
      apr: 1042,
      apr7d: 758,
      feeTier: '0.25%',
      priceUsd: '27',
      safetyScore: 86,
      ilRisk: '中',
    },
    {
      id: 'nflx-usdc',
      name: 'NFLX / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'E3mugzPiMhKGrDcfcz5ojo7HJBbYA6UMaJvSzbabPLAM',
      tvl: 190_000,
      volume24h: 350_000,
      vol7d: 2_000_000,
      apr: 470,
      apr7d: 320,
      feeTier: '0.25%',
      priceUsd: '59',
      safetyScore: 90,
      ilRisk: '中',
      isRwaOrVerified: true,
    },
  ];
  const rankedSteady = rankPools(pools, steadyCfg);
  const rankedTurbo = rankPools(pools, turboCfg);

  // 1. Healthy $122K-$190K pools with 0% TVL drop must NOT falsely trigger DEPTH_DROP_REDUCE or LIQUIDITY_DEPLETION even under balanced-steady ($2M minTVL)
  const steadyPositions = [
    {
      poolId: 'wsol-hsol',
      poolName: 'WSOL / hSOL',
      nftMint: 'nft1',
      injectedValueUsd: 90,
      priceCurrentUsd: 0.84,
      priceLowerUsd: 0.82,
      priceUpperUsd: 0.86,
      unrealizedPnlPct: 0.3,
      inRange: true,
    },
    {
      poolId: 'vvv-usdc',
      poolName: 'VVV / USDC',
      nftMint: 'nft2',
      injectedValueUsd: 95,
      priceCurrentUsd: 33.5, // Moved UP +24% vs midpoint -> profitable in USD!
      priceLowerUsd: 26,
      priceUpperUsd: 28,
      unrealizedPnlPct: 2.1,
      inRange: true,
    },
    {
      poolId: 'nflx-usdc',
      poolName: 'NFLX / USDC',
      nftMint: 'nft3',
      injectedValueUsd: 76,
      priceCurrentUsd: 59,
      priceLowerUsd: 57,
      priceUpperUsd: 61,
      unrealizedPnlPct: 0.1,
      inRange: true,
    },
  ];

  const withdrawSteady = evaluateSafeWithdrawSafety({
    activePositions: steadyPositions,
    rankedPools: rankedSteady,
    baselinePoolTvls: { 'wsol-hsol': 2_270_000, 'vvv-usdc': 122_000, 'nflx-usdc': 190_000 },
    depletionStreaks: { 'wsol-hsol': 0, 'vvv-usdc': 0, 'nflx-usdc': 0 },
    config: steadyCfg,
  });
  assert.equal(withdrawSteady.shouldAutoWithdraw, false);
  assert.equal(withdrawSteady.triggerType, 'SAFE_HOLD');

  // 2. Profitable non-losing pools with 20%+ weight difference (e.g. $95 / $55 / $30) must NOT tear down & re-open via SHARE_DRIFT_REBALANCE
  const rebalanceNonLosing = evaluateAutoAssetRebalance({
    activePositions: [
      { poolId: 'vvv-usdc', poolName: 'VVV / USDC', nftMint: 'nft2', injectedValueUsd: 95, unrealizedPnlPct: 0.5, inRange: true },
      { poolId: 'wsol-hsol', poolName: 'WSOL / hSOL', nftMint: 'nft1', injectedValueUsd: 55, unrealizedPnlPct: 0.2, inRange: true },
      { poolId: 'nflx-usdc', poolName: 'NFLX / USDC', nftMint: 'nft3', injectedValueUsd: 30, unrealizedPnlPct: 0.1, inRange: true },
    ],
    rankedPools: rankedTurbo,
    baselinePoolTvls: { 'wsol-hsol': 2_270_000, 'vvv-usdc': 122_000, 'nflx-usdc': 190_000 },
    outOfRangeStreaks: { 'vvv-usdc': 0, 'wsol-hsol': 0, 'nflx-usdc': 0 },
    config: turboCfg,
  });
  assert.equal(rebalanceNonLosing.shouldRebalance, false);

  // 3. Brief 1-tick out-of-range wick on a non-losing pool must NOT immediately close & reopen (waits for streak >= 3)
  const wickOutOfRange = evaluateAutoAssetRebalance({
    activePositions: [
      { poolId: 'wsol-hsol', poolName: 'WSOL / hSOL', nftMint: 'nft1', injectedValueUsd: 90, unrealizedPnlPct: 0.05, inRange: false },
      { poolId: 'vvv-usdc', poolName: 'VVV / USDC', nftMint: 'nft2', injectedValueUsd: 95, unrealizedPnlPct: 0.2, inRange: true },
    ],
    rankedPools: rankedTurbo,
    baselinePoolTvls: { 'wsol-hsol': 2_270_000, 'vvv-usdc': 122_000 },
    outOfRangeStreaks: { 'wsol-hsol': 1, 'vvv-usdc': 0 },
    config: turboCfg,
  });
  assert.equal(wickOutOfRange.shouldRebalance, false);

  // 4. High-APR in-range pool (144%) must NOT rotate just because another pool has 190% APR (+46% isn't worth close+swap+open gas)
  const smallGainPools = rankPools(
    [
      ...pools,
      {
        id: 'modest-new',
        name: 'JLP / USDC',
        dex: 'RAYDIUM CLMM',
        address: 'JLP1111111111111111111111111111111111111111',
        tvl: 1_500_000,
        volume24h: 2_000_000,
        vol7d: 14_000_000,
        apr: 195,
        apr7d: 170,
        feeTier: '0.25%',
        priceUsd: '3.5',
        safetyScore: 92,
        ilRisk: '中',
      },
    ],
    turboCfg
  );
  const noChurnRot = evaluateAutonomousHighYieldSwitch({
    rankedPools: smallGainPools,
    activePositions: [
      { poolId: 'wsol-hsol', poolName: 'WSOL / hSOL', nftMint: 'nft1', injectedValueUsd: 90, inRange: true },
      { poolId: 'vvv-usdc', poolName: 'VVV / USDC', nftMint: 'nft2', injectedValueUsd: 95, inRange: true },
      { poolId: 'nflx-usdc', poolName: 'NFLX / USDC', nftMint: 'nft3', injectedValueUsd: 76, inRange: true },
    ],
    idleDeployableUsd: 2,
    usdcBalance: 0,
    config: turboCfg,
  });
  assert.equal(noChurnRot.decision, 'HOLD_OPTIMAL');
  assert.equal(noChurnRot.shouldAct, false);

  // 5. Three parallel positions with $0.15 each ($0.45 sum) must NOT trigger 6 harvest+compound TXs for dust fees
  const dustCompound = evaluateAutoCompoundOpportunity({
    activePositions: [
      { poolId: 'wsol-hsol', poolName: 'WSOL / hSOL', nftMint: 'nft1', uncollectedFeeUsd: 0.15, injectedValueUsd: 90 },
      { poolId: 'vvv-usdc', poolName: 'VVV / USDC', nftMint: 'nft2', uncollectedFeeUsd: 0.15, injectedValueUsd: 95 },
      { poolId: 'nflx-usdc', poolName: 'NFLX / USDC', nftMint: 'nft3', uncollectedFeeUsd: 0.15, injectedValueUsd: 76 },
    ],
    config: turboCfg,
    referenceAprPct: 200,
  });
  assert.equal(dustCompound.shouldCompound, false);
  assert.equal(dustCompound.targets.length, 0);
});

test('evaluateLiveRiskAlerts aligns with turbo-high-yield eligibility and avoids false-critical block alerts on held pools', () => {
  const turboCfg = buildPresetForCapital(200, 'turbo-high-yield');
  const rankedTurbo = rankPools(
    [
      {
        id: 'vvv-usdc',
        name: 'VVV / USDC',
        dex: 'RAYDIUM CLMM',
        address: 'BJcSKhxWzJPs6H3pi7LddVa6PryM8NH2T1hZAeFEHeDU',
        tvl: 123_000,
        volume24h: 360_000,
        vol7d: 2_800_000,
        apr: 943,
        apr7d: 758,
        feeTier: '0.25%',
        priceUsd: '4.1',
        safetyScore: 86,
        ilRisk: '中',
      },
      {
        id: 'nflx-usdc',
        name: 'NFLX / USDC',
        dex: 'RAYDIUM CLMM',
        address: 'E3mugzPiMhKGrDcfcz5ojo7HJBbYA6UMaJvSzbabPLAM',
        tvl: 190_000,
        volume24h: 350_000,
        vol7d: 2_000_000,
        apr: 470,
        apr7d: 320,
        feeTier: '0.25%',
        priceUsd: '59',
        safetyScore: 90,
        ilRisk: '中',
        isRwaOrVerified: true,
      },
      {
        id: 'meme-rug',
        name: 'SCAM / SOL',
        dex: 'RAYDIUM CLMM',
        address: '33333333333333333333333333333333',
        tvl: 110_000,
        volume24h: 2_500_000,
        vol7d: 2_600_000,
        apr: 1800,
        apr7d: 0,
        feeTier: '1.00%',
        priceUsd: '0.01',
        safetyScore: 60,
        ilRisk: '高',
      },
    ],
    turboCfg
  );

  const alerts = evaluateLiveRiskAlerts({
    pools: rankedTurbo,
    jupiterImpactBps: 0.42,
    heliusLatencyMs: 95,
    privateKeyConfigured: true,
    config: turboCfg,
    nowTime: '21:30:00',
  });

  // Eligible VVV/USDC and NFLX/USDC must NEVER be marked critical "自动风控已拦截入场"
  assert.equal(
    alerts.some(
      (a) => (a.target === 'VVV / USDC' || a.target === 'NFLX / USDC') && a.severity === 'critical'
    ),
    false
  );
  // Eligible high-APR pools are transparently reported at info severity instead
  assert.ok(
    alerts.some(
      (a) =>
        a.target === 'VVV / USDC' &&
        a.severity === 'info' &&
        a.category === '高息卫星池风控监控'
    )
  );
  // Genuinely rug-blocked pool still raises a critical alert
  assert.ok(
    alerts.some((a) => a.target === 'SCAM / SOL' && a.severity === 'critical')
  );
});

test('barbell core-satellite architecture: guarantees anchor for slot 1, caps volatile satellites at <=25%, and blocks anchor rotation into meme coins', () => {
  const barbellCfg = buildPresetForCapital(500, 'active-yield');
  assert.equal(barbellCfg.coreSplitPct, 75);
  assert.equal(barbellCfg.stopLossPercentage, 5);

  const pools: PoolMetrics[] = [
    {
      id: 'wsol-hsol-anchor',
      name: 'WSOL / hSOL',
      dex: 'RAYDIUM CLMM',
      address: 'wsol-hsol-anchor',
      tvl: 2_300_000,
      volume24h: 3_200_000,
      vol7d: 22_000_000,
      apr: 118,
      apr7d: 110,
      feeTier: '0.01%',
      priceUsd: '72',
      safetyScore: 98,
      ilRisk: '低',
      isBluechip: true,
    },
    {
      id: 'vvv-satellite',
      name: 'VVV / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'vvv-satellite',
      tvl: 125_000,
      volume24h: 400_000,
      vol7d: 2_900_000,
      apr: 980,
      apr7d: 760,
      feeTier: '0.25%',
      priceUsd: '25.5',
      safetyScore: 86,
      ilRisk: '中',
    },
    {
      id: 'nflx-satellite',
      name: 'NFLX / USDC',
      dex: 'RAYDIUM CLMM',
      address: 'nflx-satellite',
      tvl: 195_000,
      volume24h: 370_000,
      vol7d: 2_100_000,
      apr: 460,
      apr7d: 310,
      feeTier: '0.25%',
      priceUsd: '60',
      safetyScore: 90,
      ilRisk: '中',
      isRwaOrVerified: true,
    },
  ];

  // 1. Verify anchor identification
  assert.equal(isLowIlAnchorPool(pools[0]), true);
  assert.equal(isLowIlAnchorPool(pools[1]), false);

  const ranked = rankPools(pools, barbellCfg);

  // 2. Portfolio plan assigns WSOL/hSOL as Core Pool with 70%~75% share, NOT high-APR VVV
  const plan = calculateAutoPortfolioPlan({
    solBalance: 1.5,
    usdcBalance: 300,
    solPriceUsd: 72,
    activePositions: [],
    rankedPools: ranked,
    config: barbellCfg,
  });

  assert.equal(plan.slotPlans.length, 3);
  const slot1 = plan.slotPlans[0];
  assert.equal(slot1.poolName, 'WSOL / hSOL');
  assert.equal(slot1.role, 'core');
  assert.equal(slot1.rangeWidthPct, 2); // Ultra-narrow ±2% range for LST
  // Core slot gets ~70% of budget
  assert.ok(slot1.targetUsd >= plan.slotPlans.reduce((s, p) => s + p.targetUsd, 0) * 0.68);

  // Satellites get ~15% each
  const slot2 = plan.slotPlans[1];
  const slot3 = plan.slotPlans[2];
  assert.ok(slot2.targetUsd < plan.slotPlans.reduce((s, p) => s + p.targetUsd, 0) * 0.20);
  assert.ok(slot3.targetUsd < plan.slotPlans.reduce((s, p) => s + p.targetUsd, 0) * 0.20);

  // 3. evaluateAutonomousHighYieldSwitch blocks rotating out of WSOL/hSOL anchor into WSOL/ANT
  const antPool: PoolMetrics = {
    id: 'ant-high-yield',
    name: 'WSOL / ANT',
    dex: 'RAYDIUM CLMM',
    address: 'ant-high-yield',
    tvl: 180_000,
    volume24h: 300_000,
    vol7d: 1_800_000,
    apr: 240, // higher than WSOL/hSOL's 118%!
    apr7d: 180,
    feeTier: '0.25%',
    priceUsd: '90',
    safetyScore: 86,
    ilRisk: '中',
  };
  const rankedWithAnt = rankPools([...pools, antPool], barbellCfg);

  const rotateRec = evaluateAutonomousHighYieldSwitch({
    rankedPools: rankedWithAnt,
    activePositions: [
      {
        poolId: 'wsol-hsol-anchor',
        poolName: 'WSOL / hSOL',
        nftMint: 'nft-hsol',
        injectedValueUsd: 380,
        inRange: true,
      },
    ],
    idleDeployableUsd: 1.0,
    usdcBalance: 0,
    config: barbellCfg,
  });

  // Must HOLD_OPTIMAL and refuse to rotate the anchor into ANT!
  assert.equal(rotateRec.decision, 'HOLD_OPTIMAL');
  assert.equal(rotateRec.shouldAct, false);
  assert.ok(rotateRec.headline.includes('压舱池'));
});

