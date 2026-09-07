import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AutoTradeService } from '../../src/services/autoTrade.service.js';
import { TradeService, generateClientOrderId } from '../../src/services/trade.service.js';
import { WalletService } from '../../src/services/wallet.service.js';
import type { PublicTokenSignal } from '../../src/services/marketFeed.service.js';

describe('Crypto Exchange Safety (crypto-exchange-safety skill)', () => {
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  let walletService: WalletService;
  let tradeService: TradeService;
  let autoTradeService: AutoTradeService;

  beforeEach(() => {
    walletService = new WalletService(masterKey);
    tradeService = new TradeService(walletService);
    autoTradeService = new AutoTradeService(tradeService, walletService, undefined, 500);
  });

  afterEach(() => {
    autoTradeService.destroy();
  });

  describe('Rule 1: Idempotency Everywhere (clientOrderId & Replay Protection)', () => {
    it('generates deterministic clientOrderId for identical trade context', () => {
      const id1 = generateClientOrderId('user123', '0xabc', 'bot_default', 100000);
      const id2 = generateClientOrderId('user123', '0xabc', 'bot_default', 100000);
      const id3 = generateClientOrderId('user123', '0xdef', 'bot_default', 100000);

      expect(id1).toBe(id2);
      expect(id1).not.toBe(id3);
      expect(id1.length).toBeGreaterThanOrEqual(16);
    });

    it('rejects duplicate execution when same clientOrderId is dispatched twice', async () => {
      const clientOrderId = 'clord_test_idempotency_123';
      const buyParams = {
        userId: 'user_safety_1',
        tokenAddress: '0xabf4f0999be267d8eaae658fb1f426f5a8568771',
        tokenSymbol: 'NECTAR',
        chain: 'BASE' as const,
        amountIn: 0.1,
        slippagePercent: 5,
        isPaper: true,
        clientOrderId,
      };

      const first = await tradeService.executeQuickBuy(buyParams);
      expect(first.status).toBe('SUCCESS');

      await expect(tradeService.executeQuickBuy(buyParams)).rejects.toThrow(/duplicate order/i);
    });
  });

  describe('Rule 2: Dead-Man Switch (Stale Feed Protection)', () => {
    it('rejects signals older than MAX_SIGNAL_AGE_MS (90s)', async () => {
      autoTradeService.toggle(true);

      const staleSignal: PublicTokenSignal = {
        id: 'sig_stale_1',
        tokenAddress: '0x1234567890123456789012345678901234567890',
        tokenSymbol: 'STALE',
        chain: 'BASE',
        mcap: 100000,
        liquidity: 30000,
        liqRatio: 30,
        rating: 'ROYAL_HONEY',
        earlySelling: false,
        pileInTime: '25 buys/5m',
        ageMinutes: 10,
        smartWalletsCount: 5,
        timestamp: Date.now() - 100_000, // 100 seconds old (> 90s)
        priceUsd: 1.5,
        reasons: [],
      };

      const triggered = await autoTradeService.processSignal(staleSignal);
      expect(triggered).toBe(false);
      expect(autoTradeService.getAutoPositions()).toHaveLength(0);
    });

    it('accepts fresh signals within timestamp window', async () => {
      autoTradeService.toggle(true);

      const freshSignal: PublicTokenSignal = {
        id: 'sig_fresh_1',
        tokenAddress: '0x2234567890123456789012345678901234567890',
        tokenSymbol: 'FRESH',
        chain: 'BASE',
        mcap: 120000,
        liquidity: 40000,
        liqRatio: 33,
        rating: 'ROYAL_HONEY',
        earlySelling: false,
        pileInTime: '25 buys/5m',
        ageMinutes: 2,
        smartWalletsCount: 6,
        timestamp: Date.now() - 5000, // 5 seconds old (fresh)
        priceUsd: 2.0,
        reasons: [],
      };

      const triggered = await autoTradeService.processSignal(freshSignal);
      expect(triggered).toBe(true);
      expect(autoTradeService.getAutoPositions()).toHaveLength(1);
    });
  });

  describe('Rule 3: Precision & MinNotional (Dust Filter)', () => {
    it('rejects dust trades when trade amount in native is below minimum safe threshold', async () => {
      await expect(
        tradeService.executeQuickBuy({
          userId: 'user_dust_1',
          tokenAddress: '0xabf4f0999be267d8eaae658fb1f426f5a8568771',
          tokenSymbol: 'NECTAR',
          chain: 'BASE',
          amountIn: 0.00001, // Dust amount below 0.0001
          slippagePercent: 5,
          isPaper: true,
        })
      ).rejects.toThrow(/dust amount/i);
    });
  });
});
