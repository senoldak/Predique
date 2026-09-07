import React, { useState } from 'react';
import { Activity } from 'lucide-react';

export interface SignalReason {
  code: string;
  label: string;
  status: 'POSITIVE' | 'WARNING' | 'NEUTRAL';
  value: string;
}

export interface SwarmSignal {
  id: string;
  tokenAddress: string;
  tokenSymbol: string;
  chain: string;
  mcap: number;
  liquidity: number;
  liqRatio: number;
  rating: string;
  earlySelling: boolean;
  pileInTime: string;
  ageMinutes: number;
  smartWalletsCount: number;
  timestamp: number;
  volume24h?: number;
  priceUsd?: number;
  priceChange24h?: number;
  reasons?: SignalReason[];
  buys5m?: number;
  sells5m?: number;
  topWallets?: Array<{ label: string; winRate: number; volume: number }>;
}

interface SwarmRadarProps {
  signals: SwarmSignal[];
  selectedSignal: SwarmSignal | null;
  onSelect: (signal: SwarmSignal) => void;
}

export const SwarmRadar: React.FC<SwarmRadarProps> = ({
  signals,
  selectedSignal,
  onSelect,
}) => {
  const [filter, setFilter] = useState<'ALL' | 'SOLANA' | 'BASE' | 'BNB'>('ALL');

  const filteredSignals = signals.filter((s) => {
    if (filter === 'ALL') return true;
    return s.chain.toUpperCase() === filter;
  });

  return (
    <div className="terminal-pane">
      <div className="pane-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity size={14} color="var(--amber-primary)" />
          <span>SIGNALS</span>
        </div>
        <div style={{ display: 'flex', gap: '4px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
          {(['ALL', 'SOLANA', 'BASE'] as const).map((chain) => (
            <button
              key={chain}
              onClick={() => setFilter(chain)}
              style={{
                background: filter === chain ? 'var(--border-medium)' : 'transparent',
                color: filter === chain ? 'var(--text-primary)' : 'var(--text-dim)',
                border: 'none',
                padding: '2px 6px',
                borderRadius: '2px',
                cursor: 'pointer',
              }}
            >
              {chain}
            </button>
          ))}
        </div>
      </div>

      <div className="pane-body">
        {filteredSignals.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
            Listening for live signals...
          </div>
        ) : (
          filteredSignals.map((sig) => {
            const isSelected = selectedSignal?.id === sig.id;
            const chainUpper = sig.chain.toUpperCase();
            const chainClass = chainUpper === 'SOLANA' ? 'chain-sol' : 'chain-base';
            const change = sig.priceChange24h ?? 0;
            const isPositive = change >= 0;

            const primaryReason = sig.reasons?.[0]?.label || sig.pileInTime;

            return (
              <div
                key={sig.id}
                className={`token-card ${isSelected ? 'active' : ''}`}
                onClick={() => onSelect(sig)}
              >
                <div className="token-header-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className="token-symbol">${sig.tokenSymbol}</span>
                    <span className={`chain-badge ${chainClass}`}>{sig.chain}</span>
                  </div>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: isPositive ? 'var(--emerald-profit)' : 'var(--rose-loss)',
                    }}
                  >
                    {isPositive ? '+' : ''}{change.toFixed(1)}%
                  </span>
                </div>

                <div style={{ fontSize: '0.68rem', color: 'var(--amber-primary)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                  ⚡ {primaryReason}
                </div>

                <div className="token-stats-grid">
                  <div>
                    MCAP: <span className="token-stat-val">${(sig.mcap / 1000).toFixed(1)}k</span>
                  </div>
                  <div>
                    LIQ: <span className="token-stat-val">${(sig.liquidity / 1000).toFixed(1)}k</span>
                  </div>
                  <div>
                    RATIO: <span className="token-stat-val">{sig.liqRatio}%</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
