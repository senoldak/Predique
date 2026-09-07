import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServerApp } from '../../src/server/app.js';
import { WalletService } from '../../src/services/wallet.service.js';
import { TradeService } from '../../src/services/trade.service.js';
import { BotManager } from '../../src/bot/botManager.js';
import { signJwt } from '../../src/server/auth.js';
import type { Server } from 'node:http';

describe('Channel Settings API Gateway', () => {
  let server: Server;
  let baseUrl: string;
  let token: string;
  const jwtSecret = 'test_channel_secret_jwt';
  let botManager: BotManager;

  beforeAll(async () => {
    const walletService = new WalletService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    const tradeService = new TradeService(walletService);
    botManager = new BotManager(walletService, tradeService);

    const appInstance = createServerApp({
      walletService,
      tradeService,
      botManager,
      jwtSecret,
    });

    await new Promise<void>((resolve) => {
      server = appInstance.server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });

    token = signJwt('trader_channel_test', jwtSecret);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /api/settings returns channel configuration', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.channelId).toBe('@predique');
    expect(data.channelAutoBroadcast).toBe(true);
    expect(data.minSignalTier).toBe('ALL');
    expect(data.minLiquidityUsd).toBe(10000);
    expect(data.maxTaxPercent).toBe(5);
    expect(data.tokenCooldownMinutes).toBe(15);
    expect(data.maxSignalsPerHour).toBe(12);
    expect(data.muteMicroTpAlerts).toBe(false);
  });

  it('POST /api/settings updates channel configuration and filter rules', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        channelId: '@predique',
        channelAutoBroadcast: false,
        minSignalTier: 'TIER_3',
        minLiquidityUsd: 25000,
        maxTaxPercent: 3,
        tokenCooldownMinutes: 30,
        maxSignalsPerHour: 6,
        muteMicroTpAlerts: true,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('SUCCESS');
    expect(data.channelConfig.channelId).toBe('@predique');
    expect(data.channelConfig.autoBroadcast).toBe(false);
    expect(data.channelConfig.minTier).toBe('TIER_3');
    expect(data.channelConfig.minLiquidityUsd).toBe(25000);
    expect(data.channelConfig.maxTaxPercent).toBe(3);
    expect(data.channelConfig.tokenCooldownMinutes).toBe(30);
    expect(data.channelConfig.maxSignalsPerHour).toBe(6);
    expect(data.channelConfig.muteMicroTpAlerts).toBe(true);
  });

  it('POST /api/settings/test-channel handles offline bot gracefully', async () => {
    const res = await fetch(`${baseUrl}/api/settings/test-channel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channelId: '@predique' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  });
});
