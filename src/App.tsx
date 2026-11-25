/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { Header, TabKey } from './components/Header';
import { BackendStatus, OverviewAndKeysView } from './components/OverviewAndKeysView';
import { PoolMatrixView } from './components/PoolMatrixView';
import { StrategyRiskView } from './components/StrategyRiskView';
import { SingaporeDeployView } from './components/SingaporeDeployView';
import {
  ApiKeyRequirement,
  RiskProfileKey,
  ScoredPool,
  StrategyConfig,
} from './utils/strategyEngine';
import { DeployBundleOutput } from './utils/deployGenerator';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [loading, setLoading] = useState(true);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [strategyConfig, setStrategyConfig] = useState<StrategyConfig | null>(null);
  const [apiKeyRequirements, setApiKeyRequirements] = useState<ApiKeyRequirement[]>([]);
  const [pools, setPools] = useState<ScoredPool[]>([]);
  const [poolSource, setPoolSource] = useState('');
  const [lastScanTime, setLastScanTime] = useState('');
  const [loadingPools, setLoadingPools] = useState(false);

  const loadInitialStatus = useCallback(async () => {
    try {
      const [statusRes, heliusRes] = await Promise.all([
        fetch('/api/status'),
        fetch('/api/helius/health'),
      ]);
      const statusData = await statusRes.json();
      if (statusData.success) {
        setBackendStatus(statusData.backendStatus);
        setStrategyConfig(statusData.strategyConfig);
        setApiKeyRequirements(statusData.apiKeyRequirements || []);
      }
      if (heliusRes.ok) {
        const heliusData = await heliusRes.json();
        if (heliusData.success && heliusData.backendStatus) {
          setBackendStatus(heliusData.backendStatus);
        }
      }
    } catch (err) {
      console.error('初始化加载失败', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPools = useCallback(async () => {
    setLoadingPools(true);
    try {
      const res = await fetch('/api/pools/scan');
      const data = await res.json();
      if (data.success) {
        setPools(data.pools || []);
        setPoolSource(data.source || '');
        if (data.timestamp) {
          setLastScanTime(new Date(data.timestamp).toLocaleTimeString('zh-CN', { hour12: false }));
        }
      }
    } catch (err) {
      console.error('加载矿池失败', err);
    } finally {
      setLoadingPools(false);
    }
  }, []);

  useEffect(() => {
    loadInitialStatus();
    loadPools();
  }, [loadInitialStatus, loadPools]);

  const handleCheckHelius = async () => {
    try {
      const res = await fetch('/api/helius/health');
      const data = await res.json();
      if (data.success && data.backendStatus) {
        setBackendStatus(data.backendStatus);
      }
    } catch (err) {
      console.error('Helius 测速失败', err);
    }
  };

  const handleApplyPreset = async (
    capitalUsdt: number,
    riskProfile: RiskProfileKey
  ): Promise<boolean> => {
    try {
      const res = await fetch('/api/strategy/preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capitalUsdt, riskProfile }),
      });
      const data = await res.json();
      if (data.success) {
        setStrategyConfig(data.strategyConfig);
        setBackendStatus((prev) =>
          prev ? { ...prev, logs: data.logs || prev.logs } : prev
        );
        await loadPools();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const handleGenerateBundle = async (): Promise<{
    ok: boolean;
    bundle?: DeployBundleOutput;
    error?: string;
  }> => {
    try {
      const res = await fetch('/api/deploy/package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        return { ok: true, bundle: data.bundle };
      }
      return { ok: false, error: data.error || '生成失败' };
    } catch (err: any) {
      return { ok: false, error: err.message || '网络异常' };
    }
  };

  if (loading || !backendStatus || !strategyConfig) {
    return (
      <div className="min-h-screen bg-[#090d16] text-slate-200 flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm">
          <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
          <span>正在连接 Helius 主网节点与加载 200U 稳定盈利方案...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100">
      <Header
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        onNavigateDeploy={() => setActiveTab('deploy')}
      />

      <main className="max-w-[1360px] mx-auto px-6 py-8">
        {activeTab === 'overview' && (
          <OverviewAndKeysView
            backendStatus={backendStatus}
            strategyConfig={strategyConfig}
            apiKeyRequirements={apiKeyRequirements}
            onCheckHelius={handleCheckHelius}
            onGoToStrategy={() => setActiveTab('strategy')}
            onGoToDeploy={() => setActiveTab('deploy')}
          />
        )}

        {activeTab === 'pools' && (
          <PoolMatrixView
            pools={pools}
            dataSource={poolSource}
            lastScanTime={lastScanTime}
            loadingPools={loadingPools}
            capitalUsdt={strategyConfig.capitalUsdt}
            minTVL={strategyConfig.minTVL}
            rangeWidthPct={strategyConfig.rangeWidthPct}
            onRefreshPools={loadPools}
          />
        )}

        {activeTab === 'strategy' && (
          <StrategyRiskView
            strategyConfig={strategyConfig}
            topPool={pools[0]}
            onApplyPreset={handleApplyPreset}
          />
        )}

        {activeTab === 'deploy' && (
          <SingaporeDeployView
            strategyConfig={strategyConfig}
            onGenerateBundle={handleGenerateBundle}
          />
        )}
      </main>
    </div>
  );
}
