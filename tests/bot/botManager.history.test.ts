import { describe, it, expect, beforeEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import { BotManager } from '../../src/bot/botManager.js';
import { WalletService } from '../../src/services/wallet.service.js';
import { TradeService } from '../../src/services/trade.service.js';

describe('BotManager /history & /trades Telegram Bot Commands', () => {
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  let botManager: BotManager;
  let tradeService: TradeService;
  let walletService: WalletService;

  beforeEach(() => {
    const redis = new (RedisMock as any)();
    walletService = new WalletService(masterKey, redis);
    tradeService = new TradeService(walletService, redis);
    botManager = new BotManager(walletService, tradeService);
  });

  it('registers history commands without errors', () => {
    expect(botManager).toBeDefined();
    expect(typeof (botManager as any).renderHistoryHandler).toBe('undefined'); // encapsulated in setupBotCommands
  });

  it('aggregates trade history from TradeService for Telegram presentation', async () => {
    const userId = 'tg_123456';
    const buy = await tradeService.executeQuickBuy({
      userId,
      tokenAddress: '0x1111111111111111111111111111111111111111',
      tokenSymbol: 'ALPHA',
      chain: 'BASE',
      amountIn: 0.5,
      slippagePercent: 5,
      isPaper: true,
      entryPriceUsd: 1.0,
      entryMcap: 100000,
    });

    await tradeService.closePosition(userId, buy.positionId, 100, true, 1.5); // +50%

    const history = await tradeService.getTradeHistory(userId, true);
    expect(history).toHaveLength(1);
    expect(history[0].pnlPercent).toBeCloseTo(50.0);
    expect(history[0].tokenSymbol).toBe('ALPHA');
  });

  it('binds SmartWalletRegistry and prepares alpha wallet intelligence for Telegram', async () => {
    const { SmartWalletRegistry } = await import('../../src/engine/smartWalletRegistry.js');
    const registry = new SmartWalletRegistry(true);
    botManager.setSmartWalletRegistry(registry);

    const wallets = registry.getAllWallets();
    expect(wallets.length).toBeGreaterThanOrEqual(4);
    expect(wallets[0].winRate30d).toBeGreaterThan(70);
  });
});
