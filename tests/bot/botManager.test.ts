import { describe, it, expect } from 'vitest';
import { maskToken } from '../../src/utils/mask.js';
import { BotManager } from '../../src/bot/botManager.js';
import { WalletService } from '../../src/services/wallet.service.js';
import { TradeService } from '../../src/services/trade.service.js';

describe('Token Masking Utility', () => {
  it('masks token preserving prefix and suffix', () => {
    const raw = '1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ_dummy_token';
    const masked = maskToken(raw);
    expect(masked.startsWith('123456')).toBe(true);
    expect(masked.endsWith('oken')).toBe(true);
    expect(masked).not.toContain('ABCdefGHIjklMNOpqrSTUvwxYZ_dummy');
    expect(masked).toContain('******');
  });

  it('handles short or empty tokens safely', () => {
    expect(maskToken('')).toBe('**********');
    expect(maskToken('short')).toBe('**********');
  });
});

describe('BotManager Lifecycle', () => {
  it('reports stopped status initially', () => {
    const walletService = new WalletService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    const tradeService = new TradeService(walletService);
    const manager = new BotManager(walletService, tradeService);

    expect(manager.getStatus().isRunning).toBe(false);
    expect(manager.getStatus().botUsername).toBeUndefined();
  });

  it('rejects invalid or placeholder tokens gracefully without throwing', async () => {
    const walletService = new WalletService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    const tradeService = new TradeService(walletService);
    const manager = new BotManager(walletService, tradeService);

    const started = await manager.start('123456789:ABCdefGHI');
    expect(started).toBe(false);
    expect(manager.getStatus().isRunning).toBe(false);
    expect(manager.getStatus().error).toBeDefined();
  });

  it('safely rejects broadcastWhaleAlert when bot is offline', async () => {
    const walletService = new WalletService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    const tradeService = new TradeService(walletService);
    const manager = new BotManager(walletService, tradeService);

    const res = await manager.broadcastWhaleAlert({
      chain: 'solana',
      tokenSymbol: 'SOL',
      contractAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      walletLabel: 'Whale 1',
      walletAddress: '0x123',
      winRate30d: 85,
      totalPnlUsd: 100000,
      action: 'BUY',
      volumeNative: 10,
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Bot is offline');
  });
});
