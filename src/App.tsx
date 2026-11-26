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
import {
  ActiveLpPosition,
  ApiKeyRequirement,
  PoolSelectionRound,
  RiskProfileKey,
  ScoredPool,
  StrategyConfig,
} from './utils/strategyEngine';

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
  const [scanningRisk, setScanningRisk] = useState(false);
  const [activePositions, setActivePositions] = useState<ActiveLpPosition[]>([]);
  const [selectionRounds, setSelectionRounds] = useState<PoolSelectionRound[]>([]);

  const handleRefreshPositions = useCallback(async () => {
    try {
      const res = await fetch('/api/positions?force=true');
      const data = await res.json();
      if (data.success && Array.isArray(data.positions)) {
        setActivePositions(data.positions);
      }
    } catch (err) {
      console.error('刷新做市仓位失败', err);
    }
  }, []);

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
        if (statusData.activePositions) {
          setActivePositions(statusData.activePositions);
        }
        if (statusData.selectionRounds) {
          setSelectionRounds(statusData.selectionRounds);
        }
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
          setLastScanTime(
            new Date(data.timestamp).toLocaleTimeString('zh-CN', { hour12: false })
          );
        }
        if (data.riskAlerts) {
          setBackendStatus((prev) =>
            prev ? { ...prev, riskAlerts: data.riskAlerts } : prev
          );
        }
        if (data.selectionRounds) {
          setSelectionRounds(data.selectionRounds);
        }
      }
    } catch (err) {
      console.error('加载矿池失败', err);
    } finally {
      setLoadingPools(false);
    }
  }, []);

  const handleRunRiskScan = useCallback(async () => {
    setScanningRisk(true);
    try {
      const res = await fetch('/api/risk/scan', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.backendStatus) {
        setBackendStatus(data.backendStatus);
        if (data.activePositions) {
          setActivePositions(data.activePositions);
        }
        if (data.selectionRounds) {
          setSelectionRounds(data.selectionRounds);
        }
      }
    } catch (err) {
      console.error('风控巡检失败', err);
    } finally {
      setScanningRisk(false);
    }
  }, []);

  useEffect(() => {
    loadInitialStatus().then(() => handleRunRiskScan());
    loadPools();
  }, [loadInitialStatus, loadPools, handleRunRiskScan]);

  // Real-time 30-second background risk monitor polling
  useEffect(() => {
    const timer = setInterval(() => {
      handleRunRiskScan();
    }, 30_000);
    return () => clearInterval(timer);
  }, [handleRunRiskScan]);

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
        await handleRunRiskScan();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  if (loading || !backendStatus || !strategyConfig) {
    return (
      <div className="min-h-screen bg-[#090d16] text-slate-200 flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm">
          <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
          <span>正在连接 Helius 主网节点与加载实时策略监控台...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100">
      <Header
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        onRunRiskScan={handleRunRiskScan}
        scanningRisk={scanningRisk}
      />

      <main className="max-w-[1360px] mx-auto px-6 py-8">
        {activeTab === 'overview' && (
          <OverviewAndKeysView
            backendStatus={backendStatus}
            strategyConfig={strategyConfig}
            apiKeyRequirements={apiKeyRequirements}
            scanningRisk={scanningRisk}
            activePositions={activePositions}
            selectionRounds={selectionRounds}
            topPool={pools[0]}
            onCheckHelius={handleCheckHelius}
            onRunRiskScan={handleRunRiskScan}
            onRefreshPositions={handleRefreshPositions}
            onUpdateBackendStatus={setBackendStatus}
            onUpdateStrategyConfig={setStrategyConfig}
            onGoToStrategy={() => setActiveTab('strategy')}
            onGoToPools={() => setActiveTab('pools')}
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
            pools={pools}
            activePositions={activePositions}
            backendStatus={backendStatus}
            onApplyPreset={handleApplyPreset}
            onUpdateStrategyConfig={setStrategyConfig}
            onUpdateBackendStatus={setBackendStatus}
            onRefreshPositions={handleRefreshPositions}
          />
        )}
      </main>
    </div>
  );
}
