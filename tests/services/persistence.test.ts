import { describe, it, expect } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { WalletService } from '../../src/services/wallet.service.js';
import { TradeService } from '../../src/services/trade.service.js';
import { AutoTradeService } from '../../src/services/autoTrade.service.js';

const MASTER = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const mockRedis = () => new (RedisMock as unknown as new () => Redis)();

describe('Redis custody round-trip', () => {
  it('wallets survive a service restart via Redis', async () => {
    const redis = mockRedis();
    const ws1 = new WalletService(MASTER, redis);
    const created = await ws1.getOrGenerateWallet('u_persist_1', 'EVM');

    const ws2 = new WalletService(MASTER, redis);
    const listed = await ws2.getWallets('u_persist_1', 'live');
    expect(listed).toHaveLength(1);
    expect(listed[0].address).toBe(created.address);
  });

  it('paper positions survive a service restart via Redis', async () => {
    const redis = mockRedis();
    const ws = new WalletService(MASTER, redis);
    const ts1 = new TradeService(ws, redis);
    await ts1.executeQuickBuy({
      userId: 'u_persist_2',
      tokenAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      tokenSymbol: 'PERS',
      chain: 'BASE',
      amountIn: 0.1,
      slippagePercent: 5,
      isPaper: true,
      entryPriceUsd: 2.0,
    });

    const ts2 = new TradeService(ws, redis);
    const positions = await ts2.getPositions('u_persist_2', true);
    expect(positions).toHaveLength(1);
    expect(positions[0].entryPriceUsd).toBe(2.0);
  });

  it('autotrade positions persist and reload', async () => {
    const redis = mockRedis();
    const ws = new WalletService(MASTER, redis);
    const ts = new TradeService(ws, redis);
    const at1 = new AutoTradeService(ts, ws, undefined, 60000, redis);
    try {
      at1.toggle(true);
      await at1.processSignal({
        id: 'sig_persist',
        tokenAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
        tokenSymbol: 'PERA',
        chain: 'BASE',
        mcap: 100000,
        liquidity: 30000,
        liqRatio: 30,
        rating: 'ROYAL_HONEY',
        earlySelling: false,
        pileInTime: '12 buys/5m',
        ageMinutes: 70,
        smartWalletsCount: 6,
        priceUsd: 1.0,
        timestamp: Date.now(),
        reasons: [],
      });
      expect(at1.getAutoPositions()).toHaveLength(1);

      const raw = await redis.get('predique:autotrade:positions');
      expect(raw).toContain('PERA');

      const at2 = new AutoTradeService(ts, ws, undefined, 60000, redis);
      try {
        await new Promise((r) => setTimeout(r, 50));
        expect(at2.getAutoPositions()).toHaveLength(1);
      } finally {
        at2.destroy();
      }
    } finally {
      at1.destroy();
    }
  });
});
