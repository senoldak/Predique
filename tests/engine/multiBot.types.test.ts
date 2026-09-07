import { describe, it, expect } from 'vitest';
import type {
  AutoTradeBotInstance,
  AutoTradePosition,
  AutoTradeHistoryItem,
} from '../../src/types/autotrade.js';

describe('Multi-Bot Auto-Trading Types & Integrity', () => {
  it('instantiates a valid AutoTradeBotInstance structure', () => {
    const bot: AutoTradeBotInstance = {
      id: 'bot_solana_swarm_1',
      name: 'Solana Swarm Sniper',
      enabled: true,
      mode: 'PAPER',
      strategy: 'SWARM_MOMENTUM',
      chain: 'SOLANA',
      maxTradeAmountNative: 0.15,
      maxOpenPositions: 3,
      slippagePercent: 5,
      takeProfitPercent: 35,
      stopLossPercent: 12,
      trailingStopPercent: 10,
      dailyMaxDrawdownPercent: 5,
      minLiquidityUsd: 15000,
      createdAt: Date.now(),
      stats: {
        totalTrades: 10,
        winningTrades: 8,
        losingTrades: 2,
        winRate: 80,
        totalPnlNative: 1.45,
        profitFactor: 2.8,
        peakDrawdownPercent: 3.2,
        currentDailyDrawdownPercent: 1.1,
        circuitBreakerActive: false,
        activeAutoPositionsCount: 1,
      },
    };

    expect(bot.id).toBe('bot_solana_swarm_1');
    expect(bot.name).toBe('Solana Swarm Sniper');
    expect(bot.chain).toBe('SOLANA');
    expect(bot.enabled).toBe(true);
  });

  it('supports position attribution with botId and botName', () => {
    const pos: AutoTradePosition = {
      id: 'pos_123',
      botId: 'bot_solana_swarm_1',
      botName: 'Solana Swarm Sniper',
      userId: 'user_1',
      tokenAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      tokenSymbol: 'PEPE',
      chain: 'solana',
      amountIn: 0.15,
      entryPriceUsd: 0.005,
      currentPriceUsd: 0.0065,
      peakPriceUsd: 0.0068,
      highestPriceUsd: 0.0068,
      stopLossPriceUsd: 0.0044,
      pnlPercent: 30,
      tp1Hit: false,
      tokensHeld: '30000',
      strategy: 'SWARM_MOMENTUM',
      entryTimestamp: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(pos.botId).toBe('bot_solana_swarm_1');
    expect(pos.botName).toBe('Solana Swarm Sniper');
  });

  it('supports history item attribution with botId and botName', () => {
    const hist: AutoTradeHistoryItem = {
      id: 'hist_123',
      botId: 'bot_solana_swarm_1',
      botName: 'Solana Swarm Sniper',
      positionId: 'pos_123',
      tokenAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      tokenSymbol: 'PEPE',
      chain: 'solana',
      strategy: 'SWARM_MOMENTUM',
      mode: 'PAPER',
      entryPriceUsd: 0.005,
      exitPriceUsd: 0.0065,
      amountIn: 0.15,
      pnlPercent: 30,
      pnlNative: 0.045,
      exitReason: 'MANUAL',
      timestamp: Date.now(),
    };

    expect(hist.botId).toBe('bot_solana_swarm_1');
    expect(hist.exitReason).toBe('MANUAL');
  });
});
