import { describe, it, expect } from 'vitest';
import {
  formatAutoBuyAlert,
  formatAutoTpAlert,
  formatAutoExitAlert,
  formatAutoTradeStatus,
} from '../../src/bot/formatters.js';
import type { AutoTradeConfig, AutoTradeStats, AutoTradePosition, AutoTradeHistoryItem } from '../../src/types/autotrade.js';

describe('AutoTrade Bot Formatters', () => {
  const mockConfig: AutoTradeConfig = {
    enabled: true,
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
  };

  const mockStats: AutoTradeStats = {
    totalTrades: 12,
    winningTrades: 9,
    losingTrades: 3,
    winRate: 75.0,
    totalPnlNative: 1.45,
    profitFactor: 2.8,
    peakDrawdownPercent: 2.1,
    currentDailyDrawdownPercent: 0.5,
    circuitBreakerActive: false,
    activeAutoPositionsCount: 2,
  };

  const mockPos: AutoTradePosition = {
    id: 'pos_123',
    userId: 'trader_paper',
    tokenAddress: '0x1111111111111111111111111111111111111111',
    tokenSymbol: 'SWARM',
    chain: 'BASE',
    amountIn: 0.1,
    entryMcap: 150000,
    currentMcap: 150000,
    entryPriceUsd: 0.5,
    currentPriceUsd: 0.5,
    pnlPercent: 0,
    moonbagActive: true,
    timestamp: Date.now(),
    isPaper: true,
    strategy: 'SWARM_MOMENTUM',
    highestPriceUsd: 0.5,
    tp1Hit: false,
    stopLossPriceUsd: 0.44,
    entryTimestamp: Date.now(),
  };

  it('formats auto-buy alert with strategy rationale and mode', () => {
    const text = formatAutoBuyAlert(mockPos, 'Swarm cluster detected (6 wallets)', 'PAPER');
    expect(text).toContain('AUTO-BUY EXECUTED');
    expect(text).toContain('PAPER VIRTUAL');
    expect(text).toContain('$SWARM');
    expect(text).toContain('Swarm cluster detected');
  });

  it('formats TP1 alert showing 50% profit taking and breakeven adjustment', () => {
    const text = formatAutoTpAlert(mockPos, 36.5, 0.6825);
    expect(text).toContain('TP1 PROFIT TAKEN');
    expect(text).toContain('+36.5%');
    expect(text).toContain('Breakeven Stop');
  });

  it('formats exit alert with realized PnL and exit reason', () => {
    const historyItem: AutoTradeHistoryItem = {
      id: 'hist_1',
      positionId: 'pos_123',
      tokenAddress: mockPos.tokenAddress,
      tokenSymbol: 'SWARM',
      chain: 'BASE',
      strategy: 'SWARM_MOMENTUM',
      mode: 'PAPER',
      entryPriceUsd: 0.5,
      exitPriceUsd: 0.65,
      amountIn: 0.05,
      pnlPercent: 30.0,
      pnlNative: 0.015,
      exitReason: 'TRAILING_STOP',
      timestamp: Date.now(),
    };

    const text = formatAutoExitAlert(historyItem);
    expect(text).toContain('POSITION CLOSED');
    expect(text).toContain('TRAILING STOP');
    expect(text).toContain('+30.0%');
  });

  it('formats /autotrade status overview with win rate and circuit breaker status', () => {
    const text = formatAutoTradeStatus(mockConfig, mockStats);
    expect(text).toContain('AUTO-TRADING STATUS');
    expect(text).toContain('ACTIVE');
    expect(text).toContain('75%');
    expect(text).toContain('SWARM_MOMENTUM');
  });

  it('formats status accurately for BREAKOUT_SURGE and SNIPER_ALPHA', () => {
    const breakoutText = formatAutoTradeStatus({ ...mockConfig, strategy: 'BREAKOUT_SURGE' }, mockStats);
    expect(breakoutText).toContain('BREAKOUT_SURGE');

    const sniperText = formatAutoTradeStatus({ ...mockConfig, strategy: 'SNIPER_ALPHA' }, mockStats);
    expect(sniperText).toContain('SNIPER_ALPHA');
  });
});
