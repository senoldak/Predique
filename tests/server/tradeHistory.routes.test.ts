import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import RedisMock from 'ioredis-mock';
import { createServerApp } from '../../src/server/app.js';
import { WalletService } from '../../src/services/wallet.service.js';
import { TradeService } from '../../src/services/trade.service.js';
import { signJwt } from '../../src/server/auth.js';

describe('Trade History API Gateway', () => {
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const jwtSecret = 'super_secret_jwt_key_at_least_32_characters_long';
  let app: any;
  let token: string;
  let tradeService: TradeService;

  beforeEach(async () => {
    const redis = new (RedisMock as any)();
    await redis.flushall?.();
    const walletService = new WalletService(masterKey, redis);
    tradeService = new TradeService(walletService, redis);

    const instance = createServerApp({
      walletService,
      tradeService,
      jwtSecret,
    });
    app = instance.app;
    token = signJwt('user_api_hist', jwtSecret);

    // Seed 1 closed trade
    const buyRes = await tradeService.executeQuickBuy({
      userId: 'user_api_hist',
      tokenAddress: '0x2222222222222222222222222222222222222222',
      tokenSymbol: 'PEPE',
      chain: 'BASE',
      amountIn: 0.2,
      slippagePercent: 5,
      isPaper: true,
      entryPriceUsd: 1.0,
      entryMcap: 100000,
    });

    await tradeService.closePosition('user_api_hist', buyRes.positionId, 100, true, 1.25);
  });

  it('GET /api/trade/history returns trade history and summary metrics', async () => {
    const res = await request(app)
      .get('/api/trade/history?mode=paper')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0].tokenSymbol).toBe('PEPE');
    expect(res.body.history[0].pnlPercent).toBeCloseTo(25.0);
    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.totalTrades).toBe(1);
    expect(res.body.summary.winRate).toBe(100);
  });

  it('GET /api/trade/history/export downloads CSV tax/audit report', async () => {
    const res = await request(app)
      .get('/api/trade/history/export?mode=paper&format=csv')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment; filename="predique_trade_history_');
    expect(res.text).toContain('Trade ID,Position ID,Token Symbol');
    expect(res.text).toContain('"PEPE"');
    expect(res.text).toContain('"PAPER"');
  });

  it('GET /api/trade/history/export returns structured JSON archive', async () => {
    const res = await request(app)
      .get('/api/trade/history/export?mode=paper&format=json')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user_api_hist');
    expect(res.body.totalCount).toBe(1);
    expect(res.body.trades).toHaveLength(1);
    expect(res.body.trades[0].tokenSymbol).toBe('PEPE');
  });
});
