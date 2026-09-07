import { describe, it, expect, beforeEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { WalletService } from '../../src/services/wallet.service.js';
import { TradeService } from '../../src/services/trade.service.js';
import { AutoTradeService } from '../../src/services/autoTrade.service.js';
import type { PublicTokenSignal } from '../../src/services/marketFeed.service.js';

describe('E2E Multi-Bot & Position Management Lifecycle', () => {
  let redis: Redis;
  let walletService: WalletService;
  let tradeService: TradeService;
  let autoTradeService: AutoTradeService;

  beforeEach(async () => {
    redis = new (RedisMock as unknown as typeof Redis)();
    walletService = new WalletService(redis);
    tradeService = new TradeService(walletService, redis);
    autoTradeService = new AutoTradeService(tradeService, walletService, undefined, 2000, redis);
  });

  it('runs concurrent multi-chain bots, attributes positions, and processes manual close', async () => {

    const solanaBot = await autoTradeService.createBot({
      name: 'Solana Swarm Alpha',
      enabled: true,
      mode: 'PAPER',
      strategy: 'SWARM_MOMENTUM',
      chain: 'SOLANA',
      maxTradeAmountNative: 0.1,
      maxOpenPositions: 2,
      slippagePercent: 5,
      takeProfitPercent: 35,
      stopLossPercent: 12,
      trailingStopPercent: 10,
      dailyMaxDrawdownPercent: 5,
      minLiquidityUsd: 10000,
    });

    const baseBot = await autoTradeService.createBot({
      name: 'Base Swarm Hunter',
      enabled: true,
      mode: 'PAPER',
      strategy: 'SWARM_MOMENTUM',
      chain: 'BASE',
      maxTradeAmountNative: 0.05,
      maxOpenPositions: 2,
      slippagePercent: 5,
      takeProfitPercent: 35,
      stopLossPercent: 12,
      trailingStopPercent: 10,
      dailyMaxDrawdownPercent: 5,
      minLiquidityUsd: 10000,
    });

    const solanaSignal: PublicTokenSignal = {
      chain: 'solana',
      tokenAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      tokenSymbol: 'SOLGEM',
      mcap: 120000,
      liquidity: 40000,
      liqRatio: 33.3,
      ageMinutes: 15,
      rating: '★★★',
      smartWalletsCount: 4,
      totalSpent: 2.0,
      priceUsd: 0.012,
      earlySelling: false,
      hasHoneypot: false,
    };

    const solEntered = await autoTradeService.processSignal(solanaSignal);
    expect(solEntered).toBe(true);

    const baseSignal: PublicTokenSignal = {
      chain: 'base',
      tokenAddress: '0x1111111111111111111111111111111111111111',
      tokenSymbol: 'BASEGEM',
      mcap: 90000,
      liquidity: 30000,
      liqRatio: 33.3,
      ageMinutes: 25,
      rating: '★★★',
      smartWalletsCount: 3,
      totalSpent: 0.5,
      priceUsd: 0.005,
      earlySelling: false,
      hasHoneypot: false,
    };

    const baseEntered = await autoTradeService.processSignal(baseSignal);
    expect(baseEntered).toBe(true);

    const positions = autoTradeService.getAutoPositions();
    expect(positions.length).toBe(2);

    const solPos = positions.find((p) => p.tokenSymbol === 'SOLGEM');
    const basePos = positions.find((p) => p.tokenSymbol === 'BASEGEM');

    expect(solPos?.botId).toBe(solanaBot.id);
    expect(solPos?.botName).toBe('Solana Swarm Alpha');

    expect(basePos?.botId).toBe(baseBot.id);
    expect(basePos?.botName).toBe('Base Swarm Hunter');

    if (solPos) {
      const exitSuccess = await autoTradeService.manualExitPosition(solPos.id);
      expect(exitSuccess).toBe(true);

      const positionsAfter = autoTradeService.getAutoPositions();
      expect(positionsAfter.length).toBe(1);
      expect(positionsAfter[0].tokenSymbol).toBe('BASEGEM');

      const history = autoTradeService.getTradeHistory();
      expect(history.length).toBe(1);
      expect(history[0].botId).toBe(solanaBot.id);
      expect(history[0].exitReason).toBe('MANUAL');
    }
  });
});
