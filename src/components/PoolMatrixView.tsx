import React, { useState } from 'react';
import { RefreshCw, Cpu, X, ExternalLink } from 'lucide-react';
import { ScoredPool, calculateImpermanentLossPct } from '../utils/strategyEngine';

interface PoolMatrixProps {
  pools: ScoredPool[];
  dataSource: string;
  lastScanTime: string;
  loadingPools: boolean;
  capitalUsdt: number;
  minTVL: number;
  rangeWidthPct: number;
  onRefreshPools: () => Promise<void>;
}

export const PoolMatrixView: React.FC<PoolMatrixProps> = ({
  pools,
  dataSource,
  lastScanTime,
  loadingPools,
  capitalUsdt,
  minTVL,
  rangeWidthPct,
  onRefreshPools,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [riskFilter, setRiskFilter] = useState<'all' | '低' | '中' | '高'>('all');
  const [simPriceChangePct, setSimPriceChangePct] = useState(rangeWidthPct || 15);

  const [selectedPool, setSelectedPool] = useState<ScoredPool | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);
  const [aiError, setAiError] = useState('');

  const filteredPools = pools.filter((p) => {
    const matchSearch =
      !searchTerm.trim() ||
      p.name.toLowerCase().includes(searchTerm.trim().toLowerCase()) ||
      p.dex.toLowerCase().includes(searchTerm.trim().toLowerCase()) ||
      p.address.toLowerCase().includes(searchTerm.trim().toLowerCase());
    const matchRisk = riskFilter === 'all' || p.ilRisk === riskFilter;
    return matchSearch && matchRisk;
  });

  const simulatedIlUp = calculateImpermanentLossPct(1 + simPriceChangePct / 100);
  const simulatedIlDown = calculateImpermanentLossPct(Math.max(0.05, 1 - simPriceChangePct / 100));

  const handleAnalyze = async (pool: ScoredPool) => {
    setSelectedPool(pool);
    setAnalyzing(true);
    setAiResult(null);
    setAiError('');
    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poolName: pool.name,
          dex: pool.dex,
          apr: pool.apr,
          tvl: pool.tvl,
          volume24h: pool.volume24h,
          alphaScore: pool.alphaScore,
          ilRisk: pool.ilRisk,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAiResult(data.analysis);
      } else {
        setAiError(data.error || 'AI 审计返回异常');
      }
    } catch (err: any) {
      setAiError(err.message || '请求失败');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">{capitalUsdt}U 真实主网自动选池矩阵</h1>
          <p className="text-xs text-slate-400 mt-1">
            数据源：{dataSource} {lastScanTime ? `· 最近实查 ${lastScanTime}` : ''} · 自动淘汰深度低于 ${(minTVL / 1_000_000).toFixed(1)}M 或高危土狗池，点击池子地址可在 Solscan 核验真实链上数据。
          </p>
        </div>

        <button
          type="button"
          onClick={onRefreshPools}
          disabled={loadingPools}
          className="px-3.5 py-2 bg-[#101624] border border-slate-700/80 text-xs font-medium text-slate-200 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer self-start"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingPools ? 'animate-spin' : ''}`} />
          刷新实时主网矿池
        </button>
      </div>

      {/* Filter & IL Stress Simulator */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 p-4 rounded-xl bg-[#101624] border border-slate-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex-1">
            <label htmlFor="pool-search-input" className="sr-only">搜索代币或 DEX</label>
            <input
              id="pool-search-input"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索交易对或合约地址（如 SOL / USDC）"
              className="w-full bg-[#090d16] border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#090d16] rounded-lg border border-slate-800">
            {(['all', '低', '中', '高'] as const).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setRiskFilter(level)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  riskFilter === level
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {level === 'all' ? '全部风险' : `${level}风险`}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#101624] border border-slate-800/90 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="il-slider" className="text-slate-300 font-medium">
              无常损失压测（币价波动 ±{simPriceChangePct}%）
            </label>
            <span className="font-mono text-amber-400 tabular-nums">
              跌: {simulatedIlDown}% / 涨: {simulatedIlUp}%
            </span>
          </div>
          <input
            id="il-slider"
            type="range"
            min={5}
            max={80}
            step={5}
            value={simPriceChangePct}
            onChange={(e) => setSimPriceChangePct(Number(e.target.value))}
            className="w-full accent-emerald-400 cursor-pointer"
          />
        </div>
      </div>

      {/* Real Pools Table */}
      <div className="bg-[#101624] border border-slate-800/90 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800/80 text-xs text-slate-400 bg-[#090d16]/60">
                <th className="py-3.5 px-6 font-medium">矿池 / 真实合约与筛选依据</th>
                <th className="py-3.5 px-4 font-medium text-right">TVL 深度</th>
                <th className="py-3.5 px-4 font-medium text-right">24h 成交量</th>
                <th className="py-3.5 px-4 font-medium text-right">换手率</th>
                <th className="py-3.5 px-4 font-medium text-right">24h 原始 APR</th>
                <th className="py-3.5 px-4 font-medium text-right">量化评分</th>
                <th className="py-3.5 px-4 font-medium">无常风险</th>
                <th className="py-3.5 px-6 font-medium text-right">AI 审计</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {filteredPools.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    {loadingPools
                      ? '正在拉取 Solana 主网实时池子数据...'
                      : '当前筛选条件下暂无符合要求的池子，请放宽条件或刷新数据。'}
                  </td>
                </tr>
              ) : (
                filteredPools.map((pool) => (
                  <tr
                    key={pool.id}
                    className={`hover:bg-slate-800/30 transition-colors ${
                      pool.autoSelected && pool.eligibleFor200U ? 'bg-emerald-950/20' : ''
                    }`}
                  >
                    <td className="py-3.5 px-6">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm text-white">{pool.name}</span>
                        {pool.autoSelected && pool.eligibleFor200U && (
                          <span className="text-xs font-medium text-emerald-400">
                            · 优选第一名
                          </span>
                        )}
                        {!pool.autoSelected && pool.eligibleFor200U && (
                          <span className="text-xs font-medium text-sky-400">
                            · {pool.poolRole === 'core' ? '核心备选池' : '卫星增效池'}
                          </span>
                        )}
                        {!pool.eligibleFor200U && (
                          <span className="text-xs text-slate-500">
                            · 不符合当前风控标准
                          </span>
                        )}
                      </div>
                      <div className="text-slate-400 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-mono">{pool.dex} · {pool.feeTier}</span>
                        <a
                          href={`https://solscan.io/account/${pool.address}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-slate-500 hover:text-emerald-400 transition-colors"
                          title={`在 Solscan 核验真实合约 ${pool.address}`}
                        >
                          <span>{pool.address.slice(0, 6)}...{pool.address.slice(-4)}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        {pool.selectionReason && (
                          <span className="text-slate-500">({pool.selectionReason})</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-200 tabular-nums">
                      ${pool.tvl >= 1_000_000 ? `${(pool.tvl / 1_000_000).toFixed(2)}M` : `${Math.round(pool.tvl / 1000)}K`}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-200 tabular-nums">
                      ${pool.volume24h >= 1_000_000 ? `${(pool.volume24h / 1_000_000).toFixed(2)}M` : `${Math.round(pool.volume24h / 1000)}K`}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-300 tabular-nums">
                      {pool.volTvlRatio}x
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-semibold text-emerald-400 tabular-nums">
                      +{pool.apr}%
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-white tabular-nums">
                      {pool.alphaScore}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={
                          pool.ilRisk === '低'
                            ? 'text-emerald-400'
                            : pool.ilRisk === '中'
                            ? 'text-amber-400'
                            : 'text-rose-400'
                        }
                      >
                        {pool.ilRisk}风险 · 安全分 {pool.safetyScore}
                      </span>
                    </td>
                    <td className="py-3.5 px-6 text-right">
                      <button
                        type="button"
                        onClick={() => handleAnalyze(pool)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                      >
                        <Cpu className="w-3.5 h-3.5" />
                        AI 策略审计
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* AI Audit Modal */}
      {selectedPool && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`AI 策略审计 ${selectedPool.name}`}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-[#101624] border border-slate-800 rounded-xl max-w-xl w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                AI 策略与风控审计：{selectedPool.name}
              </h3>
              <button
                type="button"
                aria-label="关闭审计弹窗"
                onClick={() => setSelectedPool(null)}
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {analyzing ? (
              <div className="py-10 flex flex-col items-center gap-3 text-xs text-slate-300">
                <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
                <span>正在结合实时 TVL、换手率与无常损失模型生成审计建议...</span>
              </div>
            ) : aiError ? (
              <div className="p-4 rounded-lg bg-rose-950/30 border border-rose-800/60 text-xs text-rose-300">
                {aiError}
              </div>
            ) : aiResult ? (
              <div className="space-y-3 text-xs leading-relaxed">
                <div className="p-3.5 rounded-lg bg-[#090d16] border border-slate-800 space-y-1">
                  <div className="font-semibold text-emerald-400">收益可持续性评估</div>
                  <p className="text-slate-300">{aiResult.evaluation}</p>
                </div>
                <div className="p-3.5 rounded-lg bg-[#090d16] border border-slate-800 space-y-1">
                  <div className="font-semibold text-amber-400">区间与无常损失对策</div>
                  <p className="text-slate-300">{aiResult.ilStrategy}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 font-mono">
                  <div className="p-3 rounded-lg bg-[#090d16] border border-slate-800">
                    <div className="text-slate-400">建议止损线</div>
                    <div className="text-base font-bold text-rose-400 mt-0.5">
                      -{aiResult.suggestedStopLoss}%
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-[#090d16] border border-slate-800">
                    <div className="text-slate-400">建议单次落袋止盈</div>
                    <div className="text-base font-bold text-emerald-400 mt-0.5">
                      ${aiResult.suggestedTakeProfit}
                    </div>
                  </div>
                </div>
                <div className="p-3.5 rounded-lg bg-emerald-950/30 border border-emerald-800/50 text-emerald-200">
                  <span className="font-semibold">执行建议：</span>
                  {aiResult.recommendation}
                </div>
              </div>
            ) : null}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedPool(null)}
                className="px-4 py-2 text-xs font-medium text-slate-200 bg-slate-800 rounded-lg hover:bg-slate-700 cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
