import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { createApiRouter } from '../../src/server/routes.js';
import { WalletService } from '../../src/services/wallet.service.js';
import { TradeService } from '../../src/services/trade.service.js';
import { AutoTradeService } from '../../src/services/autoTrade.service.js';
import { signJwt } from '../../src/server/auth.js';

describe('Multi-Bot REST API Endpoints', () => {
  let app: express.Express;
  let redis: Redis;
  let walletService: WalletService;
  let tradeService: TradeService;
  let autoTradeService: AutoTradeService;
  let userToken: string;
  const jwtSecret = 'test_secret_for_multibot_router_1234567890';

  beforeEach(() => {
    redis = new (RedisMock as unknown as typeof Redis)();
    walletService = new WalletService(redis);
    tradeService = new TradeService(walletService, redis);
    autoTradeService = new AutoTradeService(tradeService, walletService, undefined, 2000, redis);

    app = express();
    app.use(express.json());
    app.use(
      '/api',
      createApiRouter({
        walletService,
        tradeService,
        autoTradeService,
        jwtSecret,
      })
    );

    userToken = signJwt('test_trader', jwtSecret, false);
  });

  it('GET /api/autotrade/bots lists existing bots', async () => {
    const res = await request(app)
      .get('/api/autotrade/bots')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.bots)).toBe(true);
    expect(res.body.bots.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/autotrade/bots creates a new bot instance', async () => {
    const payload = {
      name: 'ETH Dip Scalper',
      enabled: true,
      mode: 'PAPER',
      strategy: 'MEAN_REVERSION',
      chain: 'ETH',
      maxTradeAmountNative: 0.05,
      maxOpenPositions: 2,
      slippagePercent: 5,
      takeProfitPercent: 30,
      stopLossPercent: 10,
      trailingStopPercent: 8,
      dailyMaxDrawdownPercent: 5,
      minLiquidityUsd: 20000,
    };

    const res = await request(app)
      .post('/api/autotrade/bots')
      .set('Authorization', `Bearer ${userToken}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.bot).toBeDefined();
    expect(res.body.bot.name).toBe('ETH Dip Scalper');
    expect(res.body.bot.id).toBeDefined();

    const botId = res.body.bot.id;

    const toggleRes = await request(app)
      .post(`/api/autotrade/bots/${botId}/toggle`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ enabled: false });

    expect(toggleRes.status).toBe(200);
    expect(toggleRes.body.bot.enabled).toBe(false);

    const delRes = await request(app)
      .delete(`/api/autotrade/bots/${botId}`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);
  });

  it('POST /api/autotrade/pause-all halts all active bots', async () => {
    const res = await request(app)
      .post('/api/autotrade/pause-all')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUCCESS');

    const botsRes = await request(app)
      .get('/api/autotrade/bots')
      .set('Authorization', `Bearer ${userToken}`);

    const anyActive = botsRes.body.bots.some((b: any) => b.enabled);
    expect(anyActive).toBe(false);
  });
});
