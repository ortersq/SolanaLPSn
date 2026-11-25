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
} from 'lucide-react';
import {
  ApiKeyRequirement,
  PipelineStepKey,
  PipelineStepResult,
  RiskLogEntry,
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
}

interface OverviewProps {
  backendStatus: BackendStatus;
  strategyConfig: StrategyConfig;
  apiKeyRequirements: ApiKeyRequirement[];
  scanningRisk: boolean;
  onCheckHelius: () => Promise<void>;
  onRunRiskScan: () => Promise<void>;
  onUpdateBackendStatus: (status: BackendStatus) => void;
  onGoToStrategy: () => void;
  onGoToPools: () => void;
}

const PIPELINE_STEP_META: { key: PipelineStepKey; title: string; buttonLabel: string; hint: string }[] = [
  {
    key: 'swap',
    title: '1. 代币兑换 (Jupiter Swap v1)',
    buttonLabel: '测试兑换',
    hint: '验证 0.01 SOL → USDC 聚合报价、交易序列化及私钥签名仿真',
  },
  {
    key: 'addLp',
    title: '2. 加池子 (Raydium CLMM)',
    buttonLabel: '测试加池',
    hint: '核验首选池合约账户数据，并按当前策略计算 50:50 资金与集中区间',
  },
  {
    key: 'removeLp',
    title: '3. 撤池子与防滑点熔断',
    buttonLabel: '测试撤池',
    hint: '探测反向 10 USDC → SOL 退出滑点与止损紧急撤池通道',
  },
  {
    key: 'sweep',
    title: '4. 利润转移 (SystemProgram 转账)',
    buttonLabel: '测试利润转移',
    hint: '校验收款冷钱包公钥并执行 0.0001 SOL 转账主网模拟（不扣费）',
  },
];

export const OverviewAndKeysView: React.FC<OverviewProps> = ({
  backendStatus,
  strategyConfig,
  apiKeyRequirements,
  scanningRisk,
  onCheckHelius,
  onRunRiskScan,
  onUpdateBackendStatus,
  onGoToStrategy,
  onGoToPools,
}) => {
  const [checkingHelius, setCheckingHelius] = useState(false);
  const [alertFilter, setAlertFilter] = useState<'all' | 'alerts-only'>('all');
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
        body: JSON.stringify({ step }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setPipelineError(data.error || '链路自检请求失败');
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
    } catch (err: any) {
      setPipelineError(err?.message || '网络请求异常');
    } finally {
      setTestingStep(null);
    }
  };

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
            {testingStep === 'all' ? '正在执行全流程主网预演...' : '一键测试全流程（兑换/加池/撤池/转利润）'}
          </button>
        </div>

        {/* One-Click Individual Step Tests */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-white">
                全流程执行链路自检（真实主网仿真 · 零真实扣款）
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                逐项验证服务器私钥签名、Jupiter Swap 兑换、Raydium CLMM 选池配比、撤池防滑点与冷钱包利润转移通路。
              </p>
            </div>
            {lastPipelineTestedAt && (
              <span className="text-xs font-mono text-slate-400 shrink-0">
                最近自检: {lastPipelineTestedAt}
              </span>
            )}
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
                ? '主网仿真通过'
                : res.status === 'readonly_only'
                ? '只读核验通过（缺私钥待签名）'
                : res.status === 'warning'
                ? '配置/余额提醒'
                : '探测失败';

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
                      {isBusy ? '测试中...' : meta.buttonLabel}
                    </button>
                  </div>

                  <div className="text-xs leading-relaxed border-t border-slate-800/70 pt-2.5 space-y-1">
                    {res ? (
                      <>
                        <div className="text-slate-100 font-medium">{res.summary}</div>
                        <div className="text-slate-400 font-mono break-all">{res.details}</div>
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
