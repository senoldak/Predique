import { describe, it, expect } from 'vitest';
import { BotManager } from '../../src/bot/botManager.js';
import { WalletService } from '../../src/services/wallet.service.js';
import { TradeService } from '../../src/services/trade.service.js';

describe('BotManager Channel Broadcast Engine', () => {
  it('manages channel broadcast configuration with default @predique', () => {
    const walletService = new WalletService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    const tradeService = new TradeService(walletService);
    const manager = new BotManager(walletService, tradeService);

    const config = manager.getChannelConfig();
    expect(config.channelId).toBe('@predique');
    expect(config.autoBroadcast).toBe(true);
    expect(config.minTier).toBe('ALL');

    manager.setChannelConfig({
      channelId: '@my_crypto_channel',
      autoBroadcast: false,
      minTier: 'TIER_3',
    });

    const updated = manager.getChannelConfig();
    expect(updated.channelId).toBe('@my_crypto_channel');
    expect(updated.autoBroadcast).toBe(false);
    expect(updated.minTier).toBe('TIER_3');
  });

  it('fails gracefully when bot is offline and test message is attempted', async () => {
    const walletService = new WalletService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    const tradeService = new TradeService(walletService);
    const manager = new BotManager(walletService, tradeService);

    const result = await manager.sendTestMessage('@predique');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Bot is not online');
  });

  it('queues rate-limited signals without duplicates', () => {
    const walletService = new WalletService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    const tradeService = new TradeService(walletService);
    const manager = new BotManager(walletService, tradeService);

    const royal: any = {
      tokenAddress: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      rating: 'ROYAL_HONEY',
    };
    const worker: any = {
      tokenAddress: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      rating: 'WORKER_HONEY',
    };

    manager.setChannelConfig({ minTier: 'TIER_4' });
    manager.queueSignal(worker);
    expect((manager as any).signalQueue.length).toBe(0);

    manager.queueSignal(royal);
    manager.queueSignal(royal);
    expect((manager as any).signalQueue.length).toBe(1);
  });

  it('accurately evaluates signal tier filters', () => {
    const walletService = new WalletService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    const tradeService = new TradeService(walletService);
    const manager = new BotManager(walletService, tradeService);

    const baseSignal: any = {
      tokenAddress: '0x1111111111111111111111111111111111111111',
      rating: 'ROYAL_HONEY',
    };

    expect(manager.passesTierFilter(baseSignal)).toBe(true);

    manager.setChannelConfig({ minTier: 'TIER_4' });
    expect(manager.passesTierFilter(baseSignal)).toBe(true);

    const workerSignal: any = {
      tokenAddress: '0x2222222222222222222222222222222222222222',
      rating: 'WORKER_HONEY',
    };
    expect(manager.passesTierFilter(workerSignal)).toBe(false);

    manager.setChannelConfig({ minTier: 'TIER_3' });
    expect(manager.passesTierFilter(workerSignal)).toBe(true);
  });
});
