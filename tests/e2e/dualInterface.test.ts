import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import request from 'supertest';
import { createServerApp } from '../../src/server/app';
import { WalletService } from '../../src/services/wallet.service';
import { TradeService } from '../../src/services/trade.service';
import { createOneTimeToken } from '../../src/server/auth';

describe('End-to-End Dual-Interface (Telegram & Web) Verification', () => {
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  let server: http.Server;
  let serverPort: number;
  let broadcastSignal: (signal: unknown) => void;
  let authToken: string;

  beforeAll(async () => {
    const walletService = new WalletService(masterKey);
    const tradeService = new TradeService(walletService);

    const instance = createServerApp({
      walletService,
      tradeService,
      jwtSecret: 'test_dual_interface_jwt_secret',
    });

    server = instance.server;
    broadcastSignal = instance.broadcastSignal;

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          serverPort = addr.port;
        }
        resolve();
      });
    });

    const ott = createOneTimeToken('tg_dual_user_777');
    const authRes = await request(server)
      .post('/api/auth/token')
      .send({ token: ott });
    authToken = authRes.body.jwt;
  });

  afterAll(async () => {
    if (server && server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('broadcasts live Swarm signal to connected Web terminal and processes Stinger Quick-Buy', async () => {

    const ws = new WebSocket(`ws://localhost:${serverPort}/ws`);
    const receivedMessages: any[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    ws.on('message', (data) => {
      receivedMessages.push(JSON.parse(data.toString()));
    });

    const mockSignal = {
      id: 'sig_cluster_99',
      tokenAddress: '0xabf4f0999be267d8eaae658fb1f426f5a8568771',
      tokenSymbol: 'NECTAR',
      chain: 'BASE',
      mcap: 24500,
      liquidity: 9430,
      liqRatio: 38.5,
      rating: 'ROYAL_HONEY',
      earlySelling: false,
      pileInTime: '<1m pile-in',
      ageMinutes: 92,
      smartWalletsCount: 3,
    };

    broadcastSignal(mockSignal);

    await new Promise((r) => setTimeout(r, 100));

    const signalMsg = receivedMessages.find((m) => m.type === 'SWARM_SIGNAL_NEW');
    expect(signalMsg).toBeDefined();
    expect(signalMsg.data.tokenSymbol).toBe('NECTAR');
    expect(signalMsg.data.rating).toBe('ROYAL_HONEY');

    const buyRes = await request(server)
      .post('/api/trade/quick-buy')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        tokenAddress: mockSignal.tokenAddress,
        tokenSymbol: mockSignal.tokenSymbol,
        chain: mockSignal.chain,
        amountIn: 0.1,
        slippagePercent: 5,
        enableMoonbagAutoTp: true,
        isPaper: true,
      });

    expect(buyRes.status).toBe(200);
    expect(buyRes.body.status).toBe('SUCCESS');
    expect(buyRes.body.moonbagActive).toBe(true);

    await new Promise((r) => setTimeout(r, 100));
    const tradeMsg = receivedMessages.find((m) => m.type === 'TRADE_EXECUTED');
    expect(tradeMsg).toBeDefined();
    expect(tradeMsg.data.tokenSymbol).toBe('NECTAR');

    const posRes = await request(server)
      .get('/api/positions?mode=paper')
      .set('Authorization', `Bearer ${authToken}`);

    expect(posRes.status).toBe(200);
    expect(posRes.body.positions.length).toBe(1);
    expect(posRes.body.positions[0].tokenSymbol).toBe('NECTAR');

    ws.close();
  });
});
