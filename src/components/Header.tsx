import React from 'react';

export type TabKey = 'overview' | 'pools' | 'strategy' | 'logs';

interface HeaderProps {
  activeTab: TabKey;
  onChangeTab: (tab: TabKey) => void;
  onRunRiskScan: () => void;
  scanningRisk: boolean;
  logErrorCount?: number;
}

const NAV_ITEMS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '策略与风控概览' },
  { key: 'pools', label: '自动选池矩阵' },
  { key: 'strategy', label: '收益方案配置' },
  { key: 'logs', label: '运行日志' },
];

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onChangeTab,
  onRunRiskScan,
  scanningRisk,
  logErrorCount = 0,
}) => {
  return (
    <header className="border-b border-slate-800/80 bg-[#090d16]/95 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-[1360px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
        <a
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            onChangeTab('overview');
          }}
          className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          Solana 流动性量化台
        </a>

        <nav
          aria-label="主导航"
          className="hidden md:flex items-center gap-7 text-sm font-medium"
        >
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onChangeTab(item.key)}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                  active
                    ? 'text-slate-100 border-emerald-500'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
                }`}
              >
                <span>{item.label}</span>
                {item.key === 'logs' && logErrorCount > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                    {logErrorCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0">
          <button
            type="button"
            disabled={scanningRisk}
            onClick={onRunRiskScan}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {scanningRisk ? '主网巡检中...' : '立即风控巡检'}
          </button>
        </div>
      </div>

      {/* Mobile secondary nav */}
      <nav
        aria-label="移动端导航"
        className="flex md:hidden items-center gap-4 px-6 py-2 border-t border-slate-800/70 overflow-x-auto text-xs"
      >
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onChangeTab(item.key)}
            className={`whitespace-nowrap shrink-0 py-1 font-medium inline-flex items-center gap-1 ${
              activeTab === item.key ? 'text-emerald-400' : 'text-slate-400'
            }`}
          >
            <span>{item.label}</span>
            {item.key === 'logs' && logErrorCount > 0 && (
              <span className="px-1 py-0.5 text-[10px] font-mono rounded bg-rose-500/20 text-rose-300">
                {logErrorCount}
              </span>
            )}
          </button>
        ))}
      </nav>
    </header>
  );
};
