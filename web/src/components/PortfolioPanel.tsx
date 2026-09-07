import { Wallet, RefreshCw, History, Layers, ExternalLink, Crosshair, Download, ShieldCheck, ArrowDownToLine, Check, X } from 'lucide-react';

export interface WalletBalance {
  address: string;
  chain: 'EVM' | 'SOLANA';
  balance: number;
}

export interface VaultBalances {
  evm: number;
  solana: number;
}

export interface PositionItem {
  id: string;
  tokenSymbol: string;
  chain: string;
  amountIn: number;
  entryMcap: number;
  currentMcap: number;
  entryPriceUsd?: number;
  currentPriceUsd?: number;
  pnlPercent: number;
  moonbagActive: boolean;
  isPaper?: boolean;
}

export interface ClosedTradeItem {
  id: string;
  positionId: string;
  tokenAddress: string;
  tokenSymbol: string;
  chain: string;
  amountIn: number;
  entryPriceUsd?: number;
  exitPriceUsd?: number;
  entryMcap: number;
  exitMcap: number;
  pnlPercent: number;
  percentageSold: number;
  openTimestamp: number;
  closeTimestamp: number;
  holdDurationSeconds: number;
  txHash: string;
  isPaper: boolean;
}

export interface TradeHistorySummary {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalRealizedPnlPercent: number;
}

export interface SmartWalletItem {
  address: string;
  chain: 'SOLANA' | 'EVM';
  label: string;
  tag: 'ALPHA_SNIPER' | 'WHALE' | 'KOL' | 'INSIDER';
  winRate30d: number;
  totalPnlUsd: number;
}

interface PortfolioPanelProps {
  wallets: WalletBalance[];
  vaultBalances?: VaultBalances;
  positions: PositionItem[];
  history?: ClosedTradeItem[];
  historySummary?: TradeHistorySummary;
  smartWallets?: SmartWalletItem[];
  tradingMode: 'PAPER' | 'LIVE';
  onSell: (positionId: string, percentage: number) => Promise<void>;
  onResetPaperBalance: () => Promise<void>;
  onSweep?: (params: { chain: 'EVM' | 'SOLANA'; vaultAddress: string; reserveAmount?: number; sweepAmount?: number }) => Promise<{ success: boolean; message: string }>;
}

export const PortfolioPanel: React.FC<PortfolioPanelProps> = ({
  wallets,
  vaultBalances = { evm: 0, solana: 0 },
  positions,
  history = [],
  historySummary,
  smartWallets = [],
  tradingMode,
  onSell,
  onResetPaperBalance,
  onSweep,
}) => {
  const [activeTab, setActiveTab] = useState<'positions' | 'history' | 'alpha'>('positions');
  const [showSweepModal, setShowSweepModal] = useState<boolean>(false);
  const [sweepChain, setSweepChain] = useState<'EVM' | 'SOLANA'>('EVM');
  const [vaultAddressInput, setVaultAddressInput] = useState<string>('');
  const [reserveInput, setReserveInput] = useState<string>('0.2');
  const [isSweeping, setIsSweeping] = useState<boolean>(false);
  const [sweepFeedback, setSweepFeedback] = useState<string | null>(null);

  const isPaper = tradingMode === 'PAPER';

  const handleExecuteSweep = async () => {
    if (!onSweep) return;
    if (!vaultAddressInput.trim()) {
      setSweepFeedback('Please enter a destination vault address.');
      return;
    }
    setIsSweeping(true);
    setSweepFeedback(null);
    try {
      const res = await onSweep({
        chain: sweepChain,
        vaultAddress: vaultAddressInput.trim(),
        reserveAmount: parseFloat(reserveInput) || 0,
      });
      setSweepFeedback(res.message);
      if (res.success) {
        setTimeout(() => setShowSweepModal(false), 1500);
      }
    } catch (err: unknown) {
      setSweepFeedback((err as Error).message);
    } finally {
      setIsSweeping(false);
    }
  };

  return (
    <div className="terminal-pane">
      <div className="pane-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Wallet size={14} color={isPaper ? 'var(--amber-primary)' : 'var(--cyan-evm)'} />
          <span>{isPaper ? 'PAPER VAULT & POSITIONS' : 'LIVE VAULT & POSITIONS'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {onSweep && (
            <button
              type="button"
              className="reset-paper-btn"
              style={{ borderColor: 'var(--emerald-profit)', color: 'var(--emerald-profit)' }}
              onClick={() => setShowSweepModal(true)}
              title="Sweep excess trading profit into cold vault"
            >
              <ArrowDownToLine size={11} />
              <span>SWEEP</span>
            </button>
          )}
          {isPaper && (
            <button
              type="button"
              className="reset-paper-btn"
              onClick={onResetPaperBalance}
              title="Reset to default 10 SOL & 1.5 ETH"
            >
              <RefreshCw size={11} />
              <span>RESET</span>
            </button>
          )}
        </div>
      </div>

      <div className="pane-body">
        {/* Wallets */}
        <div style={{ marginBottom: '14px' }}>
          <div className="section-subtitle" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{isPaper ? 'SIMULATED BALANCES' : 'ON-CHAIN BALANCES'}</span>
            <span style={{ color: isPaper ? 'var(--amber-primary)' : 'var(--cyan-evm)' }}>
              {isPaper ? '100% RISK-FREE' : 'MAINNET RPC'}
            </span>
          </div>
          {wallets.length === 0 ? (
            <div style={{ padding: '8px 0', color: 'var(--text-dim)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
              Loading addresses...
            </div>
          ) : (
            wallets.map((w) => (
              <div key={w.address} className="wallet-card">
                <div className="wallet-card-top">
                  <span style={{ color: w.chain === 'EVM' ? 'var(--cyan-evm)' : 'var(--purple-sol)', fontWeight: 700 }}>
                    {w.chain}
                  </span>
                  <span style={{ color: 'var(--emerald-profit)', fontWeight: 700 }}>
                    {w.balance.toFixed(4)} {w.chain === 'EVM' ? 'ETH' : 'SOL'}
                  </span>
                </div>
                <div style={{ color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {w.address}
                </div>
              </div>
            ))
          )}

          {/* Secure Cold Vault Balances */}
          <div style={{
            marginTop: '8px',
            padding: '8px 10px',
            background: 'rgba(16, 185, 129, 0.05)',
            border: '1px solid rgba(16, 185, 129, 0.2)',
            borderRadius: '4px',
            fontSize: '0.75rem',
            fontFamily: 'var(--font-mono)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--emerald-profit)', fontWeight: 600 }}>
                <ShieldCheck size={12} />
                SECURED HARVEST VAULT
              </span>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}>COLD STORAGE</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-primary)' }}>
              <span>EVM: <b style={{ color: 'var(--cyan-evm)' }}>{vaultBalances.evm.toFixed(4)} ETH</b></span>
              <span>Solana: <b style={{ color: 'var(--purple-sol)' }}>{vaultBalances.solana.toFixed(4)} SOL</b></span>
            </div>
          </div>
        </div>

        {/* Sweep Modal */}
        {showSweepModal && (
          <div style={{
            padding: '12px',
            marginBottom: '14px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-medium)',
            borderRadius: '6px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontWeight: 700, color: 'var(--emerald-profit)' }}>🧹 HARVEST REBALANCE TO VAULT</span>
              <button
                type="button"
                onClick={() => setShowSweepModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}
              >
                <X size={13} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <button
                type="button"
                onClick={() => setSweepChain('EVM')}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  background: sweepChain === 'EVM' ? 'var(--cyan-soft)' : 'var(--bg-input)',
                  border: `1px solid ${sweepChain === 'EVM' ? 'var(--cyan-evm)' : 'var(--border-subtle)'}`,
                  color: sweepChain === 'EVM' ? 'var(--cyan-evm)' : 'var(--text-dim)',
                  cursor: 'pointer',
                  borderRadius: '3px',
                  fontWeight: 600
                }}
              >
                EVM
              </button>
              <button
                type="button"
                onClick={() => setSweepChain('SOLANA')}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  background: sweepChain === 'SOLANA' ? 'var(--purple-soft)' : 'var(--bg-input)',
                  border: `1px solid ${sweepChain === 'SOLANA' ? 'var(--purple-sol)' : 'var(--border-subtle)'}`,
                  color: sweepChain === 'SOLANA' ? 'var(--purple-sol)' : 'var(--text-dim)',
                  cursor: 'pointer',
                  borderRadius: '3px',
                  fontWeight: 600
                }}
              >
                SOLANA
              </button>
            </div>
            <div style={{ marginBottom: '6px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.68rem', marginBottom: '2px' }}>
                DESTINATION VAULT ADDRESS:
              </label>
              <input
                type="text"
                value={vaultAddressInput}
                onChange={(e) => setVaultAddressInput(e.target.value)}
                placeholder={sweepChain === 'EVM' ? '0x...' : 'Base58...'}
                style={{
                  width: '100%',
                  padding: '5px 8px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '3px',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.72rem'
                }}
              />
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.68rem', marginBottom: '2px' }}>
                RESERVE TO KEEP IN TRADING WALLET:
              </label>
              <input
                type="number"
                step="0.05"
                value={reserveInput}
                onChange={(e) => setReserveInput(e.target.value)}
                style={{
                  width: '100%',
                  padding: '5px 8px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '3px',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.72rem'
                }}
              />
            </div>
            {sweepFeedback && (
              <div style={{
                marginBottom: '8px',
                color: sweepFeedback.includes('SUCCESS') ? 'var(--emerald-profit)' : 'var(--rose-loss)',
                fontSize: '0.7rem'
              }}>
                {sweepFeedback}
              </div>
            )}
            <button
              type="button"
              onClick={handleExecuteSweep}
              disabled={isSweeping}
              style={{
                width: '100%',
                padding: '6px',
                background: 'var(--emerald-profit)',
                color: '#000',
                border: 'none',
                borderRadius: '3px',
                fontWeight: 700,
                cursor: isSweeping ? 'wait' : 'pointer'
              }}
            >
              {isSweeping ? 'EXECUTING SWEEP...' : `SWEEP SURPLUS ${sweepChain === 'EVM' ? 'ETH' : 'SOL'}`}
            </button>
          </div>
        )}

        {/* Navigation Tabs between Active Positions and History */}
        <div className="portfolio-tab-group">
          <button
            type="button"
            className={`portfolio-tab-btn ${activeTab === 'positions' ? 'active' : ''}`}
            onClick={() => setActiveTab('positions')}
          >
            <Layers size={12} />
            <span>ACTIVE ({positions.length})</span>
          </button>
          <button
            type="button"
            className={`portfolio-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <History size={12} />
            <span>HISTORY ({history.length})</span>
          </button>
          <button
            type="button"
            className={`portfolio-tab-btn ${activeTab === 'alpha' ? 'active' : ''}`}
            onClick={() => setActiveTab('alpha')}
          >
            <Crosshair size={12} />
            <span>ALPHA ({smartWallets.length})</span>
          </button>
        </div>

        {activeTab === 'positions' ? (
          <div>
            <div className="section-subtitle" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{isPaper ? 'PAPER POSITIONS' : 'LIVE POSITIONS'}</span>
              <span>{positions.length} OPEN</span>
            </div>

            {positions.length === 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                No active {isPaper ? 'paper' : 'live'} positions. Execute an order to start.
              </div>
            ) : (
              positions.map((pos) => {
                const isProfit = (pos.pnlPercent ?? 0) >= 0;
                const pnlText = pos.pnlPercent !== undefined
                  ? `${isProfit ? '+' : ''}${pos.pnlPercent.toFixed(1)}%`
                  : '0.0%';

                return (
                  <div key={pos.id} className="position-card">
                    <div className="position-card-top">
                      <div>
                        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                          ${pos.tokenSymbol}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginLeft: '6px', fontFamily: 'var(--font-mono)' }}>
                          ({pos.chain})
                        </span>
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', fontWeight: 700, color: isProfit ? 'var(--emerald-profit)' : 'var(--rose-loss)' }}>
                        {pnlText}
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '4px' }}>
                      <span>IN: {pos.amountIn} {pos.chain.toLowerCase() === 'solana' ? 'SOL' : 'ETH'}</span>
                      <span>MCAP: ${(pos.currentMcap / 1000).toFixed(0)}k</span>
                    </div>

                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                      <button
                        type="button"
                        className="quick-sell-btn"
                        onClick={() => onSell(pos.id, 50)}
                      >
                        TP 50%
                      </button>
                      <button
                        type="button"
                        className="quick-sell-btn full"
                        onClick={() => onSell(pos.id, 100)}
                      >
                        CLOSE 100%
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : activeTab === 'history' ? (
          <div>
            <div className="section-subtitle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>REALIZED PERFORMANCE ({history.length})</span>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={async () => {
                    const token = localStorage.getItem('predique_jwt');
                    if (!token) return;
                    try {
                      const res = await fetch(`/api/trade/history/export?mode=${isPaper ? 'paper' : 'live'}&format=csv`, {
                        headers: { Authorization: `Bearer ${token}` },
                      });
                      if (res.ok) {
                        const blob = await res.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `predique_trades_${isPaper ? 'paper' : 'live'}.csv`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                      }
                    } catch (e) {
                      console.error('CSV export failed:', e);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: 'transparent',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--amber-primary)',
                    borderRadius: '3px',
                    padding: '2px 6px',
                    fontSize: '0.65rem',
                    fontFamily: 'var(--font-mono)',
                    cursor: 'pointer',
                  }}
                  title="Export trade history to CSV (Tax & Analytics Report)"
                >
                  <Download size={10} />
                  <span>EXPORT CSV</span>
                </button>
              )}
            </div>

            {historySummary && history.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '6px',
                  marginBottom: '10px',
                  padding: '8px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>WIN RATE</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: historySummary.winRate >= 50 ? 'var(--emerald-profit)' : 'var(--rose-loss)' }}>
                    {historySummary.winRate}%
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>RECORD</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {historySummary.winningTrades}W / {historySummary.losingTrades}L
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>REALIZED</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: historySummary.totalRealizedPnlPercent >= 0 ? 'var(--emerald-profit)' : 'var(--rose-loss)' }}>
                    {historySummary.totalRealizedPnlPercent >= 0 ? '+' : ''}{historySummary.totalRealizedPnlPercent.toFixed(1)}%
                  </div>
                </div>
              </div>
            )}

            {history.length === 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                No closed trades yet in this session.
              </div>
            ) : (
              history.map((t) => {
                const isProfit = t.pnlPercent >= 0;
                return (
                  <div key={t.id} className="history-card">
                    <div className="history-card-top">
                      <div>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                          ${t.tokenSymbol}
                        </span>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginLeft: '6px' }}>
                          ({t.chain})
                        </span>
                      </div>
                      <span
                        style={{
                          fontWeight: 700,
                          color: isProfit ? 'var(--emerald-profit)' : 'var(--rose-loss)',
                        }}
                      >
                        {isProfit ? '+' : ''}{t.pnlPercent.toFixed(1)}%
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: '4px' }}>
                      <span>SIZE: {t.amountIn} {t.chain.toLowerCase() === 'solana' ? 'SOL' : 'ETH'}</span>
                      <span>DURATION: {t.holdDurationSeconds}s</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-dim)', fontSize: '0.68rem', marginTop: '4px' }}>
                      <span>SOLD: {t.percentageSold}%</span>
                      {t.txHash && !t.txHash.startsWith('sim_') && (
                        <a
                          href={t.chain === 'SOLANA' ? `https://solscan.io/tx/${t.txHash}` : `https://basescan.org/tx/${t.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--cyan-accent)', textDecoration: 'none' }}
                        >
                          <span>TX</span>
                          <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div>
            <div className="section-subtitle" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>ON-CHAIN SMART MONEY</span>
              <span>{smartWallets.length} TRACKED</span>
            </div>

            {smartWallets.length === 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                Loading smart money registry...
              </div>
            ) : (
              smartWallets.map((w) => (
                <div key={w.address} className="history-card" style={{ borderLeft: w.chain === 'SOLANA' ? '2px solid var(--purple-sol)' : '2px solid var(--cyan-evm)' }}>
                  <div className="history-card-top">
                    <div>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                        {w.label}
                      </span>
                      <span style={{ fontSize: '0.68rem', color: 'var(--amber-primary)', marginLeft: '6px', fontFamily: 'var(--font-mono)' }}>
                        [{w.tag}]
                      </span>
                    </div>
                    <span style={{ fontWeight: 700, color: 'var(--emerald-profit)', fontFamily: 'var(--font-mono)' }}>
                      {w.winRate30d}% WR
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
                    <span>REALIZED PNL: +${(w.totalPnlUsd / 1000).toFixed(0)}k</span>
                    <span style={{ color: w.chain === 'SOLANA' ? 'var(--purple-sol)' : 'var(--cyan-evm)' }}>{w.chain}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-dim)', fontSize: '0.68rem', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
                    <span title={w.address}>{w.address.slice(0, 8)}...{w.address.slice(-6)}</span>
                    <a
                      href={w.chain === 'SOLANA' ? `https://solscan.io/account/${w.address}` : `https://basescan.org/address/${w.address}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--cyan-accent)', textDecoration: 'none' }}
                    >
                      <span>EXPLORER</span>
                      <ExternalLink size={10} />
                    </a>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
