import React, { useState } from 'react';
import {
  RefreshCw,
  ShieldCheck,
  ArrowRightLeft,
  Lock,
  TrendingUp,
} from 'lucide-react';
import { ApiKeyRequirement, StrategyConfig } from '../utils/strategyEngine';

export interface LogItem {
  id: number;
  time: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

export interface BackendStatus {
  heliusConnected: boolean;
  heliusLatencyMs: number | null;
  lastSlot: number | null;
  privateKeyConfigured: boolean;
  recipientConfigured: boolean;
  recipientMasked: string;
  watchWalletConfigured: boolean;
  watchWalletMasked: string;
  watchBalanceSOL: number | null;
  splTokenAccountsCount: number;
  logs: LogItem[];
}

interface OverviewProps {
  backendStatus: BackendStatus;
  strategyConfig: StrategyConfig;
  apiKeyRequirements: ApiKeyRequirement[];
  onCheckHelius: () => Promise<void>;
  onGoToStrategy: () => void;
  onGoToDeploy: () => void;
}

export const OverviewAndKeysView: React.FC<OverviewProps> = ({
  backendStatus,
  strategyConfig,
  apiKeyRequirements,
  onCheckHelius,
  onGoToStrategy,
  onGoToDeploy,
}) => {
  const [checkingHelius, setCheckingHelius] = useState(false);
  const [quoteAmount, setQuoteAmount] = useState('0.1');
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteResult, setQuoteResult] = useState<{
    inAmountSol: number;
    outAmountUsdc: number;
    priceImpactPct: number;
    route: string;
  } | null>(null);
  const [quoteError, setQuoteError] = useState('');

  const handleHeliusClick = async () => {
    setCheckingHelius(true);
    try {
      await onCheckHelius();
    } finally {
      setCheckingHelius(false);
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
      } else {
        setQuoteError(data.error || 'Jupiter 询价失败');
      }
    } catch (err: any) {
      setQuoteError(err.message || '网络请求异常');
    } finally {
      setQuoteBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Top Security & Architecture Banner */}
      <section className="p-6 rounded-xl bg-[#101624] border border-slate-800/90 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2 max-w-3xl">
          <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>前后端严格隔离 · 私钥与收款地址仅存在服务器后台 .env</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Solana {strategyConfig.capitalUsdt}U 稳定盈利与链上实测控制台
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            前台网页不提供任何私钥或收款地址输入框，彻底杜绝公网访客篡改或泄露风险。系统已自动为您内置 {strategyConfig.capitalUsdt}U 稳健做市风控，并直连您提供的 Helius 主网节点验证真实报价与蓝筹池深度。
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
            onClick={onGoToDeploy}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors whitespace-nowrap cursor-pointer"
          >
            生成新加坡安全部署包
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
          <div className="text-xs text-slate-400 font-medium">后台交易私钥 (.env)</div>
          <div
            className={`text-xl font-bold mt-2 ${
              backendStatus.privateKeyConfigured ? 'text-emerald-400' : 'text-amber-400'
            }`}
          >
            {backendStatus.privateKeyConfigured ? '已在服务器就绪' : '待部署时注入'}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            SSH 隐藏输入写入 chmod 600 .env
          </div>
        </div>

        <div className="p-5 rounded-xl bg-[#101624] border border-slate-800/90">
          <div className="text-xs text-slate-400 font-medium">后台盈利收款地址 (.env)</div>
          <div className="text-xl font-bold font-mono text-slate-100 mt-2">
            {backendStatus.recipientConfigured ? backendStatus.recipientMasked : '待后台配置'}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {backendStatus.recipientConfigured
              ? '已脱敏展示 · 仅后台可修改'
              : '网页端禁止填写与篡改'}
          </div>
        </div>

        <div className="p-5 rounded-xl bg-[#101624] border border-slate-800/90">
          <div className="text-xs text-slate-400 font-medium">后台监控钱包真实余额</div>
          <div className="text-xl font-bold font-mono text-emerald-400 mt-2 tabular-nums">
            {backendStatus.watchBalanceSOL !== null
              ? `${backendStatus.watchBalanceSOL.toFixed(4)} SOL`
              : '未配置观测地址'}
          </div>
          <div className="text-xs text-slate-500 font-mono mt-1">
            {backendStatus.watchWalletConfigured
              ? `${backendStatus.watchWalletMasked} · ${backendStatus.splTokenAccountsCount} 个代币账户`
              : '未在后台设钱包前绝不虚构仓位'}
          </div>
        </div>
      </section>

      {/* Two-Column Core Overview: Backend Security Isolation + Live Jupiter Swap Test */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Read-only Security Architecture & 200U Strategy Summary */}
        <div className="p-6 rounded-xl bg-[#101624] border border-slate-800/90 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
              <Lock className="w-4 h-4 shrink-0" />
              <span>当前自动策略与资产隔离状态</span>
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
              系统已为您拆好资金安全垫：留出{' '}
              <span className="text-slate-100 font-mono font-semibold">
                {strategyConfig.gasReserveUsdt} U
              </span>{' '}
              作为 SOL 链上 Gas 与租金，其余{' '}
              <span className="text-emerald-400 font-mono font-semibold">
                {strategyConfig.lpActiveUsdt} U
              </span>{' '}
              只进入深度 ≥ ${(strategyConfig.minTVL / 1_000_000).toFixed(1)}M 的蓝筹主流池，采用 ±{strategyConfig.rangeWidthPct}% 宽区间减少无谓调仓损耗，手续费满 ${strategyConfig.harvestMinUsd} 再收割，触及 -{strategyConfig.stopLossPercentage}% 自动全撤止损。
            </p>
          </div>

          <div className="pt-2 flex items-center justify-between border-t border-slate-800/80">
            <span className="text-xs text-slate-500">
              收款地址与交易私钥均在新加坡服务器 .env 内单独配置
            </span>
            <button
              type="button"
              onClick={onGoToStrategy}
              className="text-xs font-medium text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              查看 200U 方案详情
            </button>
          </div>
        </div>

        {/* Live Jupiter Swap v1 Quote Verification */}
        <div className="p-6 rounded-xl bg-[#101624] border border-slate-800/90 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-white">
              Jupiter Swap v1 免密兑换接口实测（SOL 兑换 USDC）
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              实时调用 lite-api.jup.ag/swap/v1 获取真实链上聚合路由，验证无需额外 API Key 即可完成 50:50 自动换币。
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
            {quoteError && (
              <div className="text-xs text-rose-400">{quoteError}</div>
            )}
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
            全流程各接口 API Key 需求清单（无需额外购买其它商业 Key）
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            除您已提供的 Helius RPC Key 与后台签名私钥外，换币、加池、撤池、利润转账均直接走免密公开接口与 Solana 原生合约。
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

      {/* Live Backend Logs */}
      <section className="p-6 rounded-xl bg-[#101624] border border-slate-800/90 space-y-3">
        <h2 className="text-base font-semibold text-white">后台状态与链上实测日志</h2>
        <div className="bg-[#090d16] rounded-lg p-4 font-mono text-xs space-y-2 max-h-56 overflow-y-auto border border-slate-800/80">
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
