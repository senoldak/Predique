import { describe, it, expect, beforeEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { BotManager } from '../../src/bot/botManager.js';
import { WalletService } from '../../src/services/wallet.service.js';
import { TradeService } from '../../src/services/trade.service.js';
import { AutoTradeService } from '../../src/services/autoTrade.service.js';

describe('BotManager Multi-Bot & Position Callback Verification', () => {
  let redis: Redis;
  let walletService: WalletService;
  let tradeService: TradeService;
  let autoTradeService: AutoTradeService;
  let botManager: BotManager;

  beforeEach(() => {
    redis = new (RedisMock as unknown as typeof Redis)();
    walletService = new WalletService(redis);
    tradeService = new TradeService(walletService, redis);
    autoTradeService = new AutoTradeService(tradeService, walletService, undefined, 2000, redis);
    botManager = new BotManager(walletService, tradeService, autoTradeService);
  });

  it('initializes BotManager with AutoTradeService attached', () => {
    expect(botManager).toBeDefined();
    expect(autoTradeService.getBots().length).toBeGreaterThanOrEqual(1);
  });

  it('toggles bot state via autoTradeService', async () => {
    const defaultBot = autoTradeService.getBots()[0];
    expect(defaultBot).toBeDefined();

    const toggled = await autoTradeService.toggleBot(defaultBot.id, true);
    expect(toggled?.enabled).toBe(true);

    const paused = await autoTradeService.toggleBot(defaultBot.id, false);
    expect(paused?.enabled).toBe(false);
  });
});
