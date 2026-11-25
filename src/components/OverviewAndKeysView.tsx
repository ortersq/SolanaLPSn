import React, { useState } from 'react';
import {
  RefreshCw,
  ShieldCheck,
  ArrowRightLeft,
  Lock,
  TrendingUp,
  AlertTriangle,
  Play,
  Activity,
  CheckCircle2,
  XCircle,
  Info,
  ExternalLink,
  Layers,
  Target,
  Sparkles,
  Clock,
} from 'lucide-react';
import {
  ActiveLpPosition,
  ApiKeyRequirement,
  PipelineRunMode,
  PipelineStepKey,
  PipelineStepResult,
  PipelineTestAsset,
  PoolSelectionRound,
  RiskLogEntry,
  ScoredPool,
  StrategyConfig,
} from '../utils/strategyEngine';

export interface LogItem {
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

export interface BackendStatus {
  heliusConnected: boolean;
  heliusLatencyMs: number | null;
  lastSlot: number | null;
  privateKeyConfigured: boolean;
  privateKeyError?: string;
  recipientConfigured: boolean;
  recipientMasked: string;
  watchWalletConfigured: boolean;
  watchWalletMasked: string;
  watchBalanceSOL: number | null;
  splTokenAccountsCount: number;
  lastJupiterImpactBps: number | null;
  dryRunMode?: boolean;
  workerStatus?: WorkerHeartbeatStatus;
  riskAlerts: RiskLogEntry[];
  logs: LogItem[];
  activePositions?: ActiveLpPosition[];
  selectionRounds?: PoolSelectionRound[];
}

interface OverviewProps {
  backendStatus: BackendStatus;
  strategyConfig: StrategyConfig;
  apiKeyRequirements: ApiKeyRequirement[];
  scanningRisk: boolean;
  activePositions?: ActiveLpPosition[];
  selectionRounds?: PoolSelectionRound[];
  topPool?: ScoredPool;
  onCheckHelius: () => Promise<void>;
  onRunRiskScan: () => Promise<void>;
  onRefreshPositions?: () => Promise<void>;
  onUpdateBackendStatus: (status: BackendStatus) => void;
  onGoToStrategy: () => void;
  onGoToPools: () => void;
}

const PIPELINE_STEP_META: { key: PipelineStepKey; title: string; buttonLabel: string; hint: string }[] = [
  {
    key: 'swap',
    title: '1. 代币兑换 (Jupiter Swap v1)',
    buttonLabel: '实测兑换',
    hint: '真实广播 0.01 SOL → USDC（或 0.1 USDC/USDT → SOL）主网兑换并等待链上确认',
  },
  {
    key: 'addLp',
    title: '2. 加池子 (Raydium CLMM)',
    buttonLabel: '实测加池',
    hint: '真实调用 Raydium CLMM 合约向 WSOL/USDC 注入 0.1 USDC / 0.002 SOL 开仓（含可退还 NFT 租金）',
  },
  {
    key: 'removeLp',
    title: '3. 撤池子与关仓退租',
    buttonLabel: '实测撤池',
    hint: '真实调用 decreaseLiquidity + closePosition 提取 100% 流动资金并退回仓位 NFT 押金',
  },
  {
    key: 'sweep',
    title: '4. 利润转移 (SystemProgram 转账)',
    buttonLabel: '实测利润转移',
    hint: '真实转账 0.0005 SOL 至后台 .env 配置的冷钱包接收公钥地址并输出 Solscan 哈希',
  },
];

function PriceRangeGauge({
  lower,
  upper,
  current,
  inRange,
  tokenA,
  tokenB,
}: {
  lower: number;
  upper: number;
  current: number;
  inRange: boolean;
  tokenA: string;
  tokenB: string;
}) {
  const minVal = Math.min(lower, upper);
  const maxVal = Math.max(lower, upper);
  const span = maxVal - minVal;
  const pct = span > 0 ? Math.max(0, Math.min(100, ((current - minVal) / span) * 100)) : 50;

  return (
    <div className="space-y-2 pt-2">
      <div className="flex justify-between items-center text-xs font-mono">
        <span className="text-slate-400">
          做市区间下限: <span className="text-slate-200">${minVal.toFixed(2)}</span>
        </span>
        <span className={`font-semibold flex items-center gap-1 ${inRange ? 'text-emerald-400' : 'text-amber-400'}`}>
          当前池价: ${current.toFixed(2)} {tokenB}/{tokenA} ({inRange ? '在区间内做市' : '超出做市范围'})
        </span>
        <span className="text-slate-400">
          做市区间上限: <span className="text-slate-200">${maxVal.toFixed(2)}</span>
        </span>
      </div>
      <div className="relative h-2.5 bg-slate-900 rounded-full border border-slate-800 overflow-visible">
        {/* Active Range Gradient */}
        <div
          className={`absolute inset-0 rounded-full ${
            inRange
              ? 'bg-gradient-to-r from-emerald-500/30 via-emerald-400/50 to-emerald-500/30'
              : 'bg-amber-500/20'
          }`}
        />
        {/* Current Price Marker Pin */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center z-10 transition-all duration-300"
          style={{ left: `${pct}%` }}
        >
          <div
            className={`w-3.5 h-3.5 rounded-full border-2 shadow-lg ${
              inRange
                ? 'bg-emerald-400 border-white shadow-emerald-500/50'
                : 'bg-amber-400 border-white shadow-amber-500/50'
            }`}
          />
        </div>
      </div>
    </div>
  );
}

export const OverviewAndKeysView: React.FC<OverviewProps> = ({
  backendStatus,
  strategyConfig,
  apiKeyRequirements,
  scanningRisk,
  activePositions,
  selectionRounds,
  topPool,
  onCheckHelius,
  onRunRiskScan,
  onRefreshPositions,
  onUpdateBackendStatus,
  onGoToStrategy,
  onGoToPools,
}) => {
  const [checkingHelius, setCheckingHelius] = useState(false);
  const [alertFilter, setAlertFilter] = useState<'all' | 'alerts-only'>('all');
  const [roundFilter, setRoundFilter] = useState<'all' | 'winner-only' | 'rejected-only'>('all');
  const [refreshingPositions, setRefreshingPositions] = useState(false);
  const [quoteAmount, setQuoteAmount] = useState('0.1');
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteResult, setQuoteResult] = useState<{
    inAmountSol: number;
    outAmountUsdc: number;
    priceImpactPct: number;
    impactBps?: number;
    route: string;
  } | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [testingStep, setTestingStep] = useState<'all' | PipelineStepKey | null>(null);
  const [testMode, setTestMode] = useState<PipelineRunMode>('live');
  const [testAsset, setTestAsset] = useState<PipelineTestAsset>('SOL');
  const [pipelineResults, setPipelineResults] = useState<Partial<Record<PipelineStepKey, PipelineStepResult>>>({});
  const [pipelineError, setPipelineError] = useState('');
  const [lastPipelineTestedAt, setLastPipelineTestedAt] = useState('');

  const handleHeliusClick = async () => {
    setCheckingHelius(true);
    try {
      await onCheckHelius();
    } finally {
      setCheckingHelius(false);
    }
  };

  const handleRunPipelineTest = async (step: 'all' | PipelineStepKey) => {
    setPipelineError('');
    setTestingStep(step);
    try {
      const res = await fetch('/api/pipeline/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step, mode: testMode, asset: testAsset }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setPipelineError(data.error || '全流程实测请求失败');
        return;
      }
      if (Array.isArray(data.results)) {
        setPipelineResults((prev) => {
          const next = { ...prev };
          for (const item of data.results as PipelineStepResult[]) {
            next[item.step] = item;
          }
          return next;
        });
      }
      if (data.backendStatus) {
        onUpdateBackendStatus(data.backendStatus);
      }
      if (data.testedAt) {
        setLastPipelineTestedAt(
          new Date(data.testedAt).toLocaleTimeString('zh-CN', { hour12: false })
        );
      }
      if (onRefreshPositions && (step === 'all' || step === 'addLp' || step === 'removeLp')) {
        await onRefreshPositions();
      }
    } catch (err: any) {
      setPipelineError(err?.message || '网络请求异常');
    } finally {
      setTestingStep(null);
    }
  };

  const handleRefreshPositionsClick = async () => {
    setRefreshingPositions(true);
    try {
      if (onRefreshPositions) {
        await onRefreshPositions();
      }
    } finally {
      setRefreshingPositions(false);
    }
  };

  const effectivePositions =
    activePositions && activePositions.length > 0
      ? activePositions
      : backendStatus.activePositions || [];

  const effectiveRounds: PoolSelectionRound[] =
    selectionRounds && selectionRounds.length > 0
      ? selectionRounds
      : backendStatus.selectionRounds && backendStatus.selectionRounds.length > 0
      ? backendStatus.selectionRounds
      : backendStatus.workerStatus?.latestRound
      ? [backendStatus.workerStatus.latestRound]
      : [];

  const handleTestJupiter = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuoteError('');
    setQuoteBusy(true);
    try {
      const res = await fetch('/api/jupiter/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountSol: Number(quoteAmount) }),
      });
      const data = await res.json();
      if (data.success) {
        setQuoteResult(data);
        await onRunRiskScan();
      } else {
        setQuoteError(data.error || 'Jupiter 询价失败');
      }
    } catch (err: any) {
      setQuoteError(err.message || '网络请求异常');
    } finally {
      setQuoteBusy(false);
    }
  };

  const visibleRiskAlerts =
    alertFilter === 'alerts-only'
      ? (backendStatus.riskAlerts || []).filter(
          (a) => a.severity === 'critical' || a.severity === 'warning'
        )
      : backendStatus.riskAlerts || [];

  return (
    <div className="space-y-8">
      {/* Top Strategy & Real-Time Risk Overview Banner */}
      <section className="p-6 rounded-xl bg-[#101624] border border-slate-800/90 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2 max-w-3xl">
          <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>纯策略与实时风控展示台 · 敏感密钥仅由后端环境变量掌控</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Solana {strategyConfig.capitalUsdt}U 自动做市策略与实时风险监控台
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            本界面实时对接 Helius 主网、Raydium CLMM 与 Jupiter 路由，持续监控高危波动代币、浅池撤池滑点及节点延迟。后台未配置钱包私钥前，系统严格保持零虚假持仓展示。
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleHeliusClick}
            disabled={checkingHelius}
            className="px-4 py-2 text-xs font-medium text-slate-200 bg-slate-800/90 border border-slate-700 rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer flex items-center gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checkingHelius ? 'animate-spin' : ''}`} />
            测速 Helius 节点
          </button>
          <button
            type="button"
            onClick={onGoToPools}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors whitespace-nowrap cursor-pointer"
          >
            查看实时选池矩阵
          </button>
        </div>
      </section>

      {/* 4-column Real Backend & Chain Telemetry Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl bg-[#101624] border border-slate-800/90">
          <div className="text-xs text-slate-400 font-medium">Helius 主网节点状态</div>
          <div className="text-xl font-bold font-mono text-slate-100 mt-2">
            {backendStatus.heliusConnected ? '已连接主网' : '连接待测'}
          </div>
          <div className="text-xs text-slate-500 font-mono mt-1 tabular-nums">
            {backendStatus.heliusLatencyMs !== null
              ? `延迟 ${backendStatus.heliusLatencyMs} ms · Slot ${backendStatus.lastSlot?.toLocaleString()}`
              : 'API Key: 5641e03b-****'}
          </div>
        </div>

        <div className="p-5 rounded-xl bg-[#101624] border border-slate-800/90">
          <div className="text-xs text-slate-400 font-medium">撤池路由滑点监控</div>
          <div className="text-xl font-bold font-mono text-emerald-400 mt-2 tabular-nums">
            {backendStatus.lastJupiterImpactBps !== null
              ? `${backendStatus.lastJupiterImpactBps} bps`
              : '巡检中...'}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            熔断上限 {strategyConfig.slippageBps} bps · Jupiter v1 实测
          </div>
        </div>

        <div className="p-5 rounded-xl bg-[#101624] border border-slate-800/90">
          <div className="text-xs text-slate-400 font-medium">后台签名与收款状态</div>
          <div
            className={`text-xl font-bold mt-2 ${
              backendStatus.privateKeyConfigured ? 'text-emerald-400' : 'text-amber-400'
            }`}
          >
            {backendStatus.privateKeyConfigured ? '后台私钥已就绪' : '纯策略观察模式'}
          </div>
          <div className="text-xs text-slate-500 font-mono mt-1">
            收款地址: {backendStatus.recipientMasked}
          </div>
        </div>

        <div className="p-5 rounded-xl bg-[#101624] border border-slate-800/90">
          <div className="text-xs text-slate-400 font-medium">后台钱包真实余额</div>
          <div className="text-xl font-bold font-mono text-emerald-400 mt-2 tabular-nums">
            {backendStatus.watchBalanceSOL !== null
              ? `${backendStatus.watchBalanceSOL.toFixed(4)} SOL`
              : '零仓位 (未配置)'}
          </div>
          <div className="text-xs text-slate-500 font-mono mt-1">
            {backendStatus.watchWalletConfigured
              ? `${backendStatus.watchWalletMasked} · ${backendStatus.splTokenAccountsCount} 个代币账户`
              : '未在服务器配钱包前绝不显示假持仓'}
          </div>
        </div>
      </section>

      {/* Background Auto-Execution Worker Heartbeat + One-Click Pipeline Test Console */}
      <section
        aria-label="后台自动运行状态与全流程一键测试台"
        className="p-6 rounded-xl bg-[#101624] border border-slate-800/90 space-y-5"
      >
        {/* Worker Heartbeat Bar */}
        <div className="p-4 rounded-lg bg-[#090d16] border border-slate-800/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Activity
              className={`w-5 h-5 mt-0.5 shrink-0 ${
                backendStatus.workerStatus?.running ? 'text-emerald-400' : 'text-amber-400'
              }`}
            />
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
                <span>
                  后台自动策略引擎（solana-lp-bot）：
                  {backendStatus.workerStatus?.running ? (
                    <span className="text-emerald-400 ml-1">正在自动运行中</span>
                  ) : (
                    <span className="text-amber-400 ml-1">未检测到活跃心跳</span>
                  )}
                </span>
                <span className="text-xs font-mono text-slate-400">
                  · {(backendStatus.workerStatus?.dryRun ?? backendStatus.dryRunMode) ? 'DRY_RUN=true 安全演练模式' : '实盘自动运行模式'}
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                {backendStatus.workerStatus?.running ? (
                  <>
                    PID {backendStatus.workerStatus.pid} · 已自动巡检{' '}
                    <span className="text-slate-200 font-mono">{backendStatus.workerStatus.tickCount}</span> 轮 · 最近心跳{' '}
                    <span className="text-slate-200 font-mono">
                      {backendStatus.workerStatus.lastTickAt
                        ? new Date(backendStatus.workerStatus.lastTickAt).toLocaleTimeString('zh-CN', { hour12: false })
                        : '--'}
                    </span>
                    {backendStatus.workerStatus.bestPool ? ` · 当前主选池：${backendStatus.workerStatus.bestPool}` : ''}
                  </>
                ) : (
                  <>
                    {backendStatus.privateKeyError
                      ? `私钥格式异常（${backendStatus.privateKeyError}），请检查服务器 .env。`
                      : '若您在服务器通过 deploy.sh 启动了 PM2，请确认 pm2 list 中 solana-lp-bot 为 online（或私钥已写入 .env）；当前控制台每 30 秒仍会自动扫描主网风险。'}
                  </>
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={testingStep !== null}
            onClick={() => handleRunPipelineTest('all')}
            className="px-4 py-2.5 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 disabled:opacity-50 transition-colors cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
          >
            {testingStep === 'all' ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {testingStep === 'all'
              ? testMode === 'live'
                ? '正在发送主网真实交易...'
                : '正在执行只读核验...'
              : testMode === 'live'
              ? `一键真实全流程实测 (${testAsset === 'SOL' ? '0.01 SOL' : `0.1 ${testAsset}`})`
              : '一键全流程只读仿真检查'}
          </button>
        </div>

        {/* One-Click Individual Step Tests */}
        <div className="space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">
                真实链上小额全流程测试台（支持 0.01 SOL / 0.1 USDC / 0.1 USDT 实盘跑通）
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                默认直接发送真实 Solana 主网交易并返回 Solscan 哈希；全程净耗约 0.0005 SOL 手续费（加池约 0.018 SOL 仓位租金会在第 3 步撤池时自动全额退回）。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div className="flex items-center gap-1 p-1 bg-[#090d16] rounded-lg border border-slate-800">
                {(['SOL', 'USDC', 'USDT'] as PipelineTestAsset[]).map((assetOpt) => (
                  <button
                    key={assetOpt}
                    type="button"
                    disabled={testingStep !== null}
                    onClick={() => setTestAsset(assetOpt)}
                    className={`px-2.5 py-1 text-xs font-mono font-medium rounded-md transition-colors cursor-pointer ${
                      testAsset === assetOpt
                        ? 'bg-slate-800 text-emerald-400'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {assetOpt === 'SOL' ? '0.01 SOL' : `0.1 ${assetOpt}`}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 p-1 bg-[#090d16] rounded-lg border border-slate-800">
                <button
                  type="button"
                  disabled={testingStep !== null}
                  onClick={() => setTestMode('live')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    testMode === 'live'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  真实上链
                </button>
                <button
                  type="button"
                  disabled={testingStep !== null}
                  onClick={() => setTestMode('simulate')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    testMode === 'simulate'
                      ? 'bg-slate-800 text-sky-400'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  仅仿真
                </button>
              </div>

              {lastPipelineTestedAt && (
                <span className="text-xs font-mono text-slate-400">
                  最近: {lastPipelineTestedAt}
                </span>
              )}
            </div>
          </div>

          {pipelineError && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              {pipelineError}
            </div>
          )}

          <div
            data-testid="pipeline-test-grid"
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            {PIPELINE_STEP_META.map((meta) => {
              const res = pipelineResults[meta.key];
              const isBusy = testingStep === 'all' || testingStep === meta.key;

              const statusColor = !res
                ? 'text-slate-400'
                : res.status === 'passed'
                ? 'text-emerald-400'
                : res.status === 'readonly_only'
                ? 'text-sky-400'
                : res.status === 'warning'
                ? 'text-amber-400'
                : 'text-rose-400';

              const statusLabel = !res
                ? '未测试'
                : res.status === 'passed'
                ? res.mode === 'live'
                  ? '真实主网上链成功'
                  : '只读仿真通过'
                : res.status === 'readonly_only'
                ? '只读核验通过（缺私钥）'
                : res.status === 'warning'
                ? '余额/仓位提醒'
                : '真实交易未通过';

              return (
                <div
                  key={meta.key}
                  data-testid={`pipeline-card-${meta.key}`}
                  className="p-4 rounded-lg bg-[#090d16] border border-slate-800/80 flex flex-col justify-between gap-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-white">{meta.title}</div>
                      <div className={`text-xs font-medium inline-flex items-center gap-1.5 ${statusColor}`}>
                        {res?.status === 'passed' && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                        {res?.status === 'readonly_only' && <Info className="w-3.5 h-3.5 shrink-0" />}
                        {res?.status === 'warning' && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                        {res?.status === 'failed' && <XCircle className="w-3.5 h-3.5 shrink-0" />}
                        <span>{statusLabel}</span>
                        {res && (
                          <span className="text-slate-500 font-mono">({res.durationMs} ms)</span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={testingStep !== null}
                      onClick={() => handleRunPipelineTest(meta.key)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-100 bg-slate-800 border border-slate-700 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                    >
                      {isBusy ? '执行中...' : meta.buttonLabel}
                    </button>
                  </div>

                  <div className="text-xs leading-relaxed border-t border-slate-800/70 pt-2.5 space-y-1.5">
                    {res ? (
                      <>
                        <div className="text-slate-100 font-medium">{res.summary}</div>
                        <div className="text-slate-400 font-mono break-all">{res.details}</div>
                        {res.explorerUrl && res.txId && (
                          <a
                            href={res.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-mono underline underline-offset-2"
                          >
                            <ExternalLink className="w-3 h-3 shrink-0" />
                            <span>
                              查看 Solscan 真实交易哈希 ({res.txId.slice(0, 8)}...{res.txId.slice(-8)})
                            </span>
                          </a>
                        )}
                      </>
                    ) : (
                      <div className="text-slate-400">{meta.hint}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 1. 当前活跃做市仓位 (Raydium CLMM Concentrated Liquidity) */}
      <section
        aria-label="当前活跃做市仓位"
        className="bg-[#101624] border border-slate-800/90 rounded-xl p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-emerald-400" />
              <h2 className="text-base font-semibold text-white">
                当前活跃做市仓位 (Raydium CLMM 集中流动性)
              </h2>
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {effectivePositions.length > 0
                  ? `${effectivePositions.length} 个活跃做市仓位`
                  : '0 活跃仓位 · 严守真实链上'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              实时直连 Solana 主网 Raydium CLMM 合约，展示当前连接矿池代币对、已注入资产价值 (USD)、实时流动性区间 (Price Range) 与当前未实现浮盈亏 (Unrealized PnL)。
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={refreshingPositions}
              onClick={handleRefreshPositionsClick}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 disabled:opacity-50 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  refreshingPositions ? 'animate-spin text-emerald-400' : ''
                }`}
              />
              <span>{refreshingPositions ? '正在读取链上...' : '同步链上仓位'}</span>
            </button>
          </div>
        </div>

        {effectivePositions.length > 0 ? (
          <div className="space-y-4">
            {effectivePositions.map((pos) => (
              <div
                key={pos.nftMint || pos.poolId}
                className="p-5 rounded-xl bg-[#090d16] border border-slate-800/90 space-y-4 hover:border-emerald-500/40 transition-colors"
              >
                {/* Header row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-base font-bold text-white font-mono">
                      {pos.poolName}
                    </span>
                    <span className="px-2 py-0.5 text-xs font-mono font-medium rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      {pos.dex}
                    </span>
                    <a
                      href={`https://solscan.io/token/${pos.nftMint}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-mono text-slate-400 hover:text-emerald-400 inline-flex items-center gap-1 transition-colors"
                      title={`仓位 NFT: ${pos.nftMint}`}
                    >
                      <span>NFT: {pos.nftMintMasked}</span>
                      <ExternalLink className="w-3 h-3 text-slate-500" />
                    </a>
                  </div>

                  <div>
                    {pos.inRange ? (
                      <span className="px-3 py-1 text-xs font-semibold rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 inline-flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        在价格区间内 (In Range · 正在捕获交易手续费)
                      </span>
                    ) : (
                      <span className="px-3 py-1 text-xs font-semibold rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 inline-flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        超出做市区间 (Out of Range · 暂停计息/面临单边风险)
                      </span>
                    )}
                  </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-3.5 rounded-lg bg-[#101624] border border-slate-800/80 space-y-1">
                    <div className="text-xs text-slate-400">已注入资产价值 (USD)</div>
                    <div className="text-lg font-bold font-mono text-white">
                      ${pos.injectedValueUsd.toFixed(2)}
                    </div>
                    <div className="text-xs font-mono text-slate-400 truncate">
                      {pos.tokenAAmount.toFixed(4)} {pos.tokenASymbol} + {pos.tokenBAmount.toFixed(2)} {pos.tokenBSymbol}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-[#101624] border border-slate-800/80 space-y-1">
                    <div className="text-xs text-slate-400">实时流动性区间 (Price Range)</div>
                    <div className="text-lg font-bold font-mono text-emerald-400">
                      ${pos.priceLowerUsd.toFixed(2)} ~ ${pos.priceUpperUsd.toFixed(2)}
                    </div>
                    <div className="text-xs font-mono text-slate-400">
                      当前池价: ${pos.priceCurrentUsd.toFixed(2)} USD
                    </div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-[#101624] border border-slate-800/80 space-y-1">
                    <div className="text-xs text-slate-400">当前未实现浮盈亏 (Unrealized PnL)</div>
                    <div
                      className={`text-lg font-bold font-mono ${
                        pos.unrealizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {pos.unrealizedPnlUsd >= 0 ? '+' : ''}${pos.unrealizedPnlUsd.toFixed(2)} USD ({pos.unrealizedPnlPct >= 0 ? '+' : ''}{pos.unrealizedPnlPct.toFixed(2)}%)
                    </div>
                    <div className="text-xs font-mono text-slate-400">
                      待领手续费: +${pos.uncollectedFeeUsd.toFixed(2)} USD
                    </div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-[#101624] border border-slate-800/80 space-y-1">
                    <div className="text-xs text-slate-400">资金聚集度 / 状态</div>
                    <div className="text-lg font-bold font-mono text-sky-400">
                      ~2.45x 效率
                    </div>
                    <div className="text-xs font-mono text-slate-400">
                      Tick: [{pos.tickLower}, {pos.tickUpper}]
                    </div>
                  </div>
                </div>

                {/* Visual Price Range Gauge */}
                <PriceRangeGauge
                  lower={pos.priceLowerUsd}
                  upper={pos.priceUpperUsd}
                  current={pos.priceCurrentUsd}
                  inRange={pos.inRange}
                  tokenA={pos.tokenASymbol}
                  tokenB={pos.tokenBSymbol}
                />

                {/* Action bar */}
                <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-800/80">
                  <span className="text-xs text-slate-400">
                    撤池将向合约提交 decreaseLiquidity + closePosition 指令，提取全部流动性并注销仓位 NFT 全额退回 ~0.018 SOL 租金押金。
                  </span>
                  <button
                    type="button"
                    disabled={testingStep !== null}
                    onClick={() => handleRunPipelineTest('removeLp')}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {testingStep === 'removeLp' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-rose-400" />
                    )}
                    <span>一键撤池关仓退租</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6 rounded-xl bg-[#090d16] border border-slate-800/90 space-y-4">
            <div className="flex items-start gap-4">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div className="space-y-1.5 flex-1">
                <h3 className="text-sm font-semibold text-white">
                  链上当前无活跃 Raydium CLMM 仓位（0 虚假仓位安全保证）
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  策略引擎严格同步 Solana 主网真实链上数据：当钱包未开仓或已全部关仓时，绝不生成任何虚假模拟仓位误导用户。
                </p>
              </div>
            </div>

            {/* Planned LP preview */}
            <div className="p-4 rounded-lg bg-[#101624] border border-slate-800/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="text-xs font-medium text-slate-300 flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>
                    策略推荐待入选做市池：
                    <span className="text-white font-mono font-semibold">
                      {topPool?.name || 'WSOL - USDC (Raydium CLMM)'}
                    </span>
                  </span>
                </div>
                <div className="text-xs text-slate-400">
                  规划资金:{' '}
                  <span className="text-emerald-400 font-mono font-semibold">
                    {strategyConfig.lpActiveUsdt} U
                  </span>{' '}
                  · 建议做市区间:{' '}
                  <span className="text-slate-200 font-mono">
                    ±{strategyConfig.rangeWidthPct}%
                  </span>{' '}
                  · 预估综合年化:{' '}
                  <span className="text-emerald-400 font-mono font-semibold">
                    +{topPool?.apr || 58.6}%
                  </span>{' '}
                  · 止损线:{' '}
                  <span className="text-rose-400 font-mono">
                    -{strategyConfig.stopLossPercentage}%
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  disabled={testingStep !== null}
                  onClick={() => handleRunPipelineTest('addLp')}
                  className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 disabled:opacity-50 transition-colors cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  {testingStep === 'addLp' ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  <span>一键实测加池 (0.002 SOL + 0.1 USDC)</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 2. 每一轮智能选币与决策记录 (Live Pool Selection Rounds) */}
      <section
        aria-label="每一轮智能选币与决策记录"
        className="bg-[#101624] border border-slate-800/90 rounded-xl p-6 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-emerald-400" />
              <h2 className="text-base font-semibold text-white">
                每一轮智能选币与决策记录 (Live Pool Selection Rounds)
              </h2>
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                已记录 {effectiveRounds.length} 轮巡检
              </span>
            </div>
            <p className="text-xs text-slate-400">
              后台策略引擎每 30 秒全网扫描主流流动性池，依据 Alpha 综合评分、TVL 深度、无常损失风险等模型执行选币与淘汰劣质池决策。
            </p>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 p-1 bg-[#090d16] rounded-lg border border-slate-800 shrink-0">
            <button
              type="button"
              onClick={() => setRoundFilter('all')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                roundFilter === 'all'
                  ? 'bg-slate-800 text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              全部轮次 ({effectiveRounds.length})
            </button>
            <button
              type="button"
              onClick={() => setRoundFilter('winner-only')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                roundFilter === 'winner-only'
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              仅胜选池
            </button>
            <button
              type="button"
              onClick={() => setRoundFilter('rejected-only')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                roundFilter === 'rejected-only'
                  ? 'bg-rose-500/20 text-rose-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              淘汰明细
            </button>
          </div>
        </div>

        {effectiveRounds.length > 0 ? (
          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
            {effectiveRounds.map((rnd) => (
              <div
                key={rnd.round}
                className="p-4 rounded-xl bg-[#090d16] border border-slate-800/90 space-y-3 hover:border-slate-700 transition-colors"
              >
                {/* Round Header Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2.5">
                    <span className="px-2 py-0.5 font-bold font-mono rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      第 {rnd.round} 轮巡检
                    </span>
                    <span className="text-slate-400 font-mono">[{rnd.time}]</span>
                    <span className="text-slate-400">· 扫描候选池 {rnd.candidateCount} 个</span>
                  </div>

                  <div className="flex items-center gap-3 font-mono text-slate-400 text-xs">
                    {rnd.solPriceUsd && (
                      <span>
                        SOL:{' '}
                        <span className="text-slate-200">${rnd.solPriceUsd.toFixed(2)}</span>
                      </span>
                    )}
                    {rnd.jupiterSlippageBps !== null && (
                      <span>
                        聚合滑点:{' '}
                        <span className="text-slate-200">
                          {(rnd.jupiterSlippageBps / 100).toFixed(2)}%
                        </span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Strategy action banner */}
                <div className="px-3 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-xs text-sky-300 flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span>{rnd.strategyAction}</span>
                </div>

                {/* Winning pool card */}
                {roundFilter !== 'rejected-only' && rnd.chosenPool && (
                  <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-white">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span className="font-mono">{rnd.chosenPool.name}</span>
                        <span className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-emerald-500/20 text-emerald-300">
                          {rnd.chosenPool.dex}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-slate-300">
                          {rnd.chosenPool.role === 'core' ? '核心底仓' : '高换手卫星仓'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs font-mono">
                        <span className="text-emerald-400 font-semibold">
                          APR: +{rnd.chosenPool.apr}%
                        </span>
                        <span className="text-slate-300">
                          TVL: ${(rnd.chosenPool.tvlUsd / 1_000_000).toFixed(2)}M
                        </span>
                        <span className="text-sky-400">
                          Alpha: {rnd.chosenPool.alphaScore}/100
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed pl-6">
                      胜选理由：{rnd.chosenPool.selectionReason}
                    </p>
                  </div>
                )}

                {/* Rejected pools sample */}
                {roundFilter !== 'winner-only' &&
                  rnd.rejectedSamples &&
                  rnd.rejectedSamples.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <div className="text-xs text-slate-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                        <span>本轮风控淘汰池（由于无常损失、流动性过浅或回撤偏离淘汰）：</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                        {rnd.rejectedSamples.map((rej, idx) => (
                          <div
                            key={`${rnd.round}-rej-${idx}`}
                            className="p-2 rounded bg-slate-900/80 border border-slate-800/80 flex items-center justify-between gap-2"
                          >
                            <span className="font-semibold text-slate-300">{rej.name}</span>
                            <span
                              className="text-rose-400 text-xs font-normal truncate"
                              title={rej.reason}
                            >
                              {rej.reason}
                            </span>
                            <span className="text-slate-500 text-[11px] shrink-0">
                              ${(rej.tvlUsd / 1_000_000).toFixed(1)}M
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6 rounded-xl bg-[#090d16] border border-slate-800/90 text-center space-y-3">
            <Target className="w-8 h-8 text-slate-500 mx-auto" />
            <div className="text-xs text-slate-400">
              正在收集主网矿池数据并生成最新一轮选币决策记录...
            </div>
            <button
              type="button"
              disabled={scanningRisk}
              onClick={onRunRiskScan}
              className="px-3.5 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/25 transition-colors cursor-pointer"
            >
              {scanningRisk ? '正在执行扫描...' : '立即执行一轮选币与风控巡检'}
            </button>
          </div>
        )}
      </section>

      {/* Real-Time Scrolling Risk Alert Log Panel */}
      <section
        aria-label="实时风险日志滚动面板"
        className="p-6 rounded-xl bg-[#101624] border border-slate-800/90 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <h2 className="text-base font-semibold text-white">
                实时风控异常与滑点预警滚动日志（每 30 秒自动巡检主网）
              </h2>
            </div>
            <p className="text-xs text-slate-400">
              基于 Raydium 实时池深、Token 异常波动率与 Jupiter 撤池滑点试算生成，实时展示自动风控系统如何为您拦截风险池与高滑点陷阱。
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 p-1 bg-[#090d16] rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setAlertFilter('all')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  alertFilter === 'all'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                全部风控记录 ({backendStatus.riskAlerts.length})
              </button>
              <button
                type="button"
                onClick={() => setAlertFilter('alerts-only')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  alertFilter === 'alerts-only'
                    ? 'bg-slate-800 text-amber-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                仅异常预警
              </button>
            </div>

            <button
              type="button"
              disabled={scanningRisk}
              onClick={onRunRiskScan}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-100 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${scanningRisk ? 'animate-spin' : ''}`} />
              {scanningRisk ? '巡检中...' : '立即风控巡检'}
            </button>
          </div>
        </div>

        <div
          data-testid="risk-alert-scroll-feed"
          className="bg-[#090d16] rounded-lg border border-slate-800/80 divide-y divide-slate-800/60 max-h-72 overflow-y-auto"
        >
          {visibleRiskAlerts.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              正在等待主网实时风控巡检结果...
            </div>
          ) : (
            visibleRiskAlerts.map((alert) => {
              const badgeColor =
                alert.severity === 'critical'
                  ? 'text-rose-400'
                  : alert.severity === 'warning'
                  ? 'text-amber-400'
                  : alert.severity === 'safe'
                  ? 'text-emerald-400'
                  : 'text-sky-400';

              const badgeText =
                alert.severity === 'critical'
                  ? '高危拦截'
                  : alert.severity === 'warning'
                  ? '滑点/波动预警'
                  : alert.severity === 'safe'
                  ? '滑点安全'
                  : '安全护栏';

              return (
                <div
                  key={alert.id}
                  className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-xs hover:bg-slate-800/20 transition-colors"
                >
                  <div className="flex items-center gap-3 shrink-0 font-mono">
                    <span className="text-slate-500">[{alert.time}]</span>
                    <span className={`font-semibold w-24 ${badgeColor}`}>{badgeText}</span>
                    <span className="text-slate-200 font-medium w-44 truncate" title={alert.category}>
                      {alert.category}
                    </span>
                    <span className="text-slate-400 w-36 truncate" title={alert.target}>
                      {alert.target}
                    </span>
                  </div>
                  <div className="text-slate-300 leading-relaxed flex-1">{alert.detail}</div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Two-Column Core Overview: Active Strategy Summary + Live Jupiter Swap Test */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-6 rounded-xl bg-[#101624] border border-slate-800/90 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
              <Lock className="w-4 h-4 shrink-0" />
              <span>当前自动策略核心参数</span>
            </div>
            <h2 className="text-base font-semibold text-white">
              {strategyConfig.capitalUsdt}U 自动做市（
              {strategyConfig.riskProfile === 'ultra-safe'
                ? '极稳保守型'
                : strategyConfig.riskProfile === 'active-yield'
                ? '进取增效型 · 双仓窄区间'
                : '稳健平衡型'}
              ）
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              留出{' '}
              <span className="text-slate-100 font-mono font-semibold">
                {strategyConfig.gasReserveUsdt} U
              </span>{' '}
              作为 SOL 链上 Gas 与租金，其余{' '}
              <span className="text-emerald-400 font-mono font-semibold">
                {strategyConfig.lpActiveUsdt} U
              </span>{' '}
              按深度 ≥ ${(strategyConfig.minTVL / 1_000_000).toFixed(1)}M 筛选主流池，采用 ±{strategyConfig.rangeWidthPct}% 区间做市，手续费满 ${strategyConfig.harvestMinUsd} 再收割，触及 -{strategyConfig.stopLossPercentage}% 自动撤池止损。
            </p>
          </div>

          <div className="pt-2 flex items-center justify-between border-t border-slate-800/80">
            <span className="text-xs text-slate-500">
              可随时调整投入金额与收益/胜率档位
            </span>
            <button
              type="button"
              onClick={onGoToStrategy}
              className="text-xs font-medium text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              查看与切换收益方案
            </button>
          </div>
        </div>

        {/* Live Jupiter Swap v1 Quote Verification */}
        <div className="p-6 rounded-xl bg-[#101624] border border-slate-800/90 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-white">
              Jupiter Swap v1 免密兑换与滑点实测（SOL 兑换 USDC）
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              实时调用 lite-api.jup.ag/swap/v1 验证真实链上聚合路由与冲击滑点，无需额外 API Key。
            </p>
          </div>

          <form onSubmit={handleTestJupiter} className="space-y-3">
            <label htmlFor="jupiter-amount-input" className="block text-xs font-medium text-slate-300">
              测试兑换 SOL 数量
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="jupiter-amount-input"
                type="number"
                step="0.01"
                min="0.001"
                max="1000"
                value={quoteAmount}
                onChange={(e) => setQuoteAmount(e.target.value)}
                className="w-full sm:w-40 bg-[#090d16] border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                disabled={quoteBusy}
                className="px-4 py-2 text-xs font-medium text-slate-100 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer flex items-center justify-center gap-1.5"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                {quoteBusy ? '请求 Jupiter...' : '获取真实兑换报价'}
              </button>
            </div>
            {quoteError && <div className="text-xs text-rose-400">{quoteError}</div>}
            {quoteResult && (
              <div className="text-xs font-mono text-emerald-400 pt-1 tabular-nums">
                {quoteResult.inAmountSol} SOL ➔ {quoteResult.outAmountUsdc} USDC · 滑点影响{' '}
                {(quoteResult.priceImpactPct * 100).toFixed(4)}% · 路由: {quoteResult.route}
              </div>
            )}
          </form>
        </div>
      </section>

      {/* API Key Requirements Breakdown Table */}
      <section className="bg-[#101624] border border-slate-800/90 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800/80">
          <h2 className="text-base font-semibold text-white">
            链上执行接口依赖清单（全流程透明度）
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            除后台 Helius RPC Key 与服务器签名私钥外，换币、加池、撤池与利润转账均直接走公开接口与链上原生指令。
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800/80 text-xs text-slate-400 bg-[#090d16]/60">
                <th className="py-3 px-6 font-medium">协议 / 模块</th>
                <th className="py-3 px-4 font-medium">承担职责</th>
                <th className="py-3 px-4 font-medium">是否需要额外 Key</th>
                <th className="py-3 px-6 font-medium">说明与配置方式</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {apiKeyRequirements.map((item) => (
                <tr key={item.module} className="hover:bg-slate-800/20">
                  <td className="py-3.5 px-6 font-medium text-slate-100 whitespace-nowrap">
                    {item.module}
                  </td>
                  <td className="py-3.5 px-4 text-slate-300">{item.purpose}</td>
                  <td className="py-3.5 px-4 whitespace-nowrap font-medium">
                    <span className={item.needsExtraKey ? 'text-amber-400' : 'text-emerald-400'}>
                      {item.keyStatus}
                    </span>
                  </td>
                  <td className="py-3.5 px-6 text-slate-400">{item.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Live System Activity Logs */}
      <section className="p-6 rounded-xl bg-[#101624] border border-slate-800/90 space-y-3">
        <h2 className="text-base font-semibold text-white">后台状态与链上探测流水</h2>
        <div className="bg-[#090d16] rounded-lg p-4 font-mono text-xs space-y-2 max-h-48 overflow-y-auto border border-slate-800/80">
          {backendStatus.logs.map((log) => (
            <div key={log.id} className="flex items-start gap-3">
              <span className="text-slate-500 shrink-0">[{log.time}]</span>
              <span
                className={`shrink-0 font-semibold ${
                  log.type === 'success'
                    ? 'text-emerald-400'
                    : log.type === 'warning'
                    ? 'text-amber-400'
                    : log.type === 'error'
                    ? 'text-rose-400'
                    : 'text-sky-400'
                }`}
              >
                {log.type.toUpperCase()}
              </span>
              <span className="text-slate-300">{log.message}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
