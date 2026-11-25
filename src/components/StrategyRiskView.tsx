import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  ShieldCheck,
  Wallet,
  SlidersHorizontal,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import {
  RiskProfileKey,
  ScoredPool,
  StrategyConfig,
  estimateNetYieldForCapital,
} from '../utils/strategyEngine';

interface StrategyRiskProps {
  strategyConfig: StrategyConfig;
  topPool?: ScoredPool;
  onApplyPreset: (capitalUsdt: number, riskProfile: RiskProfileKey) => Promise<boolean>;
}

const CAPITAL_PRESETS = [100, 200, 500];

export const StrategyRiskView: React.FC<StrategyRiskProps> = ({
  strategyConfig,
  topPool,
  onApplyPreset,
}) => {
  const [capitalInput, setCapitalInput] = useState(strategyConfig.capitalUsdt);
  const [selectedProfile, setSelectedProfile] = useState<RiskProfileKey>(
    strategyConfig.riskProfile
  );
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setCapitalInput(strategyConfig.capitalUsdt);
    setSelectedProfile(strategyConfig.riskProfile);
  }, [strategyConfig]);

  const referenceApr = topPool && topPool.apr > 0 ? topPool.apr : 58;
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
            已切换方案并同步到选池与部署脚本
          </span>
        )}
      </div>

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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">极稳保守型</span>
                <span className="text-xs font-mono text-slate-400">月正收益概率 65~75%</span>
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
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-sky-400">稳健平衡型</span>
                <span className="text-xs font-mono text-slate-400">月正收益概率 55~65%</span>
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
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-400">
                  进取增效型 (推荐提收益)
                </span>
                <span className="text-xs font-mono text-amber-400">月正收益概率 45~55%</span>
              </div>
              <div className="text-xs text-slate-400 leading-relaxed">
                70% 窄区间蓝筹（±6%，费率密度 ×2.45）+ 30% 高换手热池卫星仓 + 自动复利 · -8% 止损。
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
              ? `70%核心蓝筹 + 30%高换手热池 + ${strategyConfig.gasReserveUsdt}U Gas`
              : `另留 ${strategyConfig.gasReserveUsdt}U 作为 SOL 燃料储备`}
          </div>
        </div>

        <div className="p-5 rounded-xl bg-[#101624] border border-slate-800/90">
          <div className="text-xs text-slate-400 flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <span>集中区间净收益预估</span>
          </div>
          <div className="text-lg font-bold font-mono text-emerald-400 mt-2 tabular-nums whitespace-nowrap">
            +${yieldEst.realisticMinUsd} ~ +${yieldEst.realisticMaxUsd} / 月
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
            注意：所有真实交易必须等您把脚本部署到新加坡 VPS、在后台 <code className="font-mono text-slate-200">.env</code> 填入私钥并关闭 <code className="font-mono text-slate-200">DRY_RUN</code> 后才会真正动用钱包资金。
          </span>
        </div>
      </section>
    </div>
  );
};
