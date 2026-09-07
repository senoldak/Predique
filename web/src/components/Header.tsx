import React from 'react';
import { Settings, Activity, Zap } from 'lucide-react';

export type TradingMode = 'PAPER' | 'LIVE';
export type ActiveTab = 'terminal' | 'autotrade';

interface HeaderProps {
  wsConnected: boolean;
  tradingMode: TradingMode;
  onToggleMode: (mode: TradingMode) => void;
  botStatus?: 'ONLINE' | 'OFFLINE' | 'ERROR';
  botUsername?: string;
  onOpenSettings?: () => void;
  activeTab?: ActiveTab;
  onTabChange?: (tab: ActiveTab) => void;
  autoTradeActive?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  wsConnected,
  tradingMode,
  onToggleMode,
  botStatus = 'OFFLINE',
  botUsername,
  onOpenSettings,
  activeTab = 'terminal',
  onTabChange,
  autoTradeActive = false,
}) => {
  const isBotOnline = botStatus === 'ONLINE';

  return (
    <header className="terminal-header">
      <div className="brand-section">
        <div className="brand-mark">
          <span className="brand-glyph">♞</span>
        </div>
        <div className="brand-titles">
          <span className="brand-title">PREDIQUE</span>
          <span className="brand-subtitle">TERMINAL</span>
        </div>

        {/* View Switcher Tabs */}
        {onTabChange && (
          <div className="header-nav-tabs">
            <button
              type="button"
              className={`nav-tab-btn ${activeTab === 'terminal' ? 'active' : ''}`}
              onClick={() => onTabChange('terminal')}
            >
              <Activity size={13} />
              <span>RADAR & TERMINAL</span>
            </button>
            <button
              type="button"
              className={`nav-tab-btn ${activeTab === 'autotrade' ? 'active' : ''}`}
              onClick={() => onTabChange('autotrade')}
            >
              <Zap size={13} />
              <span>QUANT AUTO-TRADING</span>
              <span className={`nav-tab-dot ${autoTradeActive ? 'pulse' : ''}`} />
            </button>
          </div>
        )}
      </div>

      <div className="status-indicators">
        {/* Trading Mode Switcher */}
        <div className="mode-toggle-group">
          <button
            type="button"
            className={`mode-btn ${tradingMode === 'PAPER' ? 'active-paper' : ''}`}
            onClick={() => onToggleMode('PAPER')}
          >
            ● PAPER
          </button>
          <button
            type="button"
            className={`mode-btn ${tradingMode === 'LIVE' ? 'active-live' : ''}`}
            onClick={() => onToggleMode('LIVE')}
          >
            ● LIVE
          </button>
        </div>

        {/* Telegram Bot Status Beacon */}
        <div
          className="bot-beacon"
          title={isBotOnline ? `Bot @${botUsername} is listening` : 'Bot inactive - click Settings to connect'}
        >
          <span
            className="beacon-dot"
            style={{
              background: isBotOnline ? 'var(--emerald-profit)' : 'var(--text-dim)',
            }}
          />
          <span style={{ color: isBotOnline ? 'var(--emerald-profit)' : 'var(--text-dim)', fontWeight: 600 }}>
            {isBotOnline ? `TG BOT: @${botUsername || 'ONLINE'}` : 'TG BOT: OFFLINE'}
          </span>
        </div>

        {/* WebSocket Stream Beacon */}
        <div className="live-beacon">
          <span
            className="beacon-dot"
            style={{
              background: wsConnected ? 'var(--emerald-profit)' : 'var(--rose-loss)',
            }}
          />
          <span className={wsConnected ? 'live-badge' : 'offline-badge'}>
            {wsConnected ? 'STREAM ACTIVE' : 'DISCONNECTED'}
          </span>
        </div>

        {/* Settings Button */}
        {onOpenSettings && (
          <button
            type="button"
            className="header-settings-btn"
            onClick={onOpenSettings}
            title="Configure Bot & Terminal Settings"
          >
            <Settings size={13} />
            <span>SETTINGS</span>
          </button>
        )}
      </div>
    </header>
  );
};
