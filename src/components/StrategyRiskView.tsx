import React, { useState, useEffect, useMemo } from 'react';
import {
  CheckCircle2,
  ShieldCheck,
  Wallet,
  SlidersHorizontal,
  TrendingUp,
  AlertTriangle,
  Sparkles,
  ArrowRightLeft,
  RefreshCw,
  Layers,
  Gauge,
  Scale,
  Repeat,
  Activity,
  Shield,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import {
  ActiveLpPosition,
  RiskProfileKey,
  ScoredPool,
  StrategyConfig,
  computePositionRangeDeviation,
  estimateNetYieldForCapital,
  evaluateAutoAssetRebalance,
  evaluateAutoCompoundOpportunity,
  evaluateAutonomousHighYieldSwitch,
  evaluateMultiCurrencyHedgePlan,
  evaluateSafeWithdrawSafety,
} from '../utils/strategyEngine';
import { BackendStatus } from './OverviewAndKeysView';

interface StrategyRiskProps {
  strategyConfig: StrategyConfig;
  topPool?: ScoredPool;
  pools?: ScoredPool[];
  activePositions?: ActiveLpPosition[];
  backendStatus?: BackendStatus;
  onApplyPreset: (capitalUsdt: number, riskProfile: RiskProfileKey) => Promise<boolean>;
  onUpdateStrategyConfig?: (config: StrategyConfig) => void;
  onUpdateBackendStatus?: (status: BackendStatus) => void;
  onRefreshPositions?: () => Promise<void>;
}

const CAPITAL_PRESETS = [100, 200, 500];

export const StrategyRiskView: React.FC<StrategyRiskProps> = ({
  strategyConfig,
  topPool,
  pools = [],
  activePositions = [],
  backendStatus,
  onApplyPreset,
  onUpdateStrategyConfig,
  onUpdateBackendStatus,
  onRefreshPositions,
}) => {
  const [capitalInput, setCapitalInput] = useState(strategyConfig.capitalUsdt);
  const [selectedProfile, setSelectedProfile] = useState<RiskProfileKey>(
    strategyConfig.riskProfile
  );
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [switchingYield, setSwitchingYield] = useState(false);
  const [togglingAutomation, setTogglingAutomation] = useState(false);
  const [withdrawingSafe, setWithdrawingSafe] = useState(false);
  const [compoundingNow, setCompoundingNow] = useState(false);
  const [hedgingNow, setHedgingNow] = useState(false);
  const [switchFeedback, setSwitchFeedback] = useState<{
    ok: boolean;
    message: string;
    txId?: string;
  } | null>(null);

  useEffect(() => {
    setCapitalInput(strategyConfig.capitalUsdt);
    setSelectedProfile(strategyConfig.riskProfile);
  }, [strategyConfig]);

  const portfolioPlan = backendStatus?.strategyDiagnostic?.portfolioPlan;
  const idleDeployableUsd = portfolioPlan?.idleDeployableUsd ?? 0;
  const walletUsdcBalance = backendStatus?.strategyDiagnostic?.walletUsdcBalance ?? portfolioPlan?.deployableUsdc ?? 0;
  const activeInjectedUsd =
    portfolioPlan?.activeInjectedUsd ??
    Number(activePositions.reduce((s, p) => s + Math.max(0, p.injectedValueUsd), 0).toFixed(2));
  const utilizationPct = portfolioPlan?.utilizationPct ?? 0;
  const multiParallelOn = strategyConfig.multiPositionParallel !== false;
  const smartAllocOn = strategyConfig.smartCapitalAllocation !== false;
  const autoRebalanceOn = strategyConfig.autoAssetRebalance !== false;
  const autoWithdrawSafetyOn = strategyConfig.autoWithdrawSafety !== false;
  const autoCompoundOn = strategyConfig.autoCompound !== false;
  const multiCurrencyHedgeOn = strategyConfig.multiCurrencyHedge !== false;
  const largeCapitalProtOn = strategyConfig.largeCapitalProtection !== false;
  const usdcExceedsInjected = walletUsdcBalance > activeInjectedUsd && walletUsdcBalance >= 2;
  const incrementalArmed = smartAllocOn && (idleDeployableUsd >= 5 || usdcExceedsInjected);

  const recommendation = useMemo(() => {
    if (pools.length > 0) {
      return evaluateAutonomousHighYieldSwitch({
        rankedPools: pools,
        activePositions,
        idleDeployableUsd,
        usdcBalance: walletUsdcBalance,
        config: strategyConfig,
      });
    }
    return (
      backendStatus?.strategyDiagnostic?.highYieldRecommendation ||
      evaluateAutonomousHighYieldSwitch({
        rankedPools: [],
        activePositions,
        idleDeployableUsd,
        usdcBalance: walletUsdcBalance,
        config: strategyConfig,
      })
    );
  }, [pools, activePositions, idleDeployableUsd, walletUsdcBalance, strategyConfig, backendStatus]);

  const rebalancePlan = useMemo(() => {
    const backendPlan = backendStatus?.strategyDiagnostic?.rebalancePlan;
    if (backendPlan && backendPlan.enabled === autoRebalanceOn) {
      return backendPlan;
    }
    return evaluateAutoAssetRebalance({
      activePositions,
      rankedPools: pools,
      config: strategyConfig,
    });
  }, [backendStatus, autoRebalanceOn, activePositions, pools, strategyConfig]);

  const safeWithdrawPlan = useMemo(() => {
    const backendPlan = backendStatus?.strategyDiagnostic?.safeWithdrawPlan;
    if (backendPlan && backendPlan.enabled === autoWithdrawSafetyOn) {
      return backendPlan;
    }
    return evaluateSafeWithdrawSafety({
      activePositions,
      rankedPools: pools,
      config: strategyConfig,
    });
  }, [backendStatus, autoWithdrawSafetyOn, activePositions, pools, strategyConfig]);

  const referenceApr = topPool && topPool.apr > 0 ? topPool.apr : 58;

  const autoCompoundPlan = useMemo(() => {
    const backendPlan = backendStatus?.strategyDiagnostic?.autoCompoundPlan;
    if (backendPlan && backendPlan.enabled === autoCompoundOn) {
      return backendPlan;
    }
    return evaluateAutoCompoundOpportunity({
      activePositions,
      config: strategyConfig,
      referenceAprPct: referenceApr,
    });
  }, [backendStatus, autoCompoundOn, activePositions, strategyConfig, referenceApr]);

  const multiHedgePlan = useMemo(() => {
    const backendPlan = backendStatus?.strategyDiagnostic?.multiCurrencyHedgePlan;
    if (backendPlan && backendPlan.enabled === multiCurrencyHedgeOn) {
      return backendPlan;
    }
    return evaluateMultiCurrencyHedgePlan({
      activePositions,
      reserves: [],
      walletUsdcBalance,
      solPriceUsd: backendStatus?.strategyDiagnostic?.solPriceUsd || 85,
      config: strategyConfig,
    });
  }, [backendStatus, multiCurrencyHedgeOn, activePositions, walletUsdcBalance, strategyConfig]);

  const positionDeviations = useMemo(
    () => activePositions.map((pos) => computePositionRangeDeviation(pos)),
    [activePositions]
  );

  const chartSeriesData = useMemo(() => {
    const rawHistory = backendStatus?.strategyDiagnostic?.positionPnlHistory || [];
    if (rawHistory.length >= 2) {
      return rawHistory.map((pt) => ({
        label: pt.time,
        pnlUsd: pt.totalPnlUsd,
        feesUsd: pt.totalFeesUsd,
        rangeOffsetPct: pt.maxRangeOffsetPct,
      }));
    }
    if (positionDeviations.length > 0) {
      return positionDeviations.map((d) => ({
        label: d.poolName,
        pnlUsd: d.cumulativePnlUsd,
        feesUsd: d.uncollectedFeeUsd,
        rangeOffsetPct: d.rangeOffsetPct,
      }));
    }
    // Truthful baseline series when wallet has 0 active positions (zero fake profits)
    if (rawHistory.length === 1) {
      return [
        { label: '初始基线', pnlUsd: 0, feesUsd: 0, rangeOffsetPct: 0 },
        {
          label: rawHistory[0].time,
          pnlUsd: rawHistory[0].totalPnlUsd,
          feesUsd: rawHistory[0].totalFeesUsd,
          rangeOffsetPct: rawHistory[0].maxRangeOffsetPct,
        },
      ];
    }
    return [
      { label: 'T-1', pnlUsd: 0, feesUsd: 0, rangeOffsetPct: 0 },
      { label: '实时', pnlUsd: 0, feesUsd: 0, rangeOffsetPct: 0 },
    ];
  }, [backendStatus, positionDeviations]);

  const pnlYAxisDomain = useMemo<[number, number]>(() => {
    const vals = chartSeriesData.map((d) => Number(d.pnlUsd || 0));
    const maxAbs = vals.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    if (maxAbs < 0.5) return [-1, 1];
    const pad = Number((maxAbs * 1.25).toFixed(2));
    return [-pad, pad];
  }, [chartSeriesData]);
  const yieldEst = estimateNetYieldForCapital(
    strategyConfig.lpActiveUsdt,
    referenceApr,
    strategyConfig.rangeWidthPct,
    strategyConfig.riskProfile,
    strategyConfig.autoCompound
  );

  const coreUsd = Number(
    ((strategyConfig.lpActiveUsdt * strategyConfig.coreSplitPct) / 100).toFixed(1)
  );
  const satelliteUsd = Number((strategyConfig.lpActiveUsdt - coreUsd).toFixed(1));
  const maxDrawdownUsd = Number(
    ((strategyConfig.capitalUsdt * strategyConfig.stopLossPercentage) / 100).toFixed(1)
  );

  const handleApply = async (nextCapital: number, nextProfile: RiskProfileKey) => {
    setSaving(true);
    setSavedNotice(false);
    const ok = await onApplyPreset(nextCapital, nextProfile);
    setSaving(false);
    if (ok) {
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    }
  };

  const handleAutonomousHighYieldSwitch = async () => {
    setSwitchingYield(true);
    setSwitchFeedback(null);
    try {
      const res = await fetch('/api/strategy/auto-yield-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.backendStatus && onUpdateBackendStatus) {
        onUpdateBackendStatus(data.backendStatus);
      }
      if (onRefreshPositions) {
        await onRefreshPositions();
      }
      setSwitchFeedback({
        ok: Boolean(data.success),
        message: data.message || data.error || '已完成自主高收益池评估',
        txId: data.txId,
      });
    } catch (err: any) {
      setSwitchFeedback({
        ok: false,
        message: err?.message || '网络异常，请稍后再试',
      });
    } finally {
      setSwitchingYield(false);
    }
  };

  const handleOneClickSafeWithdraw = async (nftMint?: string) => {
    setWithdrawingSafe(true);
    setSwitchFeedback(null);
    try {
      const res = await fetch('/api/strategy/safe-withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nftMint ? { nftMint } : {}),
      });
      const data = await res.json();
      if (data.backendStatus && onUpdateBackendStatus) {
        onUpdateBackendStatus(data.backendStatus);
      }
      if (onRefreshPositions) {
        await onRefreshPositions();
      }
      setSwitchFeedback({
        ok: Boolean(data.success),
        message: data.message || data.error || '已完成安全回撤评估',
        txId: data.txId,
      });
    } catch (err: any) {
      setSwitchFeedback({
        ok: false,
        message: err?.message || '一键安全回撤请求异常，请稍后重试',
      });
    } finally {
      setWithdrawingSafe(false);
    }
  };

  const handleRunAutoCompound = async () => {
    setCompoundingNow(true);
    setSwitchFeedback(null);
    try {
      const res = await fetch('/api/strategy/auto-compound', { method: 'POST' });
      const data = await res.json();
      if (data.backendStatus && onUpdateBackendStatus) {
        onUpdateBackendStatus(data.backendStatus);
      }
      if (onRefreshPositions) {
        await onRefreshPositions();
      }
      setSwitchFeedback({
        ok: Boolean(data.success),
        message: data.message || data.error || '已完成自动复利检测',
        txId: data.txId,
      });
    } catch (err: any) {
      setSwitchFeedback({
        ok: false,
        message: err?.message || '自动复利请求异常，请稍后重试',
      });
    } finally {
      setCompoundingNow(false);
    }
  };

  const handleToggleAutomationOption = async (
    field:
      | 'multiPositionParallel'
      | 'smartCapitalAllocation'
      | 'autoAssetRebalance'
      | 'autoWithdrawSafety'
      | 'autoCompound'
      | 'multiCurrencyHedge'
      | 'largeCapitalProtection',
    nextVal: boolean
  ) => {
    setTogglingAutomation(true);
    try {
      const res = await fetch('/api/strategy/automation-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: nextVal }),
      });
      const data = await res.json();
      if (data.success && data.strategyConfig && onUpdateStrategyConfig) {
        onUpdateStrategyConfig(data.strategyConfig);
      }
      if (data.backendStatus && onUpdateBackendStatus) {
        onUpdateBackendStatus(data.backendStatus);
      }
      if (onRefreshPositions) {
        await onRefreshPositions();
      }
      setSwitchFeedback({
        ok: Boolean(data.success),
        message:
          field === 'multiPositionParallel'
            ? nextVal
              ? '已开启「多仓位并行」：系统将在保留原有仓位的前提下自动分散资金到多个高 APR 池，并已触发全自动评估。'
              : '已切换为「单仓聚焦模式」：系统将自动把资金集中到单一最优高收益池。'
            : field === 'smartCapitalAllocation'
            ? nextVal
              ? '已开启「智能资金分配」：已启动钱包空余资金实时监测，发现 USDC/闲置资金超出在池价值时将自动触发增量加仓。'
              : '已暂停「智能资金分配」：当前仅保留已有仓位风控与止损守护。'
            : field === 'autoAssetRebalance'
            ? nextVal
              ? `已开启「自动资产重平衡」：当任一池子深度骤降 ≥${rebalancePlan.depthDropThresholdPct}% 或并行仓位占比偏离超过 ±${rebalancePlan.driftThresholdPct}% 时，将全自动调整资金比例。`
              : '已暂停「自动资产重平衡」：当前仅监测仓位占比偏离与池深突变，不自动调仓。'
            : field === 'autoWithdrawSafety'
            ? nextVal
              ? `已开启「自动安全回撤守护」：当持续流动性枯竭（≥${safeWithdrawPlan.persistentTicksRequired} 轮）或无常损失达到 ${safeWithdrawPlan.maxILTolerancePct}% 阈值时，将自动撤出资金并兑换为 USDC 存入钱包。`
              : '已暂停「自动安全回撤守护」：已停止自动撤池转 USDC，但您仍可随时点击「一键安全回撤」手动避险。'
            : field === 'autoCompound'
            ? nextVal
              ? `已开启「自动复利模式」：检测到待收取耕作收益达到 $${autoCompoundPlan.harvestMinUsd.toFixed(2)} 时，将全自动领取手续费并重注入（Auto-Compound）滚雪球放大 APY。`
              : '已暂停「自动复利模式」：耕作手续费收益将留在仓位内，不再自动领取再注入。'
            : field === 'multiCurrencyHedge'
            ? nextVal
              ? '已开启「多币种对冲」：系统已接入 Solend / Kamino 等 Solana 原生借贷协议实时费率，自动以 USDC 抵押借币卖空实现 Delta-Neutral，消除无常损失风险。'
              : '已暂停「多币种对冲」：不再自动通过 Solana 原生借贷协议建立空头对冲头寸。'
            : nextVal
            ? '已开启「大额资金阈值保护」：当总资金超过 $300 阈值时，系统自动调低对冲策略杠杆倍数（降至 LTV 30%）以防止极端波动穿仓。'
            : '已暂停「大额资金阈值保护」：恢复标准对冲杠杆比例。',
      });
    } catch (err: any) {
      setSwitchFeedback({
        ok: false,
        message: err?.message || '切换自动化选项失败，请稍后重试',
      });
    } finally {
      setTogglingAutomation(false);
    }
  };

  const handleRunMultiCurrencyHedge = async () => {
    setHedgingNow(true);
    setSwitchFeedback(null);
    try {
      const res = await fetch('/api/strategy/multi-currency-hedge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.backendStatus && onUpdateBackendStatus) {
        onUpdateBackendStatus(data.backendStatus);
      }
      if (onRefreshPositions) {
        await onRefreshPositions();
      }
      setSwitchFeedback({
        ok: Boolean(data.success),
        message: data.message || data.error || '已完成多币种借贷空头对冲巡检',
        txId: data.txId,
      });
    } catch (err: any) {
      setSwitchFeedback({
        ok: false,
        message: err?.message || '多币种借贷对冲巡检失败，请检查网络连接',
      });
    } finally {
      setHedgingNow(false);
    }
  };

  const decisionBadge =
    recommendation.decision === 'OPEN_NEW'
      ? {
          text: '有闲置资金 → 自主决定直开高收益新池',
          cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
        }
      : recommendation.decision === 'ROTATE_SWAP'
      ? {
          text: '无闲置资金 → 自主决定平旧换新池',
          cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
        }
      : activePositions.length === 0
      ? {
          text: '可用资金不足 $5 → 等待资金到位',
          cls: 'bg-slate-800 text-slate-300 border-slate-700',
        }
      : {
          text: '当前已是性价比优选 → 自主决定不折腾',
          cls: 'bg-slate-800 text-slate-300 border-slate-700',
        };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">
            {strategyConfig.capitalUsdt}U 收益率分级与真实概率风控中心
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            通过收窄 CLMM 集中做市区间（提升手续费密度）、开启自动复利与核心+卫星双仓轮动，可在风险可控前提下突破纯保守模式收益上限。
          </p>
        </div>
        {savedNotice && (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium shrink-0">
            <CheckCircle2 className="w-4 h-4" />
            已切换方案并同步更新选池与风控规则
          </span>
        )}
      </div>

      {/* High-Yield Autonomous Recommendation + Parallel Multi-Position + Smart Capital Allocation */}
      <section
        aria-label="高收益自动推荐"
        className="p-6 rounded-xl bg-[#101624] border border-emerald-500/35 space-y-5"
      >
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-2 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-white">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                高收益自动推荐
              </span>
              <span
                className={`px-2 py-0.5 text-[11px] font-medium rounded border ${decisionBadge.cls}`}
              >
                {decisionBadge.text}
              </span>
            </div>
            <h2 className="text-sm font-semibold text-emerald-300">
              {recommendation.headline}
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
              {recommendation.reason}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {/* 多仓位并行开关 */}
            <div className="px-3.5 py-2.5 rounded-lg bg-[#090d16] border border-slate-800 flex items-center gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                  <Layers className="w-3.5 h-3.5 text-sky-400" />
                  <span>多仓位并行</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {multiParallelOn ? '不平旧仓 · 自动分散多池' : '单仓聚焦 · 仅跑最优池'}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={multiParallelOn}
                aria-label="多仓位并行"
                disabled={togglingAutomation}
                onClick={() => handleToggleAutomationOption('multiPositionParallel', !multiParallelOn)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer disabled:opacity-60 ${
                  multiParallelOn
                    ? 'bg-emerald-400 border-emerald-400'
                    : 'bg-slate-800 border-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                    multiParallelOn
                      ? 'translate-x-5.5 bg-slate-950'
                      : 'translate-x-1 bg-slate-400'
                  }`}
                />
              </button>
            </div>

            <div className="flex flex-col items-start lg:items-end gap-1.5">
              <button
                type="button"
                disabled={switchingYield}
                onClick={handleAutonomousHighYieldSwitch}
                className={`px-4 py-2.5 text-xs font-semibold rounded-lg inline-flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap ${
                  recommendation.shouldAct
                    ? 'bg-emerald-400 text-slate-950 hover:bg-emerald-300'
                    : 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700'
                }`}
              >
                {switchingYield ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                )}
                <span>{switchingYield ? '正在自主执行决策...' : '切换高收益池'}</span>
              </button>
              <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                {recommendation.shouldAct
                  ? `预计建仓 $${recommendation.deployBudgetUsd.toFixed(2)} · 年化增益 +${recommendation.aprGainPct}%`
                  : `钱包可用闲置 $${idleDeployableUsd.toFixed(2)} · 当前仓位 ${activePositions.length} 个`}
              </div>
            </div>
          </div>
        </div>

        {/* 智能资金分配 & 资金利用率监控面板 */}
        <div
          aria-label="智能资金分配与利用率监控"
          className="p-4 rounded-xl bg-[#090d16] border border-slate-800 space-y-3"
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white">
                  <Gauge className="w-4 h-4 text-emerald-400" />
                  <span>智能资金分配</span>
                  <span
                    className={`px-2 py-0.5 text-[11px] rounded border ${
                      incrementalArmed
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                        : smartAllocOn
                        ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {portfolioPlan?.utilizationStatusLabel ||
                      (incrementalArmed
                        ? '自动增量加仓就绪'
                        : smartAllocOn
                        ? '全自动监控中'
                        : '自动增量已暂停')}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  自动检测钱包空余资金（当 USDC 余额高于当前已注入仓位价值或可用闲置 ≥ $5 时），无需人工干预自动触发增量加仓与风险再平衡。
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <span className="text-[11px] text-slate-400">
                {smartAllocOn ? '自动增量加仓：已开启' : '自动增量加仓：已暂停'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={smartAllocOn}
                aria-label="智能资金分配"
                disabled={togglingAutomation}
                onClick={() => handleToggleAutomationOption('smartCapitalAllocation', !smartAllocOn)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer disabled:opacity-60 ${
                  smartAllocOn
                    ? 'bg-emerald-400 border-emerald-400'
                    : 'bg-slate-800 border-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                    smartAllocOn
                      ? 'translate-x-5.5 bg-slate-950'
                      : 'translate-x-1 bg-slate-400'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* 资金利用率监控条 & 实时对比数据 */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-1">
            <div className="p-2.5 rounded-lg bg-[#101624] border border-slate-800/80">
              <div className="text-[11px] text-slate-400">当前资金利用率</div>
              <div className="mt-1 flex items-center justify-between text-xs font-mono font-bold text-white tabular-nums">
                <span>{utilizationPct}%</span>
                <span className="text-[11px] font-normal text-slate-400">
                  目标并发 {portfolioPlan?.targetSlots ?? (multiParallelOn ? 2 : 1)} 仓
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-400 transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, utilizationPct))}%` }}
                />
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#101624] border border-slate-800/80">
              <div className="text-[11px] text-slate-400">已注入仓位价值</div>
              <div className="mt-1 text-sm font-mono font-bold text-sky-300 tabular-nums">
                ${activeInjectedUsd.toFixed(2)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                活跃仓位 {activePositions.length} 个
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#101624] border border-slate-800/80">
              <div className="text-[11px] text-slate-400">钱包空余 USDC / 闲置总额</div>
              <div className="mt-1 text-sm font-mono font-bold text-emerald-400 tabular-nums">
                {walletUsdcBalance.toFixed(2)} USDC · ${idleDeployableUsd.toFixed(2)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {usdcExceedsInjected
                  ? 'USDC > 在池价值 · 触发增量加仓'
                  : idleDeployableUsd >= 5
                  ? '存在 ≥$5 可用闲置资金'
                  : '无多余未投入 USDC'}
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#101624] border border-slate-800/80">
              <div className="text-[11px] text-slate-400">本轮增量加仓额度</div>
              <div className="mt-1 text-sm font-mono font-bold text-amber-300 tabular-nums">
                {incrementalArmed
                  ? `+$${(portfolioPlan?.incrementalBudgetUsd || recommendation.deployBudgetUsd).toFixed(2)}`
                  : '$0.00'}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {incrementalArmed ? '由后台自动巡检直接执行' : '当前无需追加投入'}
              </div>
            </div>
          </div>
        </div>

        {/* 自动资产重平衡面板 */}
        <div
          aria-label="自动资产重平衡"
          className="p-4 rounded-xl bg-[#090d16] border border-slate-800 space-y-3"
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="space-y-0.5 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white">
                <Scale className="w-4 h-4 text-sky-400" />
                <span>自动资产重平衡</span>
                <span
                  className={`px-2 py-0.5 text-[11px] rounded border ${
                    !autoRebalanceOn
                      ? 'bg-slate-800 text-slate-400 border-slate-700'
                      : rebalancePlan.triggerType === 'DEPTH_DROP_REDUCE'
                      ? 'bg-rose-500/15 text-rose-300 border-rose-500/35'
                      : rebalancePlan.triggerType === 'SHARE_DRIFT_REBALANCE'
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                  }`}
                >
                  {!autoRebalanceOn
                    ? '自动重平衡已暂停'
                    : rebalancePlan.triggerType === 'DEPTH_DROP_REDUCE'
                    ? '深度骤降自动移仓'
                    : rebalancePlan.triggerType === 'SHARE_DRIFT_REBALANCE'
                    ? '比例漂移自动配平'
                    : `平衡运行中 · 阈值 ±${rebalancePlan.driftThresholdPct}%`}
                </span>
              </div>
              <div className="text-xs font-medium text-sky-300">{rebalancePlan.headline}</div>
              <p className="text-[11px] text-slate-400 leading-relaxed">{rebalancePlan.reason}</p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <span className="text-[11px] text-slate-400">
                {autoRebalanceOn ? '零干预调仓：已开启' : '零干预调仓：已暂停'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={autoRebalanceOn}
                aria-label="自动资产重平衡"
                disabled={togglingAutomation}
                onClick={() => handleToggleAutomationOption('autoAssetRebalance', !autoRebalanceOn)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer disabled:opacity-60 ${
                  autoRebalanceOn
                    ? 'bg-emerald-400 border-emerald-400'
                    : 'bg-slate-800 border-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                    autoRebalanceOn
                      ? 'translate-x-5.5 bg-slate-950'
                      : 'translate-x-1 bg-slate-400'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-2.5 rounded-lg bg-[#101624] border border-slate-800/80">
              <div className="text-[11px] text-slate-400">仓位占比最大偏离</div>
              <div className="mt-1 flex items-center justify-between text-xs font-mono font-bold text-white tabular-nums">
                <span>{rebalancePlan.maxAbsDriftPct.toFixed(1)}%</span>
                <span className="text-[11px] font-normal text-slate-400">
                  偏离阈值 ±{rebalancePlan.driftThresholdPct}%
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#101624] border border-slate-800/80">
              <div className="text-[11px] text-slate-400">池子深度最大回撤</div>
              <div className="mt-1 flex items-center justify-between text-xs font-mono font-bold text-white tabular-nums">
                <span>
                  {rebalancePlan.maxDepthDropPct > 0
                    ? `-${rebalancePlan.maxDepthDropPct.toFixed(1)}%`
                    : '0.0%'}
                </span>
                <span className="text-[11px] font-normal text-slate-400">
                  熔断线 -{rebalancePlan.depthDropThresholdPct}%
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#101624] border border-slate-800/80">
              <div className="text-[11px] text-slate-400">自动执行机制</div>
              <div className="mt-1 text-xs font-semibold text-emerald-300">
                {autoRebalanceOn ? '偏离超限 / 池深骤降自动调拨' : '已暂停（仅展示监测数据）'}
              </div>
            </div>
          </div>

          {rebalancePlan.allocations.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#101624]">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-[#0c111d]">
                    <th className="py-2 px-3 font-medium">并行仓位池</th>
                    <th className="py-2 px-3 font-medium text-right">当前金额 / 占比</th>
                    <th className="py-2 px-3 font-medium text-right">最优目标占比</th>
                    <th className="py-2 px-3 font-medium text-right">偏离度</th>
                    <th className="py-2 px-3 font-medium text-right">池子深度变化</th>
                    <th className="py-2 px-3 font-medium text-right">重平衡状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {rebalancePlan.allocations.map((alloc) => (
                    <tr key={alloc.poolId} className="hover:bg-slate-900/40">
                      <td className="py-2 px-3 font-semibold text-white">{alloc.poolName}</td>
                      <td className="py-2 px-3 text-right font-mono text-slate-200 tabular-nums">
                        ${alloc.currentUsd.toFixed(2)} ({alloc.currentSharePct}%)
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-sky-300 tabular-nums">
                        {alloc.targetSharePct}%
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums ${
                          Math.abs(alloc.driftPct) >= rebalancePlan.driftThresholdPct
                            ? 'text-amber-300 font-semibold'
                            : 'text-slate-300'
                        }`}
                      >
                        {alloc.driftPct > 0 ? `+${alloc.driftPct}%` : `${alloc.driftPct}%`}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums ${
                          alloc.tvlChangePct <= -rebalancePlan.depthDropThresholdPct
                            ? 'text-rose-400 font-semibold'
                            : 'text-emerald-400'
                        }`}
                      >
                        {alloc.tvlChangePct > 0
                          ? `+${alloc.tvlChangePct}%`
                          : `${alloc.tvlChangePct}%`}
                      </td>
                      <td className="py-2 px-3 text-right text-[11px] text-slate-300">
                        {alloc.actionNote}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 一键安全回撤 & 自动枯竭/无常损失转存 USDC 守护面板 */}
        <div
          aria-label="一键安全回撤"
          className="p-4 rounded-xl bg-[#090d16] border border-rose-500/25 space-y-3"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="space-y-0.5 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white">
                <ShieldCheck className="w-4 h-4 text-rose-400" />
                <span>一键安全回撤（持续枯竭 / IL 超限自动转 USDC）</span>
                <span
                  className={`px-2 py-0.5 text-[11px] rounded border ${
                    !autoWithdrawSafetyOn
                      ? 'bg-slate-800 text-slate-400 border-slate-700'
                      : safeWithdrawPlan.shouldAutoWithdraw
                      ? 'bg-rose-500/15 text-rose-300 border-rose-500/35'
                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                  }`}
                >
                  {!autoWithdrawSafetyOn
                    ? '自动守护已暂停'
                    : safeWithdrawPlan.triggerType === 'LIQUIDITY_DEPLETION'
                    ? '触发：持续流动性枯竭'
                    : safeWithdrawPlan.triggerType === 'IL_THRESHOLD_EXCEEDED'
                    ? '触发：无常损失超阈值'
                    : `安全守护运行中 · IL 熔断 ${safeWithdrawPlan.maxILTolerancePct}%`}
                </span>
              </div>
              <div className="text-xs font-medium text-rose-300">{safeWithdrawPlan.headline}</div>
              <p className="text-[11px] text-slate-400 leading-relaxed">{safeWithdrawPlan.reason}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] text-slate-400">
                  {autoWithdrawSafetyOn ? '自动回撤：已开启' : '自动回撤：已暂停'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoWithdrawSafetyOn}
                  aria-label="自动安全回撤"
                  disabled={togglingAutomation}
                  onClick={() => handleToggleAutomationOption('autoWithdrawSafety', !autoWithdrawSafetyOn)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer disabled:opacity-60 ${
                    autoWithdrawSafetyOn
                      ? 'bg-emerald-400 border-emerald-400'
                      : 'bg-slate-800 border-slate-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                      autoWithdrawSafetyOn
                        ? 'translate-x-5.5 bg-slate-950'
                        : 'translate-x-1 bg-slate-400'
                    }`}
                  />
                </button>
              </div>

              <button
                type="button"
                disabled={withdrawingSafe}
                onClick={() => handleOneClickSafeWithdraw()}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-rose-500/15 text-rose-200 border border-rose-500/45 hover:bg-rose-500/25 disabled:opacity-60 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                {withdrawingSafe ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5" />
                )}
                <span>{withdrawingSafe ? '正在撤池转 USDC...' : '一键安全回撤（撤池转 USDC）'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-2.5 rounded-lg bg-[#101624] border border-slate-800/80">
              <div className="text-[11px] text-slate-400">当前最高估算无常损失</div>
              <div className="mt-1 flex items-center justify-between text-xs font-mono font-bold text-white tabular-nums">
                <span>{safeWithdrawPlan.maxObservedIlPct.toFixed(2)}%</span>
                <span className="text-[11px] font-normal text-slate-400">
                  安全阈值 ≤ {safeWithdrawPlan.maxILTolerancePct}%
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#101624] border border-slate-800/80">
              <div className="text-[11px] text-slate-400">持续流动性枯竭计数</div>
              <div className="mt-1 flex items-center justify-between text-xs font-mono font-bold text-white tabular-nums">
                <span>
                  {safeWithdrawPlan.maxDepletionTicks} / {safeWithdrawPlan.persistentTicksRequired} 轮
                </span>
                <span className="text-[11px] font-normal text-slate-400">
                  深度回撤 ≥{safeWithdrawPlan.depletionTvlDropPct}% 触发
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#101624] border border-slate-800/80">
              <div className="text-[11px] text-slate-400">安全回撤归集资产</div>
              <div className="mt-1 text-xs font-semibold text-emerald-300">
                100% 撤池并兑换为 USDC 存入钱包（保留 0.028 SOL）
              </div>
            </div>
          </div>

          {safeWithdrawPlan.positionsAtRisk.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#101624]">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-[#0c111d]">
                    <th className="py-2 px-3 font-medium">监控仓位</th>
                    <th className="py-2 px-3 font-medium text-right">当前金额</th>
                    <th className="py-2 px-3 font-medium text-right">估算 IL</th>
                    <th className="py-2 px-3 font-medium text-right">池深回撤</th>
                    <th className="py-2 px-3 font-medium text-right">枯竭连击</th>
                    <th className="py-2 px-3 font-medium text-right">操作 / 状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {safeWithdrawPlan.positionsAtRisk.map((risk) => (
                    <tr key={risk.nftMint || risk.poolId} className="hover:bg-slate-900/40">
                      <td className="py-2 px-3 font-semibold text-white">{risk.poolName}</td>
                      <td className="py-2 px-3 text-right font-mono text-slate-200 tabular-nums">
                        ${risk.currentUsd.toFixed(2)}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums ${
                          risk.estimatedIlPct >= safeWithdrawPlan.maxILTolerancePct
                            ? 'text-rose-400 font-semibold'
                            : 'text-emerald-400'
                        }`}
                      >
                        {risk.estimatedIlPct.toFixed(2)}%
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums ${
                          risk.tvlDropPct >= safeWithdrawPlan.depletionTvlDropPct
                            ? 'text-rose-400 font-semibold'
                            : 'text-slate-300'
                        }`}
                      >
                        {risk.tvlDropPct > 0 ? `-${risk.tvlDropPct}%` : '0.0%'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-300 tabular-nums">
                        {risk.depletionTicks}/{safeWithdrawPlan.persistentTicksRequired}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <span
                            className={`text-[11px] ${
                              risk.shouldWithdraw ? 'text-rose-300 font-semibold' : 'text-slate-400'
                            }`}
                          >
                            {risk.breachType === 'LIQUIDITY_DEPLETION'
                              ? '持续枯竭风险'
                              : risk.breachType === 'IL_THRESHOLD_EXCEEDED'
                              ? 'IL 超限预警'
                              : '运行安全'}
                          </span>
                          {risk.nftMint && (
                            <button
                              type="button"
                              disabled={withdrawingSafe}
                              onClick={() => handleOneClickSafeWithdraw(risk.nftMint)}
                              className="px-2 py-0.5 text-[11px] font-medium rounded bg-rose-500/15 text-rose-300 border border-rose-500/35 hover:bg-rose-500/25 disabled:opacity-50 cursor-pointer"
                            >
                              单仓转 USDC
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 自动复利模式面板 */}
        <div
          aria-label="自动复利模式"
          className="p-4 rounded-xl bg-[#090d16] border border-emerald-500/25 space-y-3"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="space-y-0.5 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white">
                <Repeat className="w-4 h-4 text-emerald-400" />
                <span>自动复利模式 (Auto-Compound)</span>
                <span
                  className={`px-2 py-0.5 text-[11px] rounded border ${
                    !autoCompoundOn
                      ? 'bg-slate-800 text-slate-400 border-slate-700'
                      : autoCompoundPlan.shouldCompound
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/45'
                      : 'bg-sky-500/15 text-sky-300 border-sky-500/35'
                  }`}
                >
                  {!autoCompoundOn
                    ? '自动复利已暂停'
                    : autoCompoundPlan.shouldCompound
                    ? '收益已达标 · 自动复投中'
                    : `滚雪球监控中 · 起投 $${autoCompoundPlan.harvestMinUsd.toFixed(2)}`}
                </span>
              </div>
              <div className="text-xs font-medium text-emerald-300">{autoCompoundPlan.headline}</div>
              <p className="text-[11px] text-slate-400 leading-relaxed">{autoCompoundPlan.reason}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] text-slate-400">
                  {autoCompoundOn ? '自动复投：已开启' : '自动复投：已暂停'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoCompoundOn}
                  aria-label="自动复利模式"
                  disabled={togglingAutomation}
                  onClick={() => handleToggleAutomationOption('autoCompound', !autoCompoundOn)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer disabled:opacity-60 ${
                    autoCompoundOn
                      ? 'bg-emerald-400 border-emerald-400'
                      : 'bg-slate-800 border-slate-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                      autoCompoundOn
                        ? 'translate-x-5.5 bg-slate-950'
                        : 'translate-x-1 bg-slate-400'
                    }`}
                  />
                </button>
              </div>

              <button
                type="button"
                disabled={compoundingNow || !autoCompoundOn}
                onClick={handleRunAutoCompound}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25 disabled:opacity-50 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${compoundingNow ? 'animate-spin' : ''}`} />
                <span>{compoundingNow ? '正在复利复投...' : '立即复利巡检'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-2.5 rounded-lg bg-[#101624] border border-slate-800/80">
              <div className="text-[11px] text-slate-400">当前待收取耕作收益 (Yields)</div>
              <div className="mt-1 flex items-center justify-between text-xs font-mono font-bold text-emerald-400 tabular-nums">
                <span>${autoCompoundPlan.totalPendingYieldUsd.toFixed(3)}</span>
                <span className="text-[11px] font-normal text-slate-400">
                  起投门槛 ${autoCompoundPlan.harvestMinUsd.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#101624] border border-slate-800/80">
              <div className="text-[11px] text-slate-400">复利滚雪球 APY 额外增益</div>
              <div className="mt-1 flex items-center justify-between text-xs font-mono font-bold text-sky-300 tabular-nums">
                <span>+{autoCompoundPlan.estimatedApyBoostPct.toFixed(1)}% APY</span>
                <span className="text-[11px] font-normal text-slate-400">周复利模型测算</span>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#101624] border border-slate-800/80">
              <div className="text-[11px] text-slate-400">全自动复投执行权限</div>
              <div className="mt-1 text-xs font-semibold text-emerald-300">
                {autoCompoundOn ? '达标自动领取并原池增厚流动性' : '已暂停（收益暂留池内）'}
              </div>
            </div>
          </div>
        </div>

        {/* 多币种对冲 (Delta-Neutral Solana 原生借贷空头对冲) 面板 */}
        <div
          aria-label="多币种对冲"
          className="p-4 rounded-xl bg-[#090d16] border border-sky-500/30 space-y-3"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="space-y-0.5 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white">
                <Shield className="w-4 h-4 text-sky-400" />
                <span>多币种对冲 (Delta-Neutral 借贷空头)</span>
                <span
                  className={`px-2 py-0.5 text-[11px] rounded border ${
                    !multiCurrencyHedgeOn
                      ? 'bg-slate-800 text-slate-400 border-slate-700'
                      : multiHedgePlan.status === 'HEDGED_NEUTRAL'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/45'
                      : multiHedgePlan.status === 'HEDGE_READY'
                      ? 'bg-sky-500/20 text-sky-300 border-sky-500/45'
                      : multiHedgePlan.status === 'INSUFFICIENT_COLLATERAL'
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                      : 'bg-sky-500/15 text-sky-300 border-sky-500/35'
                  }`}
                >
                  {!multiCurrencyHedgeOn
                    ? '空头对冲已暂停'
                    : multiHedgePlan.status === 'HEDGED_NEUTRAL'
                    ? `中性运行中 · 消除 ${multiHedgePlan.ilEliminatedPct}% IL`
                    : multiHedgePlan.status === 'HEDGE_READY'
                    ? '对冲就绪 · 可建空头头寸'
                    : multiHedgePlan.status === 'INSUFFICIENT_COLLATERAL'
                    ? '待补充 USDC 抵押保证金'
                    : `Solend / Kamino 就绪 (${multiHedgePlan.supportedReservesCount} 储备)`}
                </span>
              </div>
              <div className="text-xs font-medium text-sky-300">{multiHedgePlan.headline}</div>
              <p className="text-[11px] text-slate-400 leading-relaxed">{multiHedgePlan.reason}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] text-slate-400">
                  {multiCurrencyHedgeOn ? '借贷空头对冲：已开启' : '借贷空头对冲：已暂停'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={multiCurrencyHedgeOn}
                  aria-label="多币种对冲"
                  disabled={togglingAutomation}
                  onClick={() =>
                    handleToggleAutomationOption('multiCurrencyHedge', !multiCurrencyHedgeOn)
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer disabled:opacity-60 ${
                    multiCurrencyHedgeOn
                      ? 'bg-sky-400 border-sky-400'
                      : 'bg-slate-800 border-slate-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                      multiCurrencyHedgeOn
                        ? 'translate-x-5.5 bg-slate-950'
                        : 'translate-x-1 bg-slate-400'
                    }`}
                  />
                </button>
              </div>

              <button
                type="button"
                disabled={hedgingNow || !multiCurrencyHedgeOn}
                onClick={handleRunMultiCurrencyHedge}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/40 hover:bg-sky-500/25 disabled:opacity-50 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${hedgingNow ? 'animate-spin' : ''}`} />
                <span>{hedgingNow ? '正在对冲校准...' : '立即对冲巡检'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="p-2.5 rounded-lg bg-[#101624] border border-slate-800/80">
              <div className="text-[11px] text-slate-400">波动敞口 / 链上空头负债</div>
              <div className="mt-1 flex items-center justify-between text-xs font-mono font-bold text-white tabular-nums">
                <span>${multiHedgePlan.totalVolatileExposureUsd.toFixed(2)}</span>
                <span className="text-sky-300">
                  空头 ${multiHedgePlan.activeShortDebtUsd.toFixed(2)}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                目标空头 ${multiHedgePlan.totalShortTargetUsd.toFixed(2)}
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#101624] border border-slate-800/80">
              <div className="text-[11px] text-slate-400">净 Delta 敞口与 IL 消除</div>
              <div className="mt-1 flex items-center justify-between text-xs font-mono font-bold tabular-nums">
                <span
                  className={
                    multiHedgePlan.netDeltaPct <= 15 ? 'text-emerald-400' : 'text-amber-300'
                  }
                >
                  Delta {multiHedgePlan.netDeltaPct}%
                </span>
                <span className="text-emerald-300">
                  消除 IL {multiHedgePlan.ilEliminatedPct}%
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">目标 0% 价格中性做市</div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#101624] border border-slate-800/80">
              <div className="text-[11px] text-slate-400">USDC 保证金 (安全 LTV ≤{multiHedgePlan.appliedTargetLtvPct}%)</div>
              <div className="mt-1 flex items-center justify-between text-xs font-mono font-bold text-white tabular-nums">
                <span>可用 ${multiHedgePlan.availableUsdcCollateralUsd.toFixed(2)}</span>
                <span className="text-slate-300">
                  需 ${multiHedgePlan.requiredUsdcCollateralUsd.toFixed(2)}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                已抵押 ${multiHedgePlan.activeCollateralUsd.toFixed(2)} · 健康因子 {multiHedgePlan.healthFactor}
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#101624] border border-slate-800/80">
              <div className="text-[11px] text-slate-400">对冲实时盈亏 (Hedge PnL)</div>
              <div className="mt-1 flex items-center justify-between text-xs font-mono font-bold tabular-nums">
                <span
                  className={
                    multiHedgePlan.hedgePnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }
                >
                  {multiHedgePlan.hedgePnlUsd >= 0 ? '+' : ''}${multiHedgePlan.hedgePnlUsd.toFixed(2)}
                </span>
                <span className="text-sky-300">
                  综合净利 ${multiHedgePlan.netCombinedPnlUsd.toFixed(2)}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {multiHedgePlan.hedgePnlStatusLabel}
              </div>
            </div>
          </div>

          {/* 大额资金阈值保护开关与规则说明 */}
          <div className="p-3 rounded-lg bg-[#101624] border border-slate-800/90 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="space-y-0.5 flex-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <Shield className="w-3.5 h-3.5 text-amber-400" />
                <span>大额资金阈值保护开关</span>
                <span
                  className={`px-2 py-0.5 text-[10px] rounded border ${
                    multiHedgePlan.isLargeCapitalTriggered
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {multiHedgePlan.isLargeCapitalTriggered
                    ? `大额触发 · 杠杆已自动降至 LTV ${multiHedgePlan.appliedTargetLtvPct}%`
                    : `阈值 $${multiHedgePlan.largeCapitalThresholdUsd} · 标准杠杆`}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                当总资金超过 ${multiHedgePlan.largeCapitalThresholdUsd} 时，系统自动调低对冲策略杠杆倍数（安全 LTV 从 52% 降至 30%），防止极端波动期间的强平穿仓风险。
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <span className="text-[11px] text-slate-400">
                {largeCapitalProtOn ? '大额保护：已开启' : '大额保护：已关闭'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={largeCapitalProtOn}
                aria-label="大额资金阈值保护"
                disabled={togglingAutomation}
                onClick={() =>
                  handleToggleAutomationOption('largeCapitalProtection', !largeCapitalProtOn)
                }
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer disabled:opacity-60 ${
                  largeCapitalProtOn
                    ? 'bg-amber-400 border-amber-400'
                    : 'bg-slate-800 border-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                    largeCapitalProtOn
                      ? 'translate-x-5.5 bg-slate-950'
                      : 'translate-x-1 bg-slate-400'
                  }`}
                />
              </button>
            </div>
          </div>

          {multiHedgePlan.legs.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#101624]">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-[#0c111d]">
                    <th className="py-2 px-3 font-medium">敞口币种</th>
                    <th className="py-2 px-3 font-medium text-right">LP 多头敞口</th>
                    <th className="py-2 px-3 font-medium">借贷空头通道</th>
                    <th className="py-2 px-3 font-medium text-right">目标空头 / 保证金</th>
                    <th className="py-2 px-3 font-medium text-right">借币成本</th>
                    <th className="py-2 px-3 font-medium text-right">IL 消除率</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {multiHedgePlan.legs.map((leg) => (
                    <tr key={`${leg.symbol}-${leg.borrowReserveAddress}`} className="hover:bg-slate-900/40">
                      <td className="py-2 px-3 font-semibold text-white">
                        {leg.symbol}{' '}
                        <span className="text-[11px] font-mono text-slate-400">
                          ({leg.lpExposureAmount})
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-200 tabular-nums">
                        ${leg.lpExposureUsd.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-sky-300">{leg.statusLabel}</td>
                      <td className="py-2 px-3 text-right font-mono text-slate-300 tabular-nums">
                        ${leg.targetShortUsd.toFixed(2)} / ${leg.requiredCollateralUsdc.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-amber-300 tabular-nums">
                        {leg.borrowApyPct.toFixed(2)}%
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-400 tabular-nums">
                        {leg.ilEliminationPct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {multiHedgePlan.topBorrowReserves.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px] text-slate-400">
              <span className="text-slate-300 font-medium">Solana 主网实时借贷费率:</span>
              {multiHedgePlan.topBorrowReserves.map((rev) => (
                <span
                  key={`${rev.protocol}-${rev.symbol}`}
                  className="px-2 py-0.5 rounded bg-[#101624] border border-slate-800 font-mono text-slate-300 tabular-nums"
                >
                  {rev.symbol} 借 {rev.borrowApyPct}% · LTV {rev.maxLtvPct}% ({rev.protocol === 'Solend (Save)' ? 'Solend' : 'Kamino'})
                </span>
              ))}
            </div>
          )}
        </div>

        {switchFeedback && (
          <div
            role="status"
            className={`px-4 py-3 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2 ${
              switchFeedback.ok
                ? 'bg-emerald-950/35 border-emerald-500/40 text-emerald-200'
                : 'bg-amber-950/35 border-amber-500/40 text-amber-200'
            }`}
          >
            <span>{switchFeedback.message}</span>
            {switchFeedback.txId && (
              <a
                href={`https://solscan.io/tx/${switchFeedback.txId}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono underline text-emerald-300 hover:text-emerald-200"
              >
                Solscan: {switchFeedback.txId.slice(0, 8)}...
              </a>
            )}
          </div>
        )}

        {/* APR vs Volatility Comparison Table */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>全网实时扫描池 APR 与波动率 / 无常损失风险对比</span>
            <span className="font-mono text-[11px] text-slate-500">
              自主规则：有闲置资金(≥$5)直接新开 · 无闲置资金需 APR+20% 且风险评分×1.12 才自动换仓
            </span>
          </div>

          {recommendation.comparisons.length === 0 ? (
            <div className="p-4 rounded-lg bg-[#090d16] border border-slate-800 text-xs text-slate-400">
              正在同步 Raydium 主网池子扫描数据，稍后自动显示 APR 与波动率对比矩阵...
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#090d16]">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-[#0c111d]">
                    <th className="py-2.5 px-3 font-medium">Raydium CLMM 池子</th>
                    <th className="py-2.5 px-3 font-medium text-right">实时 APR</th>
                    <th className="py-2.5 px-3 font-medium text-right">估算波动率</th>
                    <th className="py-2.5 px-3 font-medium text-right">IL 风险</th>
                    <th className="py-2.5 px-3 font-medium text-right">性价比评分</th>
                    <th className="py-2.5 px-3 font-medium text-right">TVL 深度</th>
                    <th className="py-2.5 px-3 font-medium text-right">自主决策状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {recommendation.comparisons.map((c) => {
                    const isRecommended = recommendation.targetPool?.poolId === c.poolId;
                    const tvlLabel =
                      c.tvlUsd >= 1_000_000
                        ? `$${(c.tvlUsd / 1_000_000).toFixed(2)}M`
                        : `$${Math.round(c.tvlUsd / 1000)}K`;
                    return (
                      <tr
                        key={c.poolId}
                        className={isRecommended ? 'bg-emerald-950/20' : 'hover:bg-slate-900/40'}
                      >
                        <td className="py-2.5 px-3 font-semibold text-white">{c.poolName}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400 tabular-nums">
                          +{c.apr.toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-300 tabular-nums">
                          {c.volatilityPctEstimate}% ({c.volatilityLabel})
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <span
                            className={
                              c.ilRisk === '低'
                                ? 'text-emerald-400'
                                : c.ilRisk === '中'
                                ? 'text-amber-400'
                                : 'text-rose-400'
                            }
                          >
                            {c.ilRisk}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-sky-300 tabular-nums">
                          {c.riskAdjustedScore}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-400 tabular-nums">
                          {tvlLabel}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {c.isCurrentlyHeld ? (
                            <span className="px-2 py-0.5 text-[11px] rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                              当前持仓
                            </span>
                          ) : isRecommended && recommendation.shouldAct ? (
                            <span className="px-2 py-0.5 text-[11px] rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
                              推荐切入
                            </span>
                          ) : isRecommended ? (
                            <span className="px-2 py-0.5 text-[11px] rounded bg-amber-500/15 text-amber-300 border border-amber-500/35">
                              最优候选
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-500">备选观察</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Active Position PnL & Liquidity Range Offset Chart Panel (Recharts) */}
      <section
        aria-label="活跃仓位收益走势图"
        className="p-6 rounded-xl bg-[#101624] border border-slate-800/90 space-y-5"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-white">
                <Activity className="w-4 h-4 text-emerald-400" />
                活跃仓位实时收益走势与区间偏移监控
              </span>
              <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-slate-800 text-slate-300 border border-slate-700">
                {activePositions.length > 0
                  ? `在池仓位 ${activePositions.length} 个 · 实盘实时采样`
                  : '实盘同步：当前 0 活跃仓位（建仓后自动记录 PNL 与偏移曲线）'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              双轴追踪每个活跃仓位的累计利润 (PNL $) 与当前池价相对于做市区间中心的偏移比例（0% 为正中心，±100% 为区间上下边界，超出需干预或自动重平衡）。
            </p>
          </div>
          <div className="text-xs font-mono text-slate-400 shrink-0 tabular-nums">
            {(() => {
              const sumPnl = activePositions.reduce((s, p) => s + p.unrealizedPnlUsd, 0);
              const fmtPnl = Math.abs(sumPnl) > 0 && Math.abs(sumPnl) < 0.1 ? sumPnl.toFixed(3) : sumPnl.toFixed(2);
              return (
                <>
                  累计浮盈: <span className="text-emerald-400 font-bold">${fmtPnl}</span>
                </>
              );
            })()}
          </div>
        </div>

        <div className="h-64 w-full rounded-xl bg-[#090d16] border border-slate-800 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartSeriesData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="pnlAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#34d399" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#34d399" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 11 }} />
              <YAxis
                yAxisId="left"
                domain={pnlYAxisDomain}
                stroke="#34d399"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => {
                  const num = Number(v);
                  if (Math.abs(num) > 0 && Math.abs(num) < 1) return `$${num.toFixed(3)}`;
                  return Math.abs(num) < 10 ? `$${num.toFixed(2)}` : `$${num.toFixed(0)}`;
                }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={[-120, 120]}
                stroke="#38bdf8"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  borderColor: '#334155',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#f8fafc',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '6px' }} />
              <ReferenceLine
                yAxisId="right"
                y={100}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                label={{ value: '上限 +100%', fill: '#f59e0b', fontSize: 10, position: 'insideTopRight' }}
              />
              <ReferenceLine
                yAxisId="right"
                y={-100}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                label={{ value: '下限 -100%', fill: '#f59e0b', fontSize: 10, position: 'insideBottomRight' }}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="pnlUsd"
                name="累计利润 PNL ($)"
                stroke="#34d399"
                strokeWidth={2}
                fill="url(#pnlAreaGradient)"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="rangeOffsetPct"
                name="区间偏移比例 (%)"
                stroke="#38bdf8"
                strokeWidth={2}
                dot={{ r: 3, fill: '#38bdf8' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {positionDeviations.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {positionDeviations.map((dev) => {
              const clampedPos = Math.max(0, Math.min(100, (dev.rangeOffsetPct + 100) / 2));
              return (
                <div
                  key={dev.nftMint || dev.poolId}
                  className="p-3.5 rounded-lg bg-[#090d16] border border-slate-800 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-white">{dev.poolName}</span>
                    <span
                      className={`font-mono font-bold tabular-nums ${
                        dev.cumulativePnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      PNL: {dev.cumulativePnlUsd >= 0 ? '+' : ''}${dev.cumulativePnlUsd.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 tabular-nums">
                    <span>区间: ${dev.rangeLowerUsd.toFixed(2)} ~ ${dev.rangeUpperUsd.toFixed(2)}</span>
                    <span
                      className={
                        dev.needsIntervention ? 'text-amber-300 font-semibold' : 'text-sky-300'
                      }
                    >
                      偏移 {dev.rangeOffsetPct > 0 ? `+${dev.rangeOffsetPct}%` : `${dev.rangeOffsetPct}%`}
                    </span>
                  </div>
                  <div className="relative h-2 rounded-full bg-slate-800 overflow-visible">
                    <div
                      className="absolute top-0 bottom-0 left-1/2 w-px bg-slate-600"
                      title="区间中心 0%"
                    />
                    <div
                      className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border border-white ${
                        dev.needsIntervention ? 'bg-amber-400' : 'bg-emerald-400'
                      }`}
                      style={{ left: `${clampedPos}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-400">{dev.interventionHint}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Capital + 3-Tier Strategy Selector */}
      <section className="p-6 rounded-xl bg-[#101624] border border-slate-800/90 space-y-6">
        {/* Capital Row */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <Wallet className="w-4 h-4 text-emerald-400" />
            <span>一、计划投入总资产 (USDT/USDC 等值)</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {CAPITAL_PRESETS.map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => {
                  setCapitalInput(amt);
                  handleApply(amt, selectedProfile);
                }}
                className={`px-3.5 py-2 text-xs font-mono font-semibold rounded-lg border transition-colors cursor-pointer ${
                  capitalInput === amt
                    ? 'bg-emerald-400 text-slate-950 border-emerald-400'
                    : 'bg-[#090d16] text-slate-300 border-slate-700 hover:border-slate-500'
                }`}
              >
                {amt} U
              </button>
            ))}
            <div className="flex items-center gap-2">
              <label htmlFor="capital-custom-input" className="sr-only">
                自定义投入总资产
              </label>
              <input
                id="capital-custom-input"
                type="number"
                min={50}
                max={100000}
                value={capitalInput}
                onChange={(e) => setCapitalInput(Number(e.target.value))}
                className="w-24 bg-[#090d16] border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                disabled={saving}
                onClick={() => handleApply(capitalInput, selectedProfile)}
                className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {saving ? '计算中...' : '应用金额'}
              </button>
            </div>
          </div>
        </div>

        {/* 3 Risk-Reward Tiers */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <SlidersHorizontal className="w-4 h-4 text-emerald-400" />
            <span>二、选择收益与胜率档位（系统自动计算真实调仓损耗）</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setSelectedProfile('ultra-safe');
                handleApply(capitalInput, 'ultra-safe');
              }}
              className={`p-4 rounded-xl border text-left transition-colors cursor-pointer space-y-2 ${
                selectedProfile === 'ultra-safe'
                  ? 'bg-emerald-950/30 border-emerald-500/70'
                  : 'bg-[#090d16] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white">极稳保守型</span>
                <span className="text-[11px] font-mono text-slate-400">胜率 65~75%</span>
              </div>
              <div className="text-xs text-slate-400 leading-relaxed">
                100% 进 ≥$3M 蓝筹池 · ±20% 超宽区间几乎不换仓 · -5% 止损。适合极少操心、容忍极低回撤。
              </div>
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setSelectedProfile('balanced-steady');
                handleApply(capitalInput, 'balanced-steady');
              }}
              className={`p-4 rounded-xl border text-left transition-colors cursor-pointer space-y-2 ${
                selectedProfile === 'balanced-steady'
                  ? 'bg-emerald-950/30 border-emerald-500/70'
                  : 'bg-[#090d16] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-sky-400">稳健平衡型</span>
                <span className="text-[11px] font-mono text-slate-400">胜率 55~65%</span>
              </div>
              <div className="text-xs text-slate-400 leading-relaxed">
                100% 进 ≥$2M 蓝筹池 · ±10% 集中区间（费率密度 ×1.65）+ 自动复利 · -6% 止损。
              </div>
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setSelectedProfile('active-yield');
                handleApply(capitalInput, 'active-yield');
              }}
              className={`p-4 rounded-xl border text-left transition-colors cursor-pointer space-y-2 ${
                selectedProfile === 'active-yield'
                  ? 'bg-emerald-950/30 border-emerald-500/70'
                  : 'bg-[#090d16] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-emerald-400">进取增效型</span>
                <span className="text-[11px] font-mono text-amber-400">胜率 45~55%</span>
              </div>
              <div className="text-xs text-slate-400 leading-relaxed">
                70% ±6% 蓝筹（×2.45密度）+ 30% 高换手热池卫星仓（TVL≥$500K）+ 自动复利 · -8% 止损。
              </div>
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setSelectedProfile('turbo-high-yield');
                handleApply(capitalInput, 'turbo-high-yield');
              }}
              className={`p-4 rounded-xl border text-left transition-colors cursor-pointer space-y-2 ${
                selectedProfile === 'turbo-high-yield'
                  ? 'bg-amber-950/30 border-amber-400/80'
                  : 'bg-[#090d16] border-slate-800 hover:border-amber-500/50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-amber-300">极速高收益突击型</span>
                <span className="text-[11px] font-mono text-rose-400">爆发收益 · 双仓</span>
              </div>
              <div className="text-xs text-slate-400 leading-relaxed">
                45% ±4% 超窄核心 + 55% 全网第一高APR热池（TVL≥$300K, 最高420% APR）· $0.5极速复利 · 费率密度 ×3.45。
              </div>
            </button>
          </div>
        </div>
      </section>

      {/* Metrics Breakdown */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl bg-[#101624] border border-slate-800/90">
          <div className="text-xs text-slate-400">仓位分配（总 {strategyConfig.capitalUsdt}U）</div>
          <div className="text-xl font-bold font-mono text-emerald-400 mt-2 tabular-nums">
            {satelliteUsd > 0 ? `${coreUsd}U + ${satelliteUsd}U` : `${coreUsd} U 做市`}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {satelliteUsd > 0
              ? `${strategyConfig.coreSplitPct}%核心池 + ${100 - strategyConfig.coreSplitPct}%最高APR卫星池 + ${strategyConfig.gasReserveUsdt}U Gas`
              : `另留 ${strategyConfig.gasReserveUsdt}U 作为 SOL 燃料储备`}
          </div>
        </div>

        <div className="p-5 rounded-xl bg-[#101624] border border-slate-800/90">
          <div className="text-xs text-slate-400 flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <span>集中区间净收益预估</span>
          </div>
          <div className="text-base xl:text-lg font-bold font-mono text-emerald-400 mt-2 tabular-nums leading-snug">
            +${yieldEst.realisticMinUsd}~${yieldEst.realisticMaxUsd} / 月
          </div>
          <div className="text-xs text-slate-500 font-mono mt-1 tabular-nums">
            均值 +${yieldEst.monthlyNetUsd}/月 ({yieldEst.monthlyNetPct}%) · 已扣调仓Gas ${yieldEst.monthlyGasAndSlippageUsd}
          </div>
        </div>

        <div className="p-5 rounded-xl bg-[#101624] border border-slate-800/90">
          <div className="text-xs text-slate-400">真实月度正收益概率</div>
          <div className="text-xl font-bold font-mono text-amber-400 mt-2 tabular-nums">
            {yieldEst.estimatedWinProbRange}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            震荡或缓涨市胜率高；单边暴跌仍会触发止损
          </div>
        </div>

        <div className="p-5 rounded-xl bg-[#101624] border border-slate-800/90">
          <div className="text-xs text-slate-400">最大单次熔断止损线</div>
          <div className="text-xl font-bold font-mono text-rose-400 mt-2 tabular-nums">
            -{strategyConfig.stopLossPercentage}% (-${maxDrawdownUsd})
          </div>
          <div className="text-xs text-slate-500 mt-1">
            区间 ±{strategyConfig.rangeWidthPct}% · 集中倍率 ×{yieldEst.concentrationMultiplier}
          </div>
        </div>
      </section>

      {/* Honest Realism & Optimization Breakdown */}
      <section className="p-6 rounded-xl bg-[#101624] border border-slate-800/90 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>真实收益概率与优化原理（不画大饼、实事求是说明）</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs leading-relaxed">
          <div className="p-4 rounded-lg bg-[#090d16] border border-slate-800 space-y-1.5">
            <div className="font-semibold text-white">1. 为什么 21U/月 其实不算低？靠谱吗？</div>
            <p className="text-slate-400">
              200U 本金月赚 21U 等于<span className="text-emerald-400 font-semibold">月化 10.5%（年化超 126%）</span>。只要行情在 ±10%~15% 内震荡，SOL/USDC 池每天确实能产出约 $0.6~$0.9 手续费，震荡市实现概率约 <span className="text-slate-200">55%~65%</span>。但如果遇到 SOL 一周暴跌 20%+，无常损失会抵消手续费并触发 -6% 止损（亏损约 $12），没有任何链上策略能 100% 稳赚不赔。
            </p>
          </div>

          <div className="p-4 rounded-lg bg-[#090d16] border border-slate-800 space-y-1.5">
            <div className="font-semibold text-emerald-400">2. 如何把月收益进一步提升到 $38~$65+？</div>
            <p className="text-slate-400">
              切换到上方的<span className="text-emerald-400 font-semibold">「进取增效型」</span>即可开启两大优化：① 将 CLMM 区间收窄到 <span className="text-slate-200 font-mono">±6%</span>，把原本分散的 185U 资金集中到现价附近吃单，单位资金手续费密度直接提升约 <span className="text-slate-200">2.45 倍</span>；② 拆出 30% 资金（约 55U）轮动交易活跃的卫星热池（TVL ≥ $50万，高换手但仍拒绝土狗），并开启自动复利。
            </p>
          </div>

          <div className="p-4 rounded-lg bg-[#090d16] border border-slate-800 space-y-1.5">
            <div className="font-semibold text-amber-400">3. 选池到底是不是真的链上实时选？</div>
            <p className="text-slate-400">
              <span className="text-emerald-400 font-semibold">100% 真实调用主网接口。</span>每次刷新都会直连 Raydium 官方主网接口（api-v3.raydium.io），获取真实合约地址、TVL 深度、24h 成交量与年化 APR 并按当前风控档位自动排序。「自动选池矩阵」里每条池子旁都已附带真实合约地址，可随时点击跳转 Solscan 核对。
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400 pt-1">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>
            注意：前台仅负责策略方案与主网风险监测展示，所有真实链上签名与资金划转严格在服务器后台安全执行。
          </span>
        </div>
      </section>
    </div>
  );
};
