import React, { useState } from 'react';
import { Check, Copy, Download, Lock, Server, Terminal } from 'lucide-react';
import { DeployBundleOutput } from '../utils/deployGenerator';
import { StrategyConfig } from '../utils/strategyEngine';

interface SingaporeDeployProps {
  strategyConfig: StrategyConfig;
  onGenerateBundle: () => Promise<{
    ok: boolean;
    bundle?: DeployBundleOutput;
    error?: string;
  }>;
}

export const SingaporeDeployView: React.FC<SingaporeDeployProps> = ({
  strategyConfig,
  onGenerateBundle,
}) => {
  const [bundle, setBundle] = useState<DeployBundleOutput | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [generating, setGenerating] = useState(false);
  const [activeCodeTab, setActiveCodeTab] = useState<'deploy' | 'bot' | 'compose' | 'env'>('deploy');
  const [copiedKey, setCopiedKey] = useState('');

  const handleGenerate = async () => {
    setErrorMsg('');
    setGenerating(true);
    try {
      const res = await onGenerateBundle();
      if (res.ok && res.bundle) {
        setBundle(res.bundle);
      } else {
        setErrorMsg(res.error || '生成失败');
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(''), 2000);
  };

  const handleDownloadScript = () => {
    if (!bundle) return;
    const blob = new Blob([bundle.deployScript], { type: 'text/x-shellscript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'deploy.sh';
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeContent = bundle
    ? activeCodeTab === 'deploy'
      ? bundle.deployScript
      : activeCodeTab === 'compose'
      ? bundle.dockerCompose
      : activeCodeTab === 'bot'
      ? bundle.botIndexJs
      : bundle.envExample
    : '';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">
          新加坡 VPS 零前台敏感配置安全部署
        </h1>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
          交易钱包私钥（<code className="text-emerald-400 font-mono">PRIVATE_KEY</code>）与盈利接收地址（<code className="text-emerald-400 font-mono">RECIPIENT_ADDRESS</code>）均不在网页前台填写。所有敏感信息全部在您自己的新加坡服务器 SSH 终端内通过脚本直接写入 <code className="text-emerald-400 font-mono">chmod 600 .env</code>。
        </p>
      </div>

      {/* Zero-Frontend-Input Security Checklist */}
      <div className="p-6 rounded-xl bg-[#101624] border border-slate-800/90 space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
          <Lock className="w-4 h-4 shrink-0" />
          <span>您只需准备新加坡 Ubuntu / Debian 服务器，按以下 3 步部署</span>
        </div>

        <ol className="text-xs text-slate-300 space-y-2 list-decimal pl-5 leading-relaxed">
          <li>
            点击下方按钮生成当前{' '}
            <span className="font-mono text-emerald-400">{strategyConfig.capitalUsdt}U</span>{' '}
            稳健策略专属部署包并下载 <code className="font-mono text-slate-100">deploy.sh</code>（已预置您的 Helius 主网节点）。
          </li>
          <li>
            通过 SSH 登录新加坡服务器，运行 <code className="font-mono text-emerald-400">chmod +x deploy.sh && ./deploy.sh</code>，按终端提示依次安全输入：
            <span className="text-white font-medium"> ① 交易小钱包私钥（隐藏不回显）</span> 与{' '}
            <span className="text-white font-medium">② 盈利接收 Solana 公钥地址</span>。
          </li>
          <li>
            脚本会自动校验环境、安装 Docker 并以 <code className="font-mono text-amber-400">DRY_RUN=true</code> 演练模式启动（只做链上查池与换币报价，绝不盲目扣款），确认日志稳妥后执行一句指令即可切入全自动实盘。
          </li>
        </ol>

        <div className="p-4 rounded-lg bg-[#090d16] border border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <div className="text-slate-500">Helius 主网节点</div>
            <div className="font-mono text-emerald-400 mt-1">已预设 (5641e03b-****)</div>
          </div>
          <div>
            <div className="text-slate-500">交易私钥与收款地址</div>
            <div className="text-slate-200 font-medium mt-1">仅在服务器 SSH 内填写</div>
          </div>
          <div>
            <div className="text-slate-500">内置资金保护参数</div>
            <div className="font-mono text-slate-200 mt-1">
              {strategyConfig.lpActiveUsdt}U 做市 · -{strategyConfig.stopLossPercentage}% 止损
            </div>
          </div>
        </div>

        {errorMsg && <div className="text-xs text-rose-400">{errorMsg}</div>}

        <button
          type="button"
          disabled={generating}
          onClick={handleGenerate}
          className="w-full py-2.5 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 cursor-pointer"
        >
          <Server className="w-4 h-4" />
          {generating ? '正在生成安全部署包...' : '生成新加坡安全部署包（零前台敏感输入）'}
        </button>
      </div>

      {/* Generated Code Artifacts */}
      {bundle && (
        <div className="p-6 rounded-xl bg-[#101624] border border-slate-800/90 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-[#090d16] rounded-lg border border-slate-800 overflow-x-auto">
              {[
                { key: 'deploy', label: 'deploy.sh (一键脚本)' },
                { key: 'bot', label: 'bot/index.js (实盘源码)' },
                { key: 'compose', label: 'docker-compose.yml' },
                { key: 'env', label: '.env.example' },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveCodeTab(t.key as any)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                    activeCodeTab === t.key
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleCopy(activeContent, activeCodeTab)}
                className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                {copiedKey === activeCodeTab ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>已复制</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>复制当前代码</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleDownloadScript}
                className="px-3 py-1.5 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>下载 deploy.sh</span>
              </button>
            </div>
          </div>

          <pre className="bg-[#090d16] p-4 rounded-lg font-mono text-xs text-slate-300 overflow-x-auto max-h-[420px] border border-slate-800 leading-relaxed">
            {activeContent}
          </pre>

          <div className="flex items-start gap-2 text-xs text-slate-400 pt-1">
            <Terminal className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>
              上传到新加坡 VPS 后执行 <code className="font-mono text-slate-200">chmod +x deploy.sh && ./deploy.sh</code>，按终端交互提示输入私钥与盈利接收地址即可。
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
