import { describe, it, expect, beforeEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import { TradeService } from '../../src/services/trade.service.js';
import { WalletService } from '../../src/services/wallet.service.js';

describe('TradeService - Closed Trade History & Analytics', () => {
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  let redis: any;
  let walletService: WalletService;
  let tradeService: TradeService;

  beforeEach(() => {
    redis = new (RedisMock as any)();
    walletService = new WalletService(masterKey, redis);
    tradeService = new TradeService(walletService, redis);
  });

  it('records a closed trade record when position is exited', async () => {
    // 1. Open a position
    const buyRes = await tradeService.executeQuickBuy({
      userId: 'user_hist_1',
      tokenAddress: '0x1111111111111111111111111111111111111111',
      tokenSymbol: 'ALPHA',
      chain: 'BASE',
      amountIn: 0.1,
      slippagePercent: 5,
      isPaper: true,
      entryPriceUsd: 1.0,
      entryMcap: 50000,
    });

    expect(buyRes.status).toBe('SUCCESS');

    // 2. Close position at 1.5 (+50% PnL)
    const closeRes = await tradeService.closePosition(
      'user_hist_1',
      buyRes.positionId,
      100,
      true,
      1.5
    );

    expect(closeRes.status).toBe('SUCCESS');

    // 3. Fetch trade history
    const history = await tradeService.getTradeHistory('user_hist_1', true);
    expect(history.length).toBe(1);

    const record = history[0];
    expect(record.tokenSymbol).toBe('ALPHA');
    expect(record.entryPriceUsd).toBe(1.0);
    expect(record.exitPriceUsd).toBe(1.5);
    expect(record.pnlPercent).toBeCloseTo(50.0);
    expect(record.percentageSold).toBe(100);
    expect(record.txHash).toBeDefined();
  });
});
