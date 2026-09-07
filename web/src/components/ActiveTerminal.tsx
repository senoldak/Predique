import React, { useState } from 'react';
import { Copy, Check, ExternalLink, Zap } from 'lucide-react';
import { SwarmSignal } from './SwarmRadar';

interface ActiveTerminalProps {
  signal: SwarmSignal | null;
  tradingMode: 'PAPER' | 'LIVE';
  onQuickBuy: (params: {
    tokenAddress: string;
    tokenSymbol: string;
    chain: string;
    amountIn: number;
    slippagePercent: number;
    enableMoonbagAutoTp: boolean;
    isPaper: boolean;
    entryPriceUsd?: number;
  }) => Promise<void>;
  isBuying: boolean;
}

export const ActiveTerminal: React.FC<ActiveTerminalProps> = ({
  signal,
  tradingMode,
  onQuickBuy,
  isBuying,
}) => {
  const [copied, setCopied] = useState(false);
  const [amount, setAmount] = useState<number>(0.1);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [slippage, setSlippage] = useState<number>(5);
  const [moonbag, setMoonbag] = useState<boolean>(true);

  if (!signal) {
    return (
      <div className="terminal-pane">
        <div className="pane-header">
          <span>TERMINAL</span>
        </div>
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
          Select a pair to execute orders
        </div>
      </div>
    );
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(signal.tokenAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePresetSelect = (val: number) => {
    setAmount(val);
    setCustomAmount('');
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomAmount(val);
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      setAmount(num);
    }
  };

  const handleBuy = async () => {
    await onQuickBuy({
      tokenAddress: signal.tokenAddress,
      tokenSymbol: signal.tokenSymbol,
      chain: signal.chain,
      amountIn: amount,
      slippagePercent: slippage,
      enableMoonbagAutoTp: moonbag,
      isPaper: tradingMode === 'PAPER',
      entryPriceUsd: signal.priceUsd,
    });
  };

  const nativeCurrency = signal.chain.toLowerCase() === 'solana' ? 'SOL' : 'ETH';
  const isPaper = tradingMode === 'PAPER';

  return (
    <div className="terminal-pane">
      <div className="pane-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Zap size={14} color={isPaper ? 'var(--amber-primary)' : 'var(--emerald-profit)'} />
          <span>
            {isPaper ? 'SIMULATED ORDER // $' : 'LIVE ORDER // $'}{signal.tokenSymbol}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <a
            href={
              signal.chain.toLowerCase() === 'solana'
                ? `https://photon-sol.tinyastro.io/en/lp/${signal.tokenAddress}`
                : `https://bullx.io/terminal?chainId=${signal.chain.toLowerCase() === 'base' ? 8453 : 1}&address=${signal.tokenAddress}`
            }
            target="_blank"
            rel="noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--amber-primary)', textDecoration: 'none', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}
          >
            <span>{signal.chain.toLowerCase() === 'solana' ? 'PHOTON' : 'BULLX'}</span>
            <ExternalLink size={12} />
          </a>
          <a
            href={`https://dexscreener.com/${signal.chain.toLowerCase()}/${signal.tokenAddress}`}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}
          >
            <span>DEXSCREENER</span>
            <ExternalLink size={12} />
          </a>
        </div>
      </div>


      <div className="pane-body">
        <div className="center-terminal-content">
          {/* Token Header Box */}
          <div className="token-hero-box">
            <div className="token-hero-top">
              <div>
                <div className="token-hero-title">${signal.tokenSymbol}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                  CHAIN: {signal.chain.toUpperCase()}
                </div>
              </div>
              <div>
                <div className="token-hero-price">
                  ${signal.priceUsd ? signal.priceUsd.toFixed(signal.priceUsd < 0.01 ? 6 : 4) : '0.00'}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                  24H: {signal.priceChange24h ? (signal.priceChange24h >= 0 ? `+${signal.priceChange24h.toFixed(1)}%` : `${signal.priceChange24h.toFixed(1)}%`) : '0.0%'}
                </div>
              </div>
            </div>

            <div className="contract-address-bar">
              <span className="address-text">{signal.tokenAddress}</span>
              <button className="copy-button" onClick={handleCopy} title="Copy Address">
                {copied ? <Check size={13} color="var(--emerald-profit)" /> : <Copy size={13} />}
              </button>
            </div>

            <div className="metrics-row">
              <div className="metric-card">
                <div className="metric-label">Market Cap</div>
                <div className="metric-value">${signal.mcap.toLocaleString()}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Liquidity</div>
                <div className="metric-value">${signal.liquidity.toLocaleString()}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Liq Ratio</div>
                <div className="metric-value">{signal.liqRatio}%</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">24h Vol</div>
                <div className="metric-value">${signal.volume24h ? signal.volume24h.toLocaleString() : '0'}</div>
              </div>
            </div>
          </div>

          {/* Smart Money Swarm Cluster Intelligence */}
          {signal.topWallets && signal.topWallets.length > 0 && (
            <div className="rationale-box" style={{ borderColor: 'rgba(245, 158, 11, 0.3)' }}>
              <div className="rationale-header" style={{ color: 'var(--amber-primary)', display: 'flex', justifyContent: 'space-between' }}>
                <span>🎯 VERIFIED ALPHA ACCUMULATION // SWARM CLUSTER</span>
                {signal.buys5m !== undefined && (
                  <span style={{ fontSize: '0.68rem', color: 'var(--emerald-profit)' }}>
                    FLOW: {signal.buys5m} BUYS / {signal.sells5m ?? 0} SELLS (5M)
                  </span>
                )}
              </div>
              <div className="reasons-list">
                {signal.topWallets.map((w, idx) => (
                  <div key={idx} className="reason-item" style={{ background: 'rgba(15, 23, 42, 0.6)' }}>
                    <div className="reason-item-top">
                      <span style={{ color: 'var(--amber-primary)' }}>★</span>
                      <span style={{ color: 'var(--text-primary)' }}>{w.label}</span>
                    </div>
                    <div className="reason-val" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--emerald-profit)' }}>Win: {w.winRate}%</span>
                      <span>Vol: ${(w.volume / 1000).toFixed(1)}k</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Predique Selection Rationale Box */}
          {signal.reasons && signal.reasons.length > 0 && (
            <div className="rationale-box">
              <div className="rationale-header">
                <span>PREDIQUE SELECTION RATIONALE // EVALUATION METRICS</span>
              </div>
              <div className="reasons-list">
                {signal.reasons.map((r) => {
                  const iconColor =
                    r.status === 'POSITIVE'
                      ? 'var(--emerald-profit)'
                      : r.status === 'WARNING'
                      ? 'var(--rose-loss)'
                      : 'var(--amber-primary)';
                  return (
                    <div key={r.code} className="reason-item">
                      <div className="reason-item-top">
                        <span style={{ color: iconColor }}>
                          {r.status === 'POSITIVE' ? '✓' : r.status === 'WARNING' ? '⚠' : 'ℹ'}
                        </span>
                        <span style={{ color: 'var(--text-primary)' }}>{r.label}</span>
                      </div>
                      <div className="reason-val">{r.value}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick-Buy Terminal Form */}
          <div className="trade-box">
            <label className="trade-field-label">
              {isPaper ? 'Simulated Order Size' : 'Live Order Size'} ({nativeCurrency})
            </label>
            <div className="preset-pills">
              {[0.05, 0.1, 0.25, 0.5].map((val) => (
                <button
                  key={val}
                  type="button"
                  className={`preset-pill ${amount === val && !customAmount ? 'active' : ''}`}
                  onClick={() => handlePresetSelect(val)}
                >
                  {val} {nativeCurrency}
                </button>
              ))}
            </div>

            <div className="custom-input-row">
              <input
                type="number"
                step="any"
                className="terminal-input"
                placeholder={`Custom amount in ${nativeCurrency}...`}
                value={customAmount}
                onChange={handleCustomChange}
              />
            </div>

            <div className="slippage-row">
              <span style={{ color: 'var(--text-secondary)' }}>Slippage Tolerance</span>
              <div className="pill-group">
                {[1, 3, 5, 12].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`pill-btn ${slippage === s ? 'active' : ''}`}
                    onClick={() => setSlippage(s)}
                  >
                    {s}%
                  </button>
                ))}
              </div>
            </div>

            {/* Live Price Impact Guard Metric */}
            {(() => {
              const nativePrice = signal.chain.toLowerCase() === 'solana' ? 180 : (signal.chain.toLowerCase() === 'bnb' ? 600 : 3200);
              const orderValueUsd = amount * nativePrice;
              const poolLiq = signal.liquidity || 50000;
              const estImpact = parseFloat(((orderValueUsd / poolLiq) * 100).toFixed(2));
              const isHighImpact = estImpact >= 5.0;
              const isCritical = estImpact >= 15.0;

              return (
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: isCritical ? 'rgba(244, 63, 94, 0.15)' : (isHighImpact ? 'rgba(245, 158, 11, 0.15)' : 'var(--bg-input)'),
                  border: `1px solid ${isCritical ? 'var(--rose-loss)' : (isHighImpact ? 'var(--amber-primary)' : 'var(--border-subtle)')}`,
                  borderRadius: '4px',
                  padding: '6px 10px',
                  margin: '10px 0',
                  fontSize: '0.74rem',
                  fontFamily: 'var(--font-mono)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: isCritical ? 'var(--rose-loss)' : (isHighImpact ? 'var(--amber-primary)' : 'var(--emerald-profit)') }}>
                      {isCritical ? '🚨' : (isHighImpact ? '⚠️' : '🛡️')}
                    </span>
                    <span style={{ color: 'var(--text-secondary)' }}>Price Impact Guard:</span>
                  </div>
                  <div style={{ fontWeight: 600, color: isCritical ? 'var(--rose-loss)' : (isHighImpact ? 'var(--amber-primary)' : 'var(--emerald-profit)') }}>
                    ~{estImpact}% {isCritical ? '(CRITICAL SLIPPAGE)' : (isHighImpact ? '(HIGH SLIPPAGE)' : '(OPTIMAL)')}
                  </div>
                </div>
              );
            })()}

            <div className="moonbag-row">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Take-Profit Protection</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  Auto-sell 50% principal on +100% (2X) gain
                </span>
              </div>
              <input
                type="checkbox"
                checked={moonbag}
                onChange={(e) => setMoonbag(e.target.checked)}
                style={{ cursor: 'pointer', accentColor: 'var(--amber-primary)' }}
              />
            </div>

            <button
              className="execute-buy-btn"
              onClick={handleBuy}
              disabled={isBuying || amount <= 0}
              style={{
                background: isPaper ? 'var(--amber-primary)' : 'var(--emerald-profit)',
              }}
            >
              <Zap size={16} fill="currentColor" />
              <span>
                {isBuying
                  ? 'EXECUTING...'
                  : `${isPaper ? 'PAPER BUY' : 'LIVE BUY'} ${amount} ${nativeCurrency}`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
