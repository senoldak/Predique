import React, { useState, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Shield,
  Zap,
  TrendingUp,
  Activity,
  AlertTriangle,
  RotateCcw,
  Sliders,
  CheckCircle2,
  ExternalLink,
  Lock,
  Trash2,
} from 'lucide-react';

export type AutoTradeStrategy =
  | 'SWARM_MOMENTUM'
  | 'MEAN_REVERSION'
  | 'ENSEMBLE'
  | 'BREAKOUT_SURGE'
  | 'SNIPER_ALPHA';
export type AutoTradeMode = 'PAPER' | 'LIVE';

export interface AutoTradeConfigData {
  enabled: boolean;
  mode: AutoTradeMode;
  strategy: AutoTradeStrategy;
  maxTradeAmountNative: number;
  maxOpenPositions: number;
  slippagePercent: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  trailingStopPercent: number;
  dailyMaxDrawdownPercent: number;
  minLiquidityUsd: number;
}

export interface AutoTradeStatsData {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnlNative: number;
  profitFactor: number;
  peakDrawdownPercent: number;
  currentDailyDrawdownPercent: number;
  circuitBreakerActive: boolean;
  activeAutoPositionsCount: number;
}

export interface AutoTradeBotItem {
  id: string;
  name: string;
  enabled: boolean;
  mode: AutoTradeMode;
  strategy: AutoTradeStrategy;
  chain: 'ALL' | 'SOLANA' | 'BASE' | 'ETH';
  maxTradeAmountNative: number;
  maxOpenPositions: number;
  slippagePercent: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  trailingStopPercent: number;
  dailyMaxDrawdownPercent: number;
  minLiquidityUsd: number;
  createdAt: number;
  stats?: AutoTradeStatsData;
}

export interface AutoPositionItem {
  id: string;
  botId?: string;
  botName?: string;
  tokenAddress: string;
  tokenSymbol: string;
  chain: string;
  amountIn: number;
  entryPriceUsd?: number;
  currentPriceUsd?: number;
  highestPriceUsd?: number;
  stopLossPriceUsd?: number;
  pnlPercent: number;
  tp1Hit?: boolean;
  strategy: AutoTradeStrategy;
  isPaper?: boolean;
  timestamp: number;
}

export interface AutoHistoryItem {
  id: string;
  positionId: string;
  tokenAddress: string;
  tokenSymbol: string;
  chain: string;
  strategy: AutoTradeStrategy;
  mode: AutoTradeMode;
  entryPriceUsd: number;
  exitPriceUsd: number;
  amountIn: number;
  pnlPercent: number;
  pnlNative: number;
  exitReason: string;
  timestamp: number;
}

interface AutoTradePanelProps {
  jwt: string | null;
  onRefreshPortfolio?: () => void;
}

export const AutoTradePanel: React.FC<AutoTradePanelProps> = ({ jwt, onRefreshPortfolio }) => {
  const [config, setConfig] = useState<AutoTradeConfigData>({
    enabled: false,
    mode: 'PAPER',
    strategy: 'SWARM_MOMENTUM',
    maxTradeAmountNative: 0.1,
    maxOpenPositions: 3,
    slippagePercent: 5,
    takeProfitPercent: 35,
    stopLossPercent: 12,
    trailingStopPercent: 10,
    dailyMaxDrawdownPercent: 5,
    minLiquidityUsd: 15000,
  });

  const [stats, setStats] = useState<AutoTradeStatsData>({
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    totalPnlNative: 0,
    profitFactor: 1.0,
    peakDrawdownPercent: 0,
    currentDailyDrawdownPercent: 0,
    circuitBreakerActive: false,
    activeAutoPositionsCount: 0,
  });

  const [bots, setBots] = useState<AutoTradeBotItem[]>([]);
  const [positions, setPositions] = useState<AutoPositionItem[]>([]);
  const [history, setHistory] = useState<AutoHistoryItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [isCreatingBot, setIsCreatingBot] = useState(false);
  const [newBotName, setNewBotName] = useState('');
  const [newBotChain, setNewBotChain] = useState<'ALL' | 'SOLANA' | 'BASE' | 'ETH'>('SOLANA');
  const [newBotStrategy, setNewBotStrategy] = useState<AutoTradeStrategy>('SWARM_MOMENTUM');
  const [newBotMode, setNewBotMode] = useState<AutoTradeMode>('PAPER');
  const [newBotAmount, setNewBotAmount] = useState(0.1);

  const showFeedbackError = (msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(null), 5000);
  };

  const getAuthToken = useCallback(() => jwt || localStorage.getItem('predique_jwt'), [jwt]);

  const fetchAutoTradeData = useCallback(async () => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const [cfgRes, posRes, histRes, botsRes] = await Promise.all([
        fetch('/api/autotrade/config', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/autotrade/positions', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/autotrade/history', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/autotrade/bots', { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      if (cfgRes.ok) {
        const data = await cfgRes.json();
        if (data.config) setConfig(data.config);
        if (data.stats) setStats(data.stats);
      }
      if (botsRes.ok) {
        const botData = await botsRes.json();
        setBots(botData.bots || []);
      }
      if (posRes.ok) {
        const posData = await posRes.json();
        setPositions(posData.positions || []);
      }
      if (histRes.ok) {
        const histData = await histRes.json();
        setHistory(histData.history || []);
      }
    } catch (err) {
      console.error('AutoTrade data fetch error:', err);
    }
  }, [getAuthToken]);

  useEffect(() => {
    fetchAutoTradeData();
    const interval = setInterval(fetchAutoTradeData, 4000);
    return () => clearInterval(interval);
  }, [fetchAutoTradeData]);

  const handleUpdateConfig = async (partial: Partial<AutoTradeConfigData>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
    setErrorMessage(null);

    const token = getAuthToken();
    if (!token) {
      showFeedbackError('Authentication required. Please refresh or check connection.');
      return;
    }

    try {
      const res = await fetch('/api/autotrade/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(partial),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.config) setConfig(data.config);
        if (data.stats) setStats(data.stats);
      } else {
        showFeedbackError(data.error || `Update failed (HTTP ${res.status})`);
        fetchAutoTradeData();
      }
    } catch (err) {
      console.error('Failed to sync auto-trade config:', err);
      showFeedbackError((err as Error).message);
    }
  };

  const handleToggle = async () => {
    const nextState = !config.enabled;
    setConfig((prev) => ({ ...prev, enabled: nextState }));
    setErrorMessage(null);

    const token = getAuthToken();
    if (!token) {
      showFeedbackError('Authentication required. Please connect wallet or refresh.');
      return;
    }

    try {
      const res = await fetch('/api/autotrade/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: nextState, mode: config.mode, strategy: config.strategy }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.config) setConfig(data.config);
        if (data.stats) setStats(data.stats);
      } else {
        setConfig((prev) => ({ ...prev, enabled: !nextState }));
        showFeedbackError(data.error || `Toggle failed (HTTP ${res.status})`);
      }
    } catch (err) {
      console.error('Failed to toggle auto-trade:', err);
      setConfig((prev) => ({ ...prev, enabled: !nextState }));
      showFeedbackError((err as Error).message);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const token = getAuthToken();
    if (!token) {
      showFeedbackError('Authentication required. Please refresh.');
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch('/api/autotrade/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(config),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.config) setConfig(data.config);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      } else {
        showFeedbackError(data.error || `Save failed (HTTP ${res.status})`);
      }
    } catch (err) {
      console.error('Failed to save auto-trade config:', err);
      showFeedbackError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleBot = async (botId: string, currentEnabled: boolean) => {
    const token = getAuthToken();
    if (!token) {
      showFeedbackError('Authentication required.');
      return;
    }
    try {
      const res = await fetch(`/api/autotrade/bots/${botId}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      if (res.ok) {
        await fetchAutoTradeData();
      } else {
        const data = await res.json().catch(() => ({}));
        showFeedbackError(data.error || 'Failed to toggle bot');
      }
    } catch (err) {
      showFeedbackError((err as Error).message);
    }
  };

  const handleDeleteBot = async (botId: string) => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`/api/autotrade/bots/${botId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        await fetchAutoTradeData();
      } else {
        const data = await res.json().catch(() => ({}));
        showFeedbackError(data.error || 'Failed to delete bot');
      }
    } catch (err) {
      showFeedbackError((err as Error).message);
    }
  };

  const handleCreateNewBot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBotName.trim()) return;
    const token = getAuthToken();
    if (!token) return;

    try {
      const res = await fetch('/api/autotrade/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: newBotName.trim(),
          enabled: true,
          mode: newBotMode,
          strategy: newBotStrategy,
          chain: newBotChain,
          maxTradeAmountNative: newBotAmount,
          maxOpenPositions: 3,
          slippagePercent: 5,
          takeProfitPercent: 35,
          stopLossPercent: 12,
          trailingStopPercent: 10,
          dailyMaxDrawdownPercent: 5,
          minLiquidityUsd: 15000,
        }),
      });

      if (res.ok) {
        setIsCreatingBot(false);
        setNewBotName('');
        await fetchAutoTradeData();
      } else {
        const data = await res.json().catch(() => ({}));
        showFeedbackError(data.error || 'Failed to create bot');
      }
    } catch (err) {
      showFeedbackError((err as Error).message);
    }
  };

  const handleClosePosition = async (positionId: string) => {
    const token = getAuthToken();
    if (!token) {
      showFeedbackError('Authentication required.');
      return;
    }
    setClosingId(positionId);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/autotrade/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ positionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await fetchAutoTradeData();
        if (onRefreshPortfolio) onRefreshPortfolio();
      } else {
        showFeedbackError(data.error || `Close position failed (HTTP ${res.status})`);
      }
    } catch (err) {
      console.error('Manual close failed:', err);
      showFeedbackError((err as Error).message);
    } finally {
      setClosingId(null);
    }
  };

  const handleResetCircuitBreaker = async () => {
    const token = getAuthToken();
    if (!token) {
      showFeedbackError('Authentication required.');
      return;
    }
    setErrorMessage(null);
    try {
      const res = await fetch('/api/autotrade/reset-circuit-breaker', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await fetchAutoTradeData();
      } else {
        showFeedbackError(data.error || `Reset failed (HTTP ${res.status})`);
      }
    } catch (err) {
      console.error('Failed to reset circuit breaker:', err);
      showFeedbackError((err as Error).message);
    }
  };

  const isPaper = config.mode === 'PAPER';
  const isArmed = config.enabled && !stats.circuitBreakerActive;
  const totalOpenPnlPercent = positions.length > 0
    ? positions.reduce((sum, p) => sum + (p.pnlPercent || 0), 0) / positions.length
    : 0;

  return (
    <div className="autotrade-container">
      {/* Error Feedback Banner */}
      {errorMessage && (
        <div className="circuit-breaker-banner" style={{ borderColor: '#f43f5e', background: 'rgba(244, 63, 94, 0.15)' }}>
          <div className="cb-alert-content">
            <AlertTriangle className="cb-icon text-rose" size={20} />
            <div>
              <strong className="text-rose">⚠️ AutoTrade Notice</strong>
              <p>{errorMessage}</p>
            </div>
          </div>
          <button type="button" className="cb-reset-btn" onClick={() => setErrorMessage(null)}>
            <span>Dismiss</span>
          </button>
        </div>
      )}

      {/* Circuit Breaker Alert Banner */}
      {stats.circuitBreakerActive && (
        <div className="circuit-breaker-banner">
          <div className="cb-alert-content">
            <AlertTriangle className="cb-icon" size={20} />
            <div>
              <strong>🛑 DRAWDOWN CIRCUIT BREAKER TRIPPED</strong>
              <p>Daily net drawdown exceeded {config.dailyMaxDrawdownPercent}%. Automated entries halted to protect capital.</p>
            </div>
          </div>
          <button type="button" className="cb-reset-btn" onClick={handleResetCircuitBreaker}>
            <RotateCcw size={14} />
            <span>Reset Breaker</span>
          </button>
        </div>
      )}

      {/* Header / Master Switch Bar */}
      <div className="autotrade-header-card">
        <div className="autotrade-title-group">
          <div className="engine-badge">
            <Zap size={18} className={isArmed ? 'pulse-neon' : ''} />
            <span>PREDIQUE QUANT ENSEMBLE</span>
          </div>
          <h2>Algorithmic Auto-Trading Engine</h2>
          <p className="academic-citation">
            Formulated via <strong>Fractional Kelly Sizing</strong> & <strong>Drawdown Modulation Lemma</strong> (arXiv:1710.01503 & 1507.01610)
          </p>
        </div>

        <div className="autotrade-master-controls">
          {/* Mode Switcher */}
          <div className="mode-toggle-pill">
            <button
              type="button"
              className={`pill-btn ${isPaper ? 'active-paper' : ''}`}
              onClick={() => handleUpdateConfig({ mode: 'PAPER' })}
            >
              🧪 PAPER VIRTUAL
            </button>
            <button
              type="button"
              className={`pill-btn ${!isPaper ? 'active-live' : ''}`}
              onClick={() => handleUpdateConfig({ mode: 'LIVE' })}
            >
              ⚡ LIVE ON-CHAIN
            </button>
          </div>

          {/* Master ON/OFF Button */}
          <button
            type="button"
            className={`master-power-btn ${config.enabled ? 'power-on' : 'power-off'}`}
            onClick={handleToggle}
          >
            {config.enabled ? <Pause size={18} /> : <Play size={18} />}
            <span>{config.enabled ? 'AUTOTRADE ACTIVE' : 'START AUTOTRADE'}</span>
          </button>
        </div>
      </div>

      {/* Quantitative Metrics Bar */}
      <div className="quant-metrics-grid">
        <div className="quant-stat-card">
          <div className="stat-card-label">
            <Activity size={14} />
            <span>WIN RATE</span>
          </div>
          <div className="stat-card-value text-emerald">
            {stats.winRate}%
          </div>
          <div className="stat-card-sub">
            {stats.winningTrades} Wins / {stats.losingTrades} Losses ({stats.totalTrades} total)
          </div>
        </div>

        <div className="quant-stat-card">
          <div className="stat-card-label">
            <TrendingUp size={14} />
            <span>REALIZED NET PNL</span>
          </div>
          <div className={`stat-card-value ${stats.totalPnlNative >= 0 ? 'text-emerald' : 'text-rose'}`}>
            {stats.totalPnlNative >= 0 ? '+' : ''}{stats.totalPnlNative} Native
          </div>
          <div className="stat-card-sub">
            Profit Factor: <strong>{stats.profitFactor.toFixed(2)}x</strong>
          </div>
        </div>

        <div className="quant-stat-card">
          <div className="stat-card-label">
            <span className="live-pnl-dot" style={{ background: totalOpenPnlPercent >= 0 ? '#10b981' : '#f43f5e', boxShadow: `0 0 8px ${totalOpenPnlPercent >= 0 ? '#10b981' : '#f43f5e'}` }} />
            <span>LIVE FLOATING PNL</span>
          </div>
          <div className={`stat-card-value ${totalOpenPnlPercent >= 0 ? 'text-emerald' : 'text-rose'}`}>
            {totalOpenPnlPercent >= 0 ? '+' : ''}{totalOpenPnlPercent.toFixed(1)}%
          </div>
          <div className="stat-card-sub">
            Across <strong>{positions.length}</strong> active position{positions.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="quant-stat-card">
          <div className="stat-card-label">
            <Shield size={14} />
            <span>CIRCUIT BREAKER</span>
          </div>
          <div className={`stat-card-value ${stats.circuitBreakerActive ? 'text-rose' : 'text-cyan'}`}>
            {stats.circuitBreakerActive ? 'TRIPPED' : 'ARMED'}
          </div>
          <div className="stat-card-sub">
            Current Drawdown: <strong>{stats.currentDailyDrawdownPercent}%</strong> (Max {config.dailyMaxDrawdownPercent}%)
          </div>
        </div>

        <div className="quant-stat-card">
          <div className="stat-card-label">
            <Sliders size={14} />
            <span>ACTIVE POSITIONS</span>
          </div>
          <div className="stat-card-value text-amber">
            {positions.length} / {config.maxOpenPositions}
          </div>
          <div className="stat-card-sub">
            Auto-Trailing: <strong>-{config.trailingStopPercent}% Peak</strong> | TP1: <strong>+{config.takeProfitPercent}%</strong>
          </div>
        </div>
      </div>

      {/* Multi-Bot Management Section */}
      <div className="autotrade-table-card" style={{ marginBottom: '20px' }}>
        <div className="table-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3>QUANT BOT INSTANCES ({bots.length})</h3>
            <span className="table-subtitle">Concurrent autonomous trading bots configured across chains</span>
          </div>
          <button
            type="button"
            className="save-settings-btn"
            style={{ width: 'auto', padding: '6px 14px', fontSize: '12px' }}
            onClick={() => setIsCreatingBot(true)}
          >
            <span>➕ Create New Bot</span>
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px', marginTop: '14px' }}>
          {bots.map((bot) => (
            <div
              key={bot.id}
              className={`quant-bot-card ${bot.enabled ? 'bot-card-active' : 'bot-card-paused'}`}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="live-pnl-dot" style={{ background: bot.enabled ? '#10b981' : '#64748b', boxShadow: bot.enabled ? '0 0 8px #10b981' : 'none' }} />
                    <strong style={{ color: '#fff', fontSize: '14px' }}>{bot.name}</strong>
                  </div>
                  <span className={`chain-badge ${bot.chain.toLowerCase()}`}>{bot.chain}</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                  <span className="strategy-chip" style={{ fontSize: '11px' }}>{bot.strategy}</span>
                  <span className={`pill-btn ${bot.mode === 'PAPER' ? 'active-paper' : 'active-live'}`} style={{ fontSize: '10px', padding: '2px 6px' }}>
                    {bot.mode}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: '1.6', fontFamily: 'var(--font-mono)' }}>
                  Size: <strong style={{ color: '#f8fafc' }}>{bot.maxTradeAmountNative} Native</strong> · Max: <strong style={{ color: '#f8fafc' }}>{bot.maxOpenPositions} pos</strong><br />
                  Target: <strong style={{ color: '#10b981' }}>+{bot.takeProfitPercent}% TP</strong> · SL: <strong style={{ color: '#f43f5e' }}>-{bot.stopLossPercent}%</strong>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '14px', borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: '12px' }}>
                <button
                  type="button"
                  className={`bot-toggle-switch ${bot.enabled ? 'bot-active' : 'bot-paused'}`}
                  style={{ flex: 1 }}
                  onClick={() => handleToggleBot(bot.id, bot.enabled)}
                >
                  <span className="bot-switch-thumb">
                    {bot.enabled ? <Pause size={13} /> : <Play size={13} />}
                  </span>
                  <span>{bot.enabled ? 'PAUSE BOT' : 'START BOT'}</span>
                </button>
                {bot.id !== 'bot_default' && (
                  <button
                    type="button"
                    className="bot-action-delete"
                    title="Delete Bot Instance"
                    onClick={() => handleDeleteBot(bot.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create Bot Modal */}
      {isCreatingBot && (
        <div className="terminal-modal-overlay">
          <div className="terminal-modal-dialog">
            <h3 style={{ margin: '0 0 16px 0', fontSize: '17px', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>🤖</span> CREATE NEW QUANT BOT
            </h3>
            <form onSubmit={handleCreateNewBot}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginBottom: '6px' }}>BOT NAME</label>
                <input
                  type="text"
                  placeholder="e.g. Solana Breakout Sniper"
                  value={newBotName}
                  onChange={(e) => setNewBotName(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '5px',
                    background: 'var(--bg-dark)',
                    border: '1px solid var(--border-subtle)',
                    color: '#fff',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginBottom: '6px' }}>CHAIN</label>
                  <select
                    value={newBotChain}
                    onChange={(e) => setNewBotChain(e.target.value as any)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '5px', background: 'var(--bg-dark)', border: '1px solid var(--border-subtle)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                  >
                    <option value="ALL">ALL CHAINS</option>
                    <option value="SOLANA">SOLANA</option>
                    <option value="BASE">BASE</option>
                    <option value="ETH">ETHEREUM</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginBottom: '6px' }}>MODE</label>
                  <select
                    value={newBotMode}
                    onChange={(e) => setNewBotMode(e.target.value as any)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '5px', background: 'var(--bg-dark)', border: '1px solid var(--border-subtle)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                  >
                    <option value="PAPER">🧪 PAPER</option>
                    <option value="LIVE">⚡ LIVE</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginBottom: '6px' }}>STRATEGY</label>
                <select
                  value={newBotStrategy}
                  onChange={(e) => setNewBotStrategy(e.target.value as any)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '5px', background: 'var(--bg-dark)', border: '1px solid var(--border-subtle)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                >
                  <option value="SWARM_MOMENTUM">🌊 CLUSTER OFI MOMENTUM</option>
                  <option value="MEAN_REVERSION">📈 MEAN-REVERSION DIP</option>
                  <option value="ENSEMBLE">👑 QUANT ENSEMBLE</option>
                  <option value="BREAKOUT_SURGE">🚀 BREAKOUT VOLATILITY SURGE</option>
                  <option value="SNIPER_ALPHA">🎯 SNIPER EARLY ALPHA</option>
                </select>
              </div>

              <div style={{ marginBottom: '18px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginBottom: '6px' }}>MAX TRADE SIZING (NATIVE)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="5"
                  value={newBotAmount}
                  onChange={(e) => setNewBotAmount(parseFloat(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '5px',
                    background: 'var(--bg-dark)',
                    border: '1px solid var(--border-subtle)',
                    color: '#fff',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  style={{ padding: '8px 16px', borderRadius: '5px', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                  onClick={() => setIsCreatingBot(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ padding: '8px 18px', borderRadius: '5px', background: 'var(--emerald-profit)', border: 'none', color: '#000', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                >
                  Create Bot Instance
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main Grid: Strategy Selector & Parameter Configuration */}
      <div className="autotrade-main-grid">
        {/* Left: Strategy Selector */}
        <div className="strategy-selector-section">
          <h3>QUANT STRATEGY SELECTION</h3>
          <div className="strategy-cards-list">
            <div
              className={`strategy-select-card ${config.strategy === 'SWARM_MOMENTUM' ? 'selected' : ''}`}
              onClick={() => handleUpdateConfig({ strategy: 'SWARM_MOMENTUM' })}
            >
              <div className="strategy-card-header">
                <span className="strategy-badge swarm">🌊 CLUSTER OFI MOMENTUM</span>
                <span className="strategy-win">High Alpha</span>
              </div>
              <p>
                Snipes high-frequency wallet accumulation clusters with positive order flow imbalance (OFI &gt; 0.65) and 0 early exits.
              </p>
              <div className="strategy-tags">
                <span>Platinum Tier 3★</span>
                <span>OFI &gt; 0.65</span>
                <span>15-75% Liq Ratio</span>
              </div>
            </div>

            <div
              className={`strategy-select-card ${config.strategy === 'MEAN_REVERSION' ? 'selected' : ''}`}
              onClick={() => handleUpdateConfig({ strategy: 'MEAN_REVERSION' })}
            >
              <div className="strategy-card-header">
                <span className="strategy-badge meanrev">📈 MEAN-REVERSION DIP</span>
                <span className="strategy-win">Low Drawdown</span>
              </div>
              <p>
                Identifies mature, highly liquid pools in temporary oversold panic pullbacks (Z-Score &le; -2.0) with statistical mean-reversion drift.
              </p>
              <div className="strategy-tags">
                <span>Age &ge; 60m</span>
                <span>Z-Score &le; -2.0</span>
                <span>24h Vol &ge; $25k</span>
              </div>
            </div>

            <div
              className={`strategy-select-card ${config.strategy === 'ENSEMBLE' ? 'selected' : ''}`}
              onClick={() => handleUpdateConfig({ strategy: 'ENSEMBLE' })}
            >
              <div className="strategy-card-header">
                <span className="strategy-badge ensemble">⚡ HYBRID QUANT ENSEMBLE</span>
                <span className="strategy-win">Maximum Sharpe</span>
              </div>
              <p>
                Runs Swarm OFI, Statistical Mean-Reversion, and Breakout models in parallel to diversify alpha across market conditions.
              </p>
              <div className="strategy-tags">
                <span>Multi-Model</span>
                <span>Dynamic Kelly</span>
                <span>Full Coverage</span>
              </div>
            </div>

            <div
              className={`strategy-select-card ${config.strategy === 'BREAKOUT_SURGE' ? 'selected' : ''}`}
              onClick={() => handleUpdateConfig({ strategy: 'BREAKOUT_SURGE' })}
            >
              <div className="strategy-card-header">
                <span className="strategy-badge breakout">🚀 BREAKOUT VOLATILITY SURGE</span>
                <span className="strategy-win">High Velocity</span>
              </div>
              <p>
                Snipes aggressive 5m volume spikes with extreme buy-side dominance (&ge;1.8x buy/sell ratio) and positive price momentum.
              </p>
              <div className="strategy-tags">
                <span>5m Buys &ge; 12</span>
                <span>Buys/Sells &ge; 1.8x</span>
                <span>Momentum Spike</span>
              </div>
            </div>

            <div
              className={`strategy-select-card ${config.strategy === 'SNIPER_ALPHA' ? 'selected' : ''}`}
              onClick={() => handleUpdateConfig({ strategy: 'SNIPER_ALPHA' })}
            >
              <div className="strategy-card-header">
                <span className="strategy-badge sniper">🎯 SNIPER EARLY ALPHA</span>
                <span className="strategy-win">Max Asymmetry</span>
              </div>
              <p>
                Snipes fresh token launches (age &le; 45m) with verified liquidity floors, zero seller dumping, and rapid early accumulation.
              </p>
              <div className="strategy-tags">
                <span>Age &le; 45m</span>
                <span>Zero Dump</span>
                <span>Floor Verified</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Risk & Money Management Settings */}
        <div className="risk-settings-section">
          <h3>RISK & MONEY MANAGEMENT (KELLY ENGINE)</h3>
          <form onSubmit={handleSaveConfig} className="risk-params-form">
            <div className="form-row-2">
              <div className="form-field">
                <label>Max Trade Amount (Native)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="10"
                  value={config.maxTradeAmountNative}
                  onChange={(e) => setConfig({ ...config, maxTradeAmountNative: parseFloat(e.target.value) || 0.1 })}
                />
                <span className="field-hint">Cap per trade (SOL / ETH)</span>
              </div>

              <div className="form-field">
                <label>Max Open Positions</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={config.maxOpenPositions}
                  onChange={(e) => setConfig({ ...config, maxOpenPositions: parseInt(e.target.value, 10) || 3 })}
                />
                <span className="field-hint">Concurrent position limit</span>
              </div>
            </div>

            <div className="form-row-2">
              <div className="form-field">
                <label>Take Profit 1 (TP1) %</label>
                <input
                  type="number"
                  min="5"
                  max="500"
                  value={config.takeProfitPercent}
                  onChange={(e) => setConfig({ ...config, takeProfitPercent: parseFloat(e.target.value) || 35 })}
                />
                <span className="field-hint">Trims 50% & moves stop to breakeven</span>
              </div>

              <div className="form-field">
                <label>Moonbag Trailing Stop %</label>
                <input
                  type="number"
                  min="3"
                  max="50"
                  value={config.trailingStopPercent}
                  onChange={(e) => setConfig({ ...config, trailingStopPercent: parseFloat(e.target.value) || 10 })}
                />
                <span className="field-hint">Trails dynamic peak price</span>
              </div>
            </div>

            <div className="form-row-2">
              <div className="form-field">
                <label>Hard Stop Loss %</label>
                <input
                  type="number"
                  min="3"
                  max="50"
                  value={config.stopLossPercent}
                  onChange={(e) => setConfig({ ...config, stopLossPercent: parseFloat(e.target.value) || 12 })}
                />
                <span className="field-hint">Maximum allowable loss</span>
              </div>

              <div className="form-field">
                <label>Daily Max Drawdown % (Circuit Breaker)</label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={config.dailyMaxDrawdownPercent}
                  onChange={(e) => setConfig({ ...config, dailyMaxDrawdownPercent: parseFloat(e.target.value) || 5 })}
                />
                <span className="field-hint">Locks all entries on hit</span>
              </div>
            </div>

            <div className="form-row-2">
              <div className="form-field">
                <label>Min Liquidity USD ($)</label>
                <input
                  type="number"
                  min="1000"
                  step="1000"
                  value={config.minLiquidityUsd}
                  onChange={(e) => setConfig({ ...config, minLiquidityUsd: parseFloat(e.target.value) || 15000 })}
                />
                <span className="field-hint">Minimum pool liquidity buffer</span>
              </div>

              <div className="form-field">
                <label>Max Slippage %</label>
                <input
                  type="number"
                  min="0.5"
                  max="50"
                  step="0.5"
                  value={config.slippagePercent}
                  onChange={(e) => setConfig({ ...config, slippagePercent: parseFloat(e.target.value) || 5 })}
                />
                <span className="field-hint">Execution slippage tolerance</span>
              </div>
            </div>

            <div className="form-action-row">
              <button type="submit" className="save-settings-btn" disabled={isSaving}>
                {saveSuccess ? <CheckCircle2 size={16} /> : <Sliders size={16} />}
                <span>{saveSuccess ? 'SETTINGS SAVED!' : isSaving ? 'SAVING...' : 'SAVE QUANT CONFIG'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Active Auto-Positions Table */}
      <div className="autotrade-table-card">
        <div className="table-card-header">
          <h3>ACTIVE AUTO-POSITIONS ({positions.length})</h3>
          <span className="table-subtitle">Dynamic Trailing Stop & Moonbag TP Active</span>
        </div>

        {positions.length === 0 ? (
          <div className="empty-autotrade-state">
            <div className="nav-tab-dot pulse" style={{ width: '12px', height: '12px', marginBottom: '4px' }} />
            <Shield size={32} className="text-dim" />
            <p style={{ color: '#cbd5e1', fontWeight: 600 }}>Autonomous Engine Standby</p>
            <span style={{ fontSize: '11px', color: '#64748b' }}>Scanning high-frequency Swarm OFI and volume accumulation signals in real-time...</span>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="autotrade-table">
              <thead>
                <tr>
                  <th>BOT</th>
                  <th>TOKEN</th>
                  <th>CHAIN</th>
                  <th>STRATEGY</th>
                  <th>SIZE</th>
                  <th>ENTRY PRICE</th>
                  <th>CURRENT PRICE</th>
                  <th>PNL (%)</th>
                  <th>TP1 STATUS</th>
                  <th>TRAILING STOP</th>
                  <th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  const isPositive = pos.pnlPercent >= 0;
                  const trailingPrice = (pos.highestPriceUsd || pos.entryPriceUsd || 1) * (1 - config.trailingStopPercent / 100);

                  return (
                    <tr key={pos.id}>
                      <td style={{ fontSize: '11px', color: '#94a3b8' }}>
                        {pos.botName || 'Default Bot'}
                      </td>
                      <td className="font-bold text-white">${pos.tokenSymbol}</td>
                      <td>
                        <span className={`chain-badge ${pos.chain.toLowerCase()}`}>{pos.chain}</span>
                      </td>
                      <td>
                        <span className="strategy-chip">{pos.strategy}</span>
                      </td>
                      <td>{pos.amountIn} {pos.chain.toLowerCase() === 'solana' ? 'SOL' : 'ETH'}</td>
                      <td>${pos.entryPriceUsd?.toFixed(6) || 'N/A'}</td>
                      <td>${pos.currentPriceUsd?.toFixed(6) || 'N/A'}</td>
                      <td>
                        <span className={`live-pnl-pill ${isPositive ? 'pnl-positive' : 'pnl-negative'}`}>
                          <span className="live-pnl-dot" />
                          {isPositive ? '+' : ''}{pos.pnlPercent}%
                        </span>
                      </td>
                      <td>
                        {pos.tp1Hit ? (
                          <span className="tp-badge hit">50% SECURED</span>
                        ) : (
                          <span className="tp-badge pending">PENDING (+35%)</span>
                        )}
                      </td>
                      <td>
                        <div className="trailing-gauge-container">
                          <div className="trailing-gauge-track">
                            <div
                              className="trailing-gauge-fill"
                              style={{
                                width: `${Math.min(100, Math.max(0, ((pos.pnlPercent + config.stopLossPercent) / (config.takeProfitPercent + config.stopLossPercent)) * 100))}%`
                              }}
                            />
                          </div>
                          <div className="trailing-gauge-labels">
                            <span className="text-rose">SL -{config.stopLossPercent}%</span>
                            <span className="text-amber font-mono font-bold">${trailingPrice.toFixed(4)}</span>
                            <span className="text-emerald">TP +{config.takeProfitPercent}%</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="action-exit-btn"
                          disabled={closingId === pos.id}
                          onClick={() => handleClosePosition(pos.id)}
                        >
                          {closingId === pos.id ? 'CLOSING...' : '⚡ EXIT'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Execution History Log */}
      <div className="autotrade-table-card">
        <div className="table-card-header">
          <h3>RECENT AUTOMATED EXECUTIONS</h3>
          <span className="table-subtitle">Verified on-chain & paper realized ledger</span>
        </div>

        {history.length === 0 ? (
          <div className="empty-autotrade-state">
            <Activity size={32} className="text-dim" />
            <p>No historical trades recorded in current session.</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="autotrade-table">
              <thead>
                <tr>
                  <th>TIME</th>
                  <th>TOKEN</th>
                  <th>STRATEGY</th>
                  <th>REASON</th>
                  <th>ENTRY</th>
                  <th>EXIT</th>
                  <th>REALIZED PNL</th>
                  <th>EXPLORER</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 8).map((h) => {
                  const isWin = h.pnlPercent >= 0;
                  const timeStr = new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  return (
                    <tr key={h.id}>
                      <td className="text-dim">{timeStr}</td>
                      <td className="font-bold">${h.tokenSymbol}</td>
                      <td><span className="strategy-chip">{h.strategy}</span></td>
                      <td>
                        <span className={`exit-reason-chip ${h.exitReason.toLowerCase()}`}>
                          {h.exitReason.replace('_', ' ')}
                        </span>
                      </td>
                      <td>${h.entryPriceUsd.toFixed(6)}</td>
                      <td>${h.exitPriceUsd.toFixed(6)}</td>
                      <td className={isWin ? 'text-emerald font-bold' : 'text-rose font-bold'}>
                        {isWin ? '+' : ''}{h.pnlPercent.toFixed(1)}% ({isWin ? '+' : ''}{h.pnlNative} Native)
                      </td>
                      <td>
                        <a
                          href={`https://dexscreener.com/${h.chain.toLowerCase()}/${h.tokenAddress}`}
                          target="_blank"
                          rel="noreferrer"
                          className="explorer-link"
                        >
                          <ExternalLink size={12} />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
