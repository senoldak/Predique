import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServerApp } from '../../src/server/app.js';
import { WalletService } from '../../src/services/wallet.service.js';
import { TradeService } from '../../src/services/trade.service.js';
import { BotManager } from '../../src/bot/botManager.js';
import { signJwt } from '../../src/server/auth.js';
import type { Server } from 'node:http';

describe('Settings API Gateway', () => {
  let server: Server;
  let baseUrl: string;
  let token: string;
  const jwtSecret = 'test_settings_secret_jwt';

  beforeAll(async () => {
    const walletService = new WalletService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    const tradeService = new TradeService(walletService);
    const botManager = new BotManager(walletService, tradeService);

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

    token = signJwt('trader_settings_test', jwtSecret);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /api/settings returns masked bot token and default preferences', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.botTokenMasked).toBeDefined();
    expect(data.defaultSlippage).toBe(5);
    expect(data.defaultAmount).toBe(0.1);
    expect(data.botStatus).toBe('OFFLINE');
  });

  it('POST /api/settings updates user trade preferences', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        defaultSlippage: 10,
        defaultAmount: 0.5,
        moonbagDefault: false,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('SUCCESS');
    expect(data.settings.defaultSlippage).toBe(10);
    expect(data.settings.defaultAmount).toBe(0.5);
    expect(data.settings.moonbagDefault).toBe(false);
  });
});
