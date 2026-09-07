import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createServerApp } from '../../src/server/app.js';
import { isTelegramOperator } from '../../src/server/routes.js';
import { WalletService } from '../../src/services/wallet.service.js';
import { TradeService } from '../../src/services/trade.service.js';
import { AutoTradeService } from '../../src/services/autoTrade.service.js';
import { signJwt } from '../../src/server/auth.js';

describe('AutoTrade API Endpoints', () => {
  const ADMIN_TOKEN = 'test_admin_token_1234567890_long_enough';
  let app: any;
  let autoTradeService: AutoTradeService;
  let jwtToken: string;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
    const jwtSecret = 'test_secret_key_123';
    const walletService = new WalletService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    const tradeService = new TradeService(walletService);
    autoTradeService = new AutoTradeService(tradeService, walletService);

    const serverInstance = createServerApp({
      walletService,
      tradeService,
      autoTradeService,
      jwtSecret,
    });

    app = serverInstance.app;
    jwtToken = signJwt('test_user_id', jwtSecret);
  });

  it('GET /api/autotrade/config returns configuration and stats', async () => {
    const res = await request(app)
      .get('/api/autotrade/config')
      .set('Authorization', `Bearer ${jwtToken}`);

    expect(res.status).toBe(200);
    expect(res.body.config).toBeDefined();
    expect(res.body.config.enabled).toBe(false);
    expect(res.body.stats).toBeDefined();
  });

  it('POST /api/autotrade/toggle toggles enabled state', async () => {
    const res = await request(app)
      .post('/api/autotrade/toggle')
      .set('Authorization', `Bearer ${jwtToken}`)
      .set('x-admin-token', ADMIN_TOKEN)
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(autoTradeService.getConfig().enabled).toBe(true);
  });

  it('POST /api/autotrade/toggle in LIVE mode without admin is blocked', async () => {
    autoTradeService.updateConfig({ mode: 'LIVE' });
    const res = await request(app)
      .post('/api/autotrade/toggle')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ enabled: true });

    expect(res.status).toBe(403);
  });

  it('POST /api/autotrade/toggle in PAPER mode with user JWT succeeds', async () => {
    autoTradeService.updateConfig({ mode: 'PAPER' });
    const res = await request(app)
      .post('/api/autotrade/toggle')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });

  it('POST /api/autotrade/toggle with admin JWT claim needs no header', async () => {
    const adminJwt = signJwt('tg_999', 'test_secret_key_123', true);
    const res = await request(app)
      .post('/api/autotrade/toggle')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });

  it('POST /api/autotrade/config with admin JWT claim can configure LIVE mode', async () => {
    const adminJwt = signJwt('tg_999', 'test_secret_key_123', true);
    const res = await request(app)
      .post('/api/autotrade/config')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ mode: 'LIVE' });

    expect(res.status).toBe(200);
  });

  it('user JWT cannot switch to LIVE mode without admin', async () => {
    const res = await request(app)
      .post('/api/autotrade/config')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ mode: 'LIVE' });

    expect(res.status).toBe(403);
  });

  it('user JWT can update PAPER mode autotrade settings', async () => {
    const res = await request(app)
      .post('/api/autotrade/config')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({
        mode: 'PAPER',
        strategy: 'SWARM_MOMENTUM',
        maxTradeAmountNative: 2.5,
      });

    expect(res.status).toBe(200);
    expect(res.body.config.mode).toBe('PAPER');
    expect(res.body.config.maxTradeAmountNative).toBe(2.5);
  });

  it('POST /api/autotrade/config updates settings in LIVE mode with admin header', async () => {
    const res = await request(app)
      .post('/api/autotrade/config')
      .set('Authorization', `Bearer ${jwtToken}`)
      .set('x-admin-token', ADMIN_TOKEN)
      .send({
        mode: 'LIVE',
        strategy: 'ENSEMBLE',
        maxTradeAmountNative: 0.2,
      });

    expect(res.status).toBe(200);
    expect(res.body.config.mode).toBe('LIVE');
    expect(res.body.config.strategy).toBe('ENSEMBLE');
    expect(res.body.config.maxTradeAmountNative).toBe(0.2);
  });

  it('POST /api/autotrade/config rejects oversized trade amount > 10', async () => {
    const res = await request(app)
      .post('/api/autotrade/config')
      .set('Authorization', `Bearer ${jwtToken}`)
      .set('x-admin-token', ADMIN_TOKEN)
      .send({ maxTradeAmountNative: 15 });

    expect(res.status).toBe(400);
  });

  it('isTelegramOperator matches tg_ ids against TELEGRAM_ADMIN_IDS', async () => {
    const prev = process.env.TELEGRAM_ADMIN_IDS;
    process.env.TELEGRAM_ADMIN_IDS = '111,222';
    try {
      expect(isTelegramOperator('tg_111')).toBe(true);
      expect(isTelegramOperator('tg_999')).toBe(false);
      expect(isTelegramOperator(undefined)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.TELEGRAM_ADMIN_IDS;
      else process.env.TELEGRAM_ADMIN_IDS = prev;
    }
  });

  it('isTelegramOperator is fail-closed with empty allowlist', async () => {
    const prev = process.env.TELEGRAM_ADMIN_IDS;
    delete process.env.TELEGRAM_ADMIN_IDS;
    try {
      expect(isTelegramOperator('tg_111')).toBe(false);
    } finally {
      if (prev !== undefined) process.env.TELEGRAM_ADMIN_IDS = prev;
    }
  });

  it('GET /api/autotrade/positions and /api/autotrade/history return lists', async () => {
    const posRes = await request(app)
      .get('/api/autotrade/positions')
      .set('Authorization', `Bearer ${jwtToken}`);
    expect(posRes.status).toBe(200);
    expect(Array.isArray(posRes.body.positions)).toBe(true);

    const histRes = await request(app)
      .get('/api/autotrade/history')
      .set('Authorization', `Bearer ${jwtToken}`);
    expect(histRes.status).toBe(200);
    expect(Array.isArray(histRes.body.history)).toBe(true);
  });
});
