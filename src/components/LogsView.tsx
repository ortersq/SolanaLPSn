import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownUp,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Info,
  RefreshCw,
  Search,
  ShieldAlert,
  Terminal,
  X,
  XCircle,
} from 'lucide-react';
import { PoolSelectionRound, RiskLogEntry } from '../utils/strategyEngine';
import { BackendStatus, LogItem, StrategyDiagnostic, WorkerHeartbeatStatus } from './OverviewAndKeysView';

interface LogsViewProps {
  backendStatus: BackendStatus;
  selectionRounds: PoolSelectionRound[];
  onRefreshStatus?: () => Promise<void>;
}

type LevelFilter = 'all' | 'error' | 'warning' | 'success' | 'info';
type SourceFilter = 'all' | 'tx' | 'risk' | 'strategy' | 'worker' | 'system';

interface LogsApiResponse {
  success: boolean;
  logs: LogItem[];
  totalCount: number;
  countsByLevel: Record<LevelFilter, number>;
  countsBySource: Record<SourceFilter, number>;
  workerStatus: WorkerHeartbeatStatus;
  heliusConnected: boolean;
  heliusLatencyMs: number | null;
  dryRunMode: boolean;
  riskAlerts: RiskLogEntry[];
  selectionRounds: PoolSelectionRound[];
  strategyDiagnostic?: StrategyDiagnostic | null;
  timestamp: string;
}

const SOURCE_LABELS: Record<Exclude<SourceFilter, 'all'>, string> = {
  tx: '交易建仓',
  risk: '风控拦截',
  strategy: '策略调度',
  worker: 'Worker',
  system: '系统状态',
};

function inferClientSource(msg: string): Exclude<SourceFilter, 'all'> {
  if (/TX:|建仓|加仓|换仓|撤池|回收|复投|SOL 燃料|重平衡|平旧仓/.test(msg)) return 'tx';
  if (/防撤池|止损|风控|滑点|拦截|黑名单|回撤|越界|貔貅|假深度/.test(msg)) return 'risk';
  if (/Worker|心跳|worker/i.test(msg)) return 'worker';
  if (/策略|方案|配置|评估|参数|切换为/.test(msg)) return 'strategy';
  return 'system';
}

function renderMessageWithTxLinks(message: string): React.ReactNode {
  const txRegex = /\b([1-9A-HJ-NP-Za-km-z]{43,88})\b/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = txRegex.exec(message)) !== null) {
    const token = match[1];
    const start = match.index;
    const prefix = message.slice(Math.max(0, start - 6), start);
    const isLikelyTxOrMint =
      token.length >= 64 || /TX:\s*$/i.test(prefix) || /NFT\s*$/i.test(prefix);

    if (!isLikelyTxOrMint) {
      continue;
    }

    if (start > lastIndex) {
      parts.push(message.slice(lastIndex, start));
    }

    const isTx = token.length >= 64 || /TX:\s*$/i.test(prefix);
    const href = isTx
      ? `https://solscan.io/tx/${token}`
      : `https://solscan.io/token/${token}`;
    const short = `${token.slice(0, 6)}...${token.slice(-6)}`;

    parts.push(
      <a
        key={`${start}-${token}`}
        href={href}
        target="_blank"
        rel="noreferrer"
        title={token}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors font-mono text-[11px]"
      >
        <span>{short}</span>
        <ExternalLink className="w-2.5 h-2.5" />
      </a>
    );
    lastIndex = start + token.length;
  }

  if (lastIndex === 0) return message;
  if (lastIndex < message.length) {
    parts.push(message.slice(lastIndex));
  }
  return parts;
}

export const LogsView: React.FC<LogsViewProps> = ({
  backendStatus,
  selectionRounds,
  onRefreshStatus,
}) => {
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [newestFirst, setNewestFirst] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [contextTab, setContextTab] = useState<'alerts' | 'rounds'>('alerts');
  const [apiData, setApiData] = useState<LogsApiResponse | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string>('');

  const fetchLogs = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await fetch('/api/logs?limit=300');
      if (res.ok) {
        const data: LogsApiResponse = await res.json();
        if (data.success) {
          setApiData(data);
          setLastFetchedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
        }
      }
    } catch {
      // Fallback to props backendStatus
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs(false);
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      fetchLogs(true);
    }, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchLogs]);

  const rawLogs = apiData?.logs ?? backendStatus.logs ?? [];
  const workerStatus = apiData?.workerStatus ?? backendStatus.workerStatus;
  const riskAlerts = apiData?.riskAlerts ?? backendStatus.riskAlerts ?? [];
  const rounds = apiData?.selectionRounds?.length ? apiData.selectionRounds : selectionRounds;
  const diagnostic = apiData?.strategyDiagnostic ?? backendStatus.strategyDiagnostic;
  const dryRunMode = apiData?.dryRunMode ?? backendStatus.dryRunMode ?? false;

  const countsByLevel = useMemo(() => {
    if (apiData?.countsByLevel) return apiData.countsByLevel;
    return {
      all: rawLogs.length,
      error: rawLogs.filter((l) => l.type === 'error').length,
      warning: rawLogs.filter((l) => l.type === 'warning').length,
      success: rawLogs.filter((l) => l.type === 'success').length,
      info: rawLogs.filter((l) => l.type === 'info').length,
    };
  }, [apiData, rawLogs]);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = rawLogs.filter((item) => {
      if (levelFilter !== 'all' && item.type !== levelFilter) return false;
      const src = item.source || inferClientSource(item.message);
      if (sourceFilter !== 'all' && src !== sourceFilter) return false;
      if (
        q &&
        !item.message.toLowerCase().includes(q) &&
        !String(item.dateTime || item.time).toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
    return newestFirst ? list : [...list].reverse();
  }, [rawLogs, levelFilter, sourceFilter, searchQuery, newestFirst]);

  const handleCopyVisible = async () => {
    const text = filteredLogs
      .map(
        (l) =>
          `[${l.dateTime || l.time}] [${l.type.toUpperCase()}] [${(l.source || inferClientSource(l.message)).toUpperCase()}] ${l.message}`
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text || '暂无日志记录');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked in restricted context
    }
  };

  const handleManualRefresh = async () => {
    await Promise.all([fetchLogs(false), onRefreshStatus ? onRefreshStatus() : Promise.resolve()]);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <section className="bg-[#101624] border border-slate-800/90 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <Terminal className="w-5 h-5 text-emerald-400 shrink-0" />
              <h1 className="text-lg font-bold text-white">
                运行日志与问题诊断中心
              </h1>
              <span className="px-2 py-0.5 text-xs font-mono rounded bg-slate-800 text-slate-300 border border-slate-700">
                保留最近 {countsByLevel.all} / 300 条（重启不丢失）
              </span>
            </div>
            <p className="text-xs text-slate-400">
              集中查看后台自动建仓、原仓复投、重平衡调仓、防撤池拦截与链上交易报错日志，支持按等级/模块过滤、关键词检索与 TXT 导出。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setAutoRefresh((v) => !v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                autoRefresh
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                  : 'bg-[#090d16] text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                }`}
              />
              <span>{autoRefresh ? '自动刷新 5s 开启' : '自动刷新已暂停'}</span>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={handleManualRefresh}
              className="px-3 py-1.5 text-xs font-medium text-slate-100 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors cursor-pointer inline-flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>立即刷新</span>
            </button>

            <button
              type="button"
              onClick={handleCopyVisible}
              className="px-3 py-1.5 text-xs font-medium text-slate-100 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer inline-flex items-center gap-1.5"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copied ? '已复制' : '复制当前日志'}</span>
            </button>

            <a
              href="/api/logs/export"
              download="solana-lp-logs.txt"
              className="px-3 py-1.5 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>导出 .txt</span>
            </a>
          </div>
        </div>

        {/* 4 Diagnostic Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className="p-3.5 rounded-lg bg-[#090d16] border border-slate-800/80 space-y-1">
            <div className="text-xs text-slate-400 flex items-center justify-between">
              <span>后台守护进程 (Worker)</span>
              <span
                className={`font-mono font-semibold ${
                  workerStatus?.running ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {workerStatus?.running ? '运行中' : '未检测到心跳'}
              </span>
            </div>
            <div className="text-sm font-mono font-semibold text-white">
              PID {workerStatus?.pid ?? '-'} · 已巡检 {workerStatus?.tickCount ?? 0} 轮
            </div>
            <div className="text-[11px] font-mono text-slate-400 truncate">
              最近心跳:{' '}
              {workerStatus?.lastTickAt
                ? new Date(workerStatus.lastTickAt).toLocaleTimeString('zh-CN', { hour12: false })
                : '暂无'}
              {workerStatus?.lastError ? ` · 异常: ${workerStatus.lastError}` : ''}
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-[#090d16] border border-slate-800/80 space-y-1">
            <div className="text-xs text-slate-400 flex items-center justify-between">
              <span>链上节点与执行模式</span>
              <span className="font-mono text-emerald-400">
                {dryRunMode ? 'DRY_RUN 演练' : '实盘自动运行'}
              </span>
            </div>
            <div className="text-sm font-mono font-semibold text-white">
              Helius {backendStatus.heliusConnected ? '已连接' : '重连中'} (
              {backendStatus.heliusLatencyMs ?? '-'} ms)
            </div>
            <div className="text-[11px] font-mono text-slate-400 truncate">
              钱包: {backendStatus.watchWalletMasked} · 余额{' '}
              {backendStatus.watchBalanceSOL !== null
                ? `${backendStatus.watchBalanceSOL} SOL`
                : '-'}
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-[#090d16] border border-slate-800/80 space-y-1">
            <div className="text-xs text-slate-400 flex items-center justify-between">
              <span>最新策略引擎动作</span>
              <span className="font-mono text-sky-400">
                {diagnostic?.actionTaken || 'MONITORING'}
              </span>
            </div>
            <div
              className="text-xs font-medium text-slate-100 line-clamp-2"
              title={diagnostic?.conclusion || ''}
            >
              {diagnostic?.conclusion || '等待下轮策略评估...'}
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-[#090d16] border border-slate-800/80 space-y-1">
            <div className="text-xs text-slate-400 flex items-center justify-between">
              <span>日志异常统计</span>
              {lastFetchedAt && (
                <span className="text-[11px] font-mono text-slate-500">更新 {lastFetchedAt}</span>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm font-mono font-bold">
              <span className={countsByLevel.error > 0 ? 'text-rose-400' : 'text-slate-400'}>
                错误 {countsByLevel.error}
              </span>
              <span className={countsByLevel.warning > 0 ? 'text-amber-400' : 'text-slate-400'}>
                警告 {countsByLevel.warning}
              </span>
              <span className="text-emerald-400">成功 {countsByLevel.success}</span>
            </div>
            <div className="text-[11px] text-slate-400">
              点击下方任意蓝色 TX/NFT 编号可直达 Solscan 核验
            </div>
          </div>
        </div>
      </section>

      {/* Main Log Filter & Stream Panel */}
      <section className="bg-[#101624] border border-slate-800/90 rounded-xl p-6 space-y-4">
        {/* Filter controls */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          {/* Level Tabs */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-[#090d16] rounded-lg border border-slate-800">
              {(
                [
                  { key: 'all', label: `全部 (${countsByLevel.all})` },
                  { key: 'error', label: `错误 (${countsByLevel.error})` },
                  { key: 'warning', label: `警告 (${countsByLevel.warning})` },
                  { key: 'success', label: `成功 (${countsByLevel.success})` },
                  { key: 'info', label: `信息 (${countsByLevel.info})` },
                ] as { key: LevelFilter; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setLevelFilter(tab.key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    levelFilter === tab.key
                      ? tab.key === 'error'
                        ? 'bg-rose-500/20 text-rose-300'
                        : tab.key === 'warning'
                        ? 'bg-amber-500/20 text-amber-300'
                        : tab.key === 'success'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Source Selector */}
            <select
              aria-label="按模块筛选日志"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
              className="bg-[#090d16] border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="all">全部模块来源</option>
              <option value="tx">交易建仓 / 调仓</option>
              <option value="risk">风控 / 防撤池拦截</option>
              <option value="strategy">策略与参数变更</option>
              <option value="worker">后台 Worker 进程</option>
              <option value="system">系统连接状态</option>
            </select>
          </div>

          {/* Search + Sort Order */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 sm:w-72">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索池名 / TX / 错误关键词 (如 VVV, ANT, 6021)..."
                className="w-full bg-[#090d16] border border-slate-700/80 rounded-lg pl-8 pr-8 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
                  aria-label="清空搜索"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setNewestFirst((v) => !v)}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-[#090d16] border border-slate-800 rounded-lg hover:border-slate-700 transition-colors cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <ArrowDownUp className="w-3.5 h-3.5 text-slate-400" />
              <span>{newestFirst ? '最新优先' : '时间正序'}</span>
            </button>
          </div>
        </div>

        {/* Log Lines */}
        <div
          data-testid="full-logs-stream"
          className="bg-[#090d16] rounded-lg border border-slate-800/80 divide-y divide-slate-800/50 max-h-[560px] overflow-y-auto font-mono text-xs"
        >
          {filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-slate-500 space-y-2">
              <Info className="w-6 h-6 mx-auto text-slate-600" />
              <div>当前筛选条件下暂无匹配日志记录</div>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const src = log.source || inferClientSource(log.message);
              const levelStyles =
                log.type === 'error'
                  ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                  : log.type === 'warning'
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                  : log.type === 'success'
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'bg-sky-500/15 text-sky-400 border-sky-500/30';

              const LevelIcon =
                log.type === 'error'
                  ? XCircle
                  : log.type === 'warning'
                  ? AlertTriangle
                  : log.type === 'success'
                  ? CheckCircle2
                  : Info;

              return (
                <div
                  key={log.id}
                  className={`px-4 py-2.5 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 hover:bg-slate-800/20 transition-colors ${
                    log.type === 'error' ? 'bg-rose-950/10' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 shrink-0 pt-0.5">
                    <span className="text-slate-500 tabular-nums w-28">
                      [{log.dateTime || log.time}]
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-semibold w-16 justify-center ${levelStyles}`}
                    >
                      <LevelIcon className="w-3 h-3 shrink-0" />
                      {log.type.toUpperCase()}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-400 border border-slate-700/70 text-[11px] w-16 text-center">
                      {SOURCE_LABELS[src]}
                    </span>
                  </div>
                  <div className="text-slate-200 leading-relaxed break-all flex-1 font-sans">
                    {renderMessageWithTxLinks(log.message)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Secondary Diagnostic Panels: Risk Alerts + Selection Rounds */}
      <section className="bg-[#101624] border border-slate-800/90 rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <h2 className="text-base font-semibold text-white">
              关联诊断上下文（风控拦截明细 / 选池决策快照）
            </h2>
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#090d16] rounded-lg border border-slate-800 self-start">
            <button
              type="button"
              onClick={() => setContextTab('alerts')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                contextTab === 'alerts'
                  ? 'bg-slate-800 text-amber-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              风控拦截日志 ({riskAlerts.length})
            </button>
            <button
              type="button"
              onClick={() => setContextTab('rounds')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                contextTab === 'rounds'
                  ? 'bg-slate-800 text-emerald-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              最近选池决策 ({rounds.length})
            </button>
          </div>
        </div>

        {contextTab === 'alerts' ? (
          <div className="bg-[#090d16] rounded-lg border border-slate-800/80 divide-y divide-slate-800/50 max-h-80 overflow-y-auto">
            {riskAlerts.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">暂无风控异常告警</div>
            ) : (
              riskAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-xs"
                >
                  <div className="flex items-center gap-2.5 font-mono shrink-0">
                    <span className="text-slate-500">[{alert.time}]</span>
                    <span
                      className={`font-semibold w-20 ${
                        alert.severity === 'critical'
                          ? 'text-rose-400'
                          : alert.severity === 'warning'
                          ? 'text-amber-400'
                          : alert.severity === 'safe'
                          ? 'text-emerald-400'
                          : 'text-sky-400'
                      }`}
                    >
                      {alert.severity.toUpperCase()}
                    </span>
                    <span className="text-slate-200 w-36 truncate">{alert.target}</span>
                  </div>
                  <div className="text-slate-300 flex-1">{alert.detail}</div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="bg-[#090d16] rounded-lg border border-slate-800/80 divide-y divide-slate-800/50 max-h-80 overflow-y-auto">
            {rounds.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">暂无选池轮次快照</div>
            ) : (
              rounds.slice(0, 15).map((rnd) => (
                <div key={rnd.round} className="px-4 py-3 space-y-1.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono">
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-400 font-semibold">第 {rnd.round} 轮</span>
                      <span className="text-slate-500">[{rnd.time}]</span>
                      <span className="text-slate-200">
                        胜选: {rnd.chosenPool?.name || '空仓观望'}
                      </span>
                      {rnd.chosenPool && (
                        <span className="text-emerald-400">+{rnd.chosenPool.apr}% APR</span>
                      )}
                    </div>
                    <div className="text-slate-400">
                      SOL ${rnd.solPriceUsd ?? '-'} · 滑点{' '}
                      {rnd.jupiterSlippageBps !== null ? `${rnd.jupiterSlippageBps} bps` : '-'}
                    </div>
                  </div>
                  <div className="text-slate-300 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>{rnd.strategyAction}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </section>
    </div>
  );
};
