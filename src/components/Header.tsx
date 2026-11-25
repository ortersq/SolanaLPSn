import React from 'react';

export type TabKey = 'overview' | 'pools' | 'strategy' | 'deploy';

interface HeaderProps {
  activeTab: TabKey;
  onChangeTab: (tab: TabKey) => void;
  onNavigateDeploy: () => void;
}

const NAV_ITEMS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '接口与链上实测' },
  { key: 'pools', label: '自动选池矩阵' },
  { key: 'strategy', label: '200U 稳健方案' },
  { key: 'deploy', label: '新加坡安全部署' },
];

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onChangeTab,
  onNavigateDeploy,
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
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                  active
                    ? 'text-slate-100 border-emerald-500'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0">
          <button
            type="button"
            onClick={onNavigateDeploy}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            获取安全部署包
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
            className={`whitespace-nowrap shrink-0 py-1 font-medium ${
              activeTab === item.key ? 'text-emerald-400' : 'text-slate-400'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </header>
  );
};
