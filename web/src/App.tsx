import React, { useState, useEffect, useCallback } from 'react';
import { Header, TradingMode, ActiveTab } from './components/Header';
import { SwarmRadar, SwarmSignal } from './components/SwarmRadar';
import { ActiveTerminal } from './components/ActiveTerminal';
import { PortfolioPanel, WalletBalance, VaultBalances, PositionItem, ClosedTradeItem, TradeHistorySummary, SmartWalletItem } from './components/PortfolioPanel';
import { SettingsModal, UserSettingsData } from './components/SettingsModal';
import { AutoTradePanel } from './components/AutoTradePanel';

export const App: React.FC = () => {
  const [userId, setUserId] = useState<string>('trader_anon');
  const [jwt, setJwt] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [tradingMode, setTradingMode] = useState<TradingMode>('PAPER');
  const [signals, setSignals] = useState<SwarmSignal[]>([]);
  const [selectedSignal, setSelectedSignal] = useState<SwarmSignal | null>(null);
  const [wallets, setWallets] = useState<WalletBalance[]>([]);
  const [vaultBalances, setVaultBalances] = useState<VaultBalances>({ evm: 0, solana: 0 });
  const [positions, setPositions] = useState<PositionItem[]>([]);
  const [history, setHistory] = useState<ClosedTradeItem[]>([]);
  const [historySummary, setHistorySummary] = useState<TradeHistorySummary | undefined>(undefined);
  const [smartWallets, setSmartWallets] = useState<SmartWalletItem[]>([]);
  const [isBuying, setIsBuying] = useState<boolean>(false);

  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('terminal');
  const [autoTradeEnabled, setAutoTradeEnabled] = useState<boolean>(false);
  const [settings, setSettings] = useState<UserSettingsData>({
    botStatus: 'OFFLINE',
    botTokenMasked: 'NOT CONFIGURED',
    defaultSlippage: 5,
    defaultAmount: 0.1,
    moonbagDefault: true,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ott = params.get('token');

    const authenticate = async (token: string) => {
      try {
        const res = await fetch('/api/auth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (res.ok) {
          const data = await res.json();
          setJwt(data.jwt);
          setUserId(data.userId);
          localStorage.setItem('predique_jwt', data.jwt);

          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } catch (err) {
        console.error('Auth error:', err);
      }
    };

    if (ott) {
      authenticate(ott);
    } else {
      const stored = localStorage.getItem('predique_jwt');
      if (stored) {
        setJwt(stored);
      } else {

        fetch('/api/auth/demo', { method: 'POST' })
          .then((r) => r.json())
          .then((data) => {
            if (data.jwt) {
              setJwt(data.jwt);
              setUserId(data.userId || 'trader_guest');
              localStorage.setItem('predique_jwt', data.jwt);
            }
          })
          .catch((err) => console.error('Guest auth failed:', err));
      }
    }
  }, []);

  const fetchPortfolio = useCallback(
    async (mode: TradingMode = tradingMode) => {
      if (!jwt) return;
      try {
        const m = mode.toLowerCase();
        const [wRes, vRes, posRes, histRes, swRes] = await Promise.all([
          fetch(`/api/wallet/list?mode=${m}`, {
            headers: { Authorization: `Bearer ${jwt}` },
          }),
          fetch('/api/wallet/vault', {
            headers: { Authorization: `Bearer ${jwt}` },
          }),
          fetch(`/api/positions?mode=${m}`, {
            headers: { Authorization: `Bearer ${jwt}` },
          }),
          fetch(`/api/trade/history?mode=${m}`, {
            headers: { Authorization: `Bearer ${jwt}` },
          }),
          fetch('/api/smart-wallets', {
            headers: { Authorization: `Bearer ${jwt}` },
          }),
        ]);

        if (wRes.ok) {
          const data = await wRes.json();
          setWallets(data.wallets || []);
        }
        if (vRes.ok) {
          const data = await vRes.json();
          if (data.vaultBalances) {
            setVaultBalances(data.vaultBalances);
          }
        }
        if (posRes.ok) {
          const data = await posRes.json();
          setPositions(data.positions || []);
        }
        if (histRes.ok) {
          const data = await histRes.json();
          setHistory(data.history || []);
          if (data.summary) {
            setHistorySummary(data.summary);
          }
        }
        if (swRes.ok) {
          const data = await swRes.json();
          setSmartWallets(data.wallets || []);
        }
      } catch (err) {
        console.error('Portfolio fetch error:', err);
      }
    },
    [jwt, tradingMode]
  );

  const handleSweep = async (params: {
    chain: 'EVM' | 'SOLANA';
    vaultAddress: string;
    reserveAmount?: number;
    sweepAmount?: number;
  }): Promise<{ success: boolean; message: string }> => {
    if (!jwt) return { success: false, message: 'Authentication required' };
    try {
      const res = await fetch('/api/wallet/sweep', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          ...params,
          mode: tradingMode.toLowerCase(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.result) {
        if (data.result.status === 'SUCCESS') {
          await fetchPortfolio(tradingMode);
          return {
            success: true,
            message: `SUCCESS! Swept ${data.result.sweptAmount} ${params.chain === 'EVM' ? 'ETH' : 'SOL'} to vault.`,
          };
        }
        return {
          success: false,
          message: `${data.result.status}: ${data.result.reason || 'Sweep could not be completed.'}`,
        };
      }
      return {
        success: false,
        message: data.error || 'Failed to execute balance sweep',
      };
    } catch (err: unknown) {
      return { success: false, message: (err as Error).message };
    }
  };

  const fetchSettings = useCallback(async () => {
    if (!jwt) return;
    try {
      const res = await fetch('/api/settings', {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err);
    }
  }, [jwt]);

  useEffect(() => {
    const fetchSignals = async () => {
      try {
        const sigRes = await fetch('/api/signals');
        if (sigRes.ok) {
          const data = await sigRes.json();
          setSignals(data.signals || []);
          if (data.signals?.length > 0) {
            setSelectedSignal(data.signals[0]);
          }
        }
      } catch (err) {
        console.error('Signals fetch failed:', err);
      }
    };

    fetchSignals();
  }, []);

  const fetchAutoTradeStatus = useCallback(async () => {
    if (!jwt) return;
    try {
      const res = await fetch('/api/autotrade/config', {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setAutoTradeEnabled(!!data.config.enabled);
        }
      }
    } catch {
      // Ignore
    }
  }, [jwt]);

  useEffect(() => {
    if (jwt) {
      fetchPortfolio(tradingMode);
      fetchSettings();
      fetchAutoTradeStatus();
    }
  }, [jwt, tradingMode, fetchPortfolio, fetchSettings, fetchAutoTradeStatus]);

  useEffect(() => {
    if (!jwt) return;
    const timer = setInterval(() => {
      fetchPortfolio(tradingMode);
      fetchAutoTradeStatus();
    }, 4000);
    return () => clearInterval(timer);
  }, [jwt, tradingMode, fetchPortfolio, fetchAutoTradeStatus]);

  useEffect(() => {
    if (!jwt) return;
    const timer = setInterval(() => {
      fetchSettings();
    }, 8000);
    return () => clearInterval(timer);
  }, [jwt, fetchSettings]);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    let ws: WebSocket;
    let pingTimer: NodeJS.Timeout;
    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setWsConnected(true);
        // Subscribe to wildcard and specific channels
        ws.send(JSON.stringify({ type: 'SUBSCRIBE', channel: '*' }));
        // Heartbeat ping every 25s
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'PING' }));
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'PONG') {
            return;
          }
          if (msg.type === 'SWARM_SIGNAL_NEW' && msg.data) {
            setSignals((prev) => [msg.data, ...prev]);
            setSelectedSignal((curr) => curr || msg.data);
          } else if (
            msg.type === 'TRADE_EXECUTED' ||
            msg.type === 'AUTOTRADE_BUY' ||
            msg.type === 'AUTOTRADE_TP1' ||
            msg.type === 'AUTOTRADE_EXIT'
          ) {
            fetchPortfolio(tradingMode);
          } else if (msg.type === 'AUTOTRADE_STATE' && msg.data?.config) {
            setAutoTradeEnabled(!!msg.data.config.enabled);
          }
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (pingTimer) clearInterval(pingTimer);
      };
    } catch {
      setWsConnected(false);
    }

    return () => {
      if (pingTimer) clearInterval(pingTimer);
      if (ws) ws.close();
    };
  }, [jwt, tradingMode, fetchPortfolio]);

  const handleQuickBuy = async (params: {
    tokenAddress: string;
    tokenSymbol: string;
    chain: string;
    amountIn: number;
    slippagePercent: number;
    enableMoonbagAutoTp: boolean;
    isPaper: boolean;
    entryPriceUsd?: number;
  }) => {
    setIsBuying(true);
    try {
      const res = await fetch('/api/trade/quick-buy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify(params),
      });

      if (res.ok) {
        const receipt = await res.json();
        const prefix = params.isPaper ? '📝 [PAPER] ' : '⚡ [LIVE] ';
        alert(`${prefix}Order executed!\nTX: ${receipt.txHash ? receipt.txHash.slice(0, 16) : 'SIMULATED'}...`);
        await fetchPortfolio(tradingMode);
      } else {
        const err = await res.json();
        alert(`❌ Buy failed: ${err.error || 'Unknown error'}`);
      }
    } catch (e: unknown) {
      alert(`❌ Buy failed: ${(e as Error).message}`);
    } finally {
      setIsBuying(false);
    }
  };

  const handleSell = async (positionId: string, percentage: number) => {
    try {
      const isPaper = tradingMode === 'PAPER';
      const targetPos = positions.find((p) => p.id === positionId);
      const res = await fetch('/api/trade/sell', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify({
          positionId,
          percentage,
          isPaper,
          currentPriceUsd: targetPos?.currentPriceUsd,
        }),
      });

      if (res.ok) {
        const modeLabel = isPaper ? '[PAPER] ' : '[LIVE] ';
        alert(`🔴 ${modeLabel}Sold ${percentage}% of position.`);
        await fetchPortfolio(tradingMode);
      } else {
        const err = await res.json();
        alert(`❌ Sell failed: ${err.error || 'Unknown error'}`);
      }
    } catch (e: unknown) {
      alert(`Sell failed: ${(e as Error).message}`);
    }
  };

  const handleResetPaperBalance = async () => {
    if (!jwt) return;
    try {
      const res = await fetch('/api/wallet/reset-paper', {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (res.ok) {
        await fetchPortfolio('PAPER');
      } else {
        const err = await res.json();
        alert(`Failed to reset paper balance: ${err.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Failed to reset paper balance:', err);
    }
  };

  const handleSaveSettings = async (payload: {
    botToken?: string;
    defaultSlippage?: number;
    defaultAmount?: number;
    moonbagDefault?: boolean;
    channelId?: string;
    channelAutoBroadcast?: boolean;
    minSignalTier?: string;
  }) => {
    if (!jwt) return;
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      await fetchSettings();
    } else {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save settings');
    }
  };

  const handleTestChannel = async (channelId: string) => {
    if (!jwt) return { success: false, error: 'Not authenticated' };
    try {
      const res = await fetch('/api/settings/test-channel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ channelId }),
      });
      return await res.json();
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  };

  return (
    <div className="terminal-layout">
      <Header
        wsConnected={wsConnected}
        tradingMode={tradingMode}
        onToggleMode={(mode) => {
          setTradingMode(mode);
          fetchPortfolio(mode);
        }}
        botStatus={settings.botStatus}
        botUsername={settings.botUsername}
        onOpenSettings={() => setIsSettingsOpen(true)}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        autoTradeActive={autoTradeEnabled}
      />

      {activeTab === 'terminal' ? (
        <main className="main-dashboard">
          <SwarmRadar
            signals={signals}
            selectedSignal={selectedSignal}
            onSelect={setSelectedSignal}
          />
          <ActiveTerminal
            signal={selectedSignal}
            tradingMode={tradingMode}
            onQuickBuy={handleQuickBuy}
            isBuying={isBuying}
          />
          <PortfolioPanel
            wallets={wallets}
            vaultBalances={vaultBalances}
            positions={positions}
            history={history}
            historySummary={historySummary}
            smartWallets={smartWallets}
            tradingMode={tradingMode}
            onSell={handleSell}
            onResetPaperBalance={handleResetPaperBalance}
            onSweep={handleSweep}
          />
        </main>
      ) : (
        <AutoTradePanel
          jwt={jwt}
          onRefreshPortfolio={() => fetchPortfolio(tradingMode)}
        />
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
        onTestChannel={handleTestChannel}
      />
    </div>
  );
};
