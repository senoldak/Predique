import { describe, it, expect, beforeEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { AutoTradeService } from '../../src/services/autoTrade.service.js';
import { TradeService } from '../../src/services/trade.service.js';
import { WalletService } from '../../src/services/wallet.service.js';
import type { PublicTokenSignal } from '../../src/services/marketFeed.service.js';

describe('AutoTradeService Multi-Bot Engine', () => {
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

  it('creates, lists, updates, and deletes multiple bot instances', async () => {
    const botsInitial = autoTradeService.getBots();
    expect(botsInitial.length).toBeGreaterThanOrEqual(1);

    const newBot = await autoTradeService.createBot({
      name: 'Base Alpha Sniper',
      enabled: true,
      mode: 'PAPER',
      strategy: 'SWARM_MOMENTUM',
      chain: 'BASE',
      maxTradeAmountNative: 0.05,
      maxOpenPositions: 2,
      slippagePercent: 5,
      takeProfitPercent: 40,
      stopLossPercent: 10,
      trailingStopPercent: 8,
      dailyMaxDrawdownPercent: 5,
      minLiquidityUsd: 10000,
    });

    expect(newBot.id).toBeDefined();
    expect(newBot.name).toBe('Base Alpha Sniper');
    expect(newBot.chain).toBe('BASE');

    const botList = autoTradeService.getBots();
    expect(botList.some((b) => b.id === newBot.id)).toBe(true);

    const updated = await autoTradeService.updateBot(newBot.id, {
      maxTradeAmountNative: 0.08,
      takeProfitPercent: 50,
    });
    expect(updated?.maxTradeAmountNative).toBe(0.08);
    expect(updated?.takeProfitPercent).toBe(50);

    const toggled = await autoTradeService.toggleBot(newBot.id, false);
    expect(toggled?.enabled).toBe(false);

    const deleted = await autoTradeService.deleteBot(newBot.id);
    expect(deleted).toBe(true);
    expect(autoTradeService.getBot(newBot.id)).toBeUndefined();
  });

  it('routes incoming signals concurrently to matching bots and attributes positions', async () => {

    const botSolana = await autoTradeService.createBot({
      name: 'Solana Swarm Bot',
      enabled: true,
      mode: 'PAPER',
      strategy: 'SWARM_MOMENTUM',
      chain: 'SOLANA',
      maxTradeAmountNative: 0.1,
      maxOpenPositions: 3,
      slippagePercent: 5,
      takeProfitPercent: 35,
      stopLossPercent: 12,
      trailingStopPercent: 10,
      dailyMaxDrawdownPercent: 5,
      minLiquidityUsd: 10000,
    });

    const botBase = await autoTradeService.createBot({
      name: 'Base Swarm Bot',
      enabled: true,
      mode: 'PAPER',
      strategy: 'SWARM_MOMENTUM',
      chain: 'BASE',
      maxTradeAmountNative: 0.02,
      maxOpenPositions: 3,
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
      tokenSymbol: 'SOLMEME',
      mcap: 100000,
      liquidity: 30000,
      liqRatio: 30,
      ageMinutes: 20,
      rating: '★★★',
      smartWalletsCount: 4,
      totalSpent: 1.5,
      priceUsd: 0.05,
      earlySelling: false,
      hasHoneypot: false,
    };

    const entered = await autoTradeService.processSignal(solanaSignal);
    expect(entered).toBe(true);

    const positions = autoTradeService.getAutoPositions();
    const solPos = positions.find((p) => p.tokenAddress === solanaSignal.tokenAddress);
    expect(solPos).toBeDefined();
    expect(solPos?.botId).toBe(botSolana.id);
    expect(solPos?.botName).toBe(botSolana.name);

    if (solPos) {
      const closed = await autoTradeService.manualExitPosition(solPos.id);
      expect(closed).toBe(true);

      const positionsAfter = autoTradeService.getAutoPositions();
      expect(positionsAfter.some((p) => p.id === solPos.id)).toBe(false);

      const history = autoTradeService.getTradeHistory();
      const histItem = history.find((h) => h.positionId === solPos.id);
      expect(histItem).toBeDefined();
      expect(histItem?.botId).toBe(botSolana.id);
      expect(histItem?.exitReason).toBe('MANUAL');
    }
  });

  it('pauses all active bots when emergency pause-all is invoked', async () => {
    await autoTradeService.createBot({
      name: 'Bot A',
      enabled: true,
      mode: 'PAPER',
      strategy: 'SWARM_MOMENTUM',
      chain: 'ALL',
      maxTradeAmountNative: 0.1,
      maxOpenPositions: 3,
      slippagePercent: 5,
      takeProfitPercent: 35,
      stopLossPercent: 12,
      trailingStopPercent: 10,
      dailyMaxDrawdownPercent: 5,
      minLiquidityUsd: 10000,
    });

    const activeBefore = autoTradeService.getBots().filter((b) => b.enabled);
    expect(activeBefore.length).toBeGreaterThan(0);

    await autoTradeService.pauseAllBots();

    const activeAfter = autoTradeService.getBots().filter((b) => b.enabled);
    expect(activeAfter.length).toBe(0);
  });
});
