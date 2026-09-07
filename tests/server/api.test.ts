import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import { createServerApp } from '../../src/server/app';
import { WalletService } from '../../src/services/wallet.service';
import { TradeService } from '../../src/services/trade.service';
import { createOneTimeToken } from '../../src/server/auth';

describe('Dual-Interface API Gateway', () => {
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const jwtSecret = 'test_jwt_secret_cyberhive_terminal_key';
  let server: http.Server;
  let walletService: WalletService;
  let tradeService: TradeService;
  let authToken: string;

  beforeAll(async () => {
    walletService = new WalletService(masterKey);
    tradeService = new TradeService(walletService);
    const serverInstance = createServerApp({ walletService, tradeService, jwtSecret });
    server = serverInstance.server;

    const ott = createOneTimeToken('telegram_user_999');
    const authRes = await request(server)
      .post('/api/auth/token')
      .send({ token: ott });

    expect(authRes.status).toBe(200);
    expect(authRes.body.jwt).toBeDefined();
    authToken = authRes.body.jwt;
  });

  afterAll(async () => {
    if (server && server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('rejects unauthenticated requests to protected endpoints', async () => {
    const res = await request(server).get('/api/user/profile');
    expect(res.status).toBe(401);
  });

  it('returns user profile with authenticated token', async () => {
    const res = await request(server)
      .get('/api/user/profile')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('telegram_user_999');
  });

  it('lists user wallets with public addresses', async () => {
    const res = await request(server)
      .get('/api/wallet/list')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.wallets)).toBe(true);
    expect(res.body.wallets.length).toBeGreaterThanOrEqual(1);
    expect(res.body.wallets[0]).toHaveProperty('address');
    expect(res.body.wallets[0]).toHaveProperty('chain');
  });

  it('executes quick-buy via REST endpoint', async () => {
    const res = await request(server)
      .post('/api/trade/quick-buy')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        tokenAddress: '0xabf4f0999be267d8eaae658fb1f426f5a8568771',
        tokenSymbol: 'NECTAR',
        chain: 'BASE',
        amountIn: 0.05,
        slippagePercent: 5,
        enableMoonbagAutoTp: true,
        isPaper: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUCCESS');
    expect(res.body.txHash).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('returns active positions', async () => {
    const res = await request(server)
      .get('/api/positions?mode=paper')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.positions)).toBe(true);
    expect(res.body.positions.length).toBeGreaterThanOrEqual(1);
    expect(res.body.positions[0].tokenSymbol).toBe('NECTAR');
  });

  it('handles paper mode in wallet list and allows resetting paper balance', async () => {
    const res = await request(server)
      .get('/api/wallet/list?mode=paper')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.wallets[0]).toHaveProperty('balance');

    const resetRes = await request(server)
      .post('/api/wallet/reset-paper')
      .set('Authorization', `Bearer ${authToken}`);
    expect(resetRes.status).toBe(200);
    expect(resetRes.body.status).toBe('SUCCESS');
    expect(Array.isArray(resetRes.body.wallets)).toBe(true);
  });

  it('handles POST /api/feed/ingest-swap for real-time on-chain swap events', async () => {
    const invalidRes = await request(server)
      .post('/api/feed/ingest-swap')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ invalid: 'payload' });
    expect(invalidRes.status).toBe(400);

    const validRes = await request(server)
      .post('/api/feed/ingest-swap')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        walletAddress: '0x1111111111111111111111111111111111111111',
        chain: 'BASE',
        tokenAddress: '0x2222222222222222222222222222222222222222',
        tokenSymbol: 'SWARM_ALPHA',
        amountUsd: 1000,
        txHash: '0xabc1234567890123456789012345678901234567890123456789012345678901',
      });
    expect(validRes.status).toBe(200);
    expect(validRes.body.status).toBe('SUCCESS');
    expect(validRes.body).toHaveProperty('signalTriggered');
  });

  it('sweeps balance to vault and retrieves vault balances via REST endpoints', async () => {
    // 1. Check initial vault balances
    const vaultRes = await request(server)
      .get('/api/wallet/vault')
      .set('Authorization', `Bearer ${authToken}`);
    expect(vaultRes.status).toBe(200);
    expect(vaultRes.body.vaultBalances).toBeDefined();

    // 2. Perform paper sweep
    const sweepRes = await request(server)
      .post('/api/wallet/sweep')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        chain: 'EVM',
        vaultAddress: '0x3333333333333333333333333333333333333333',
        reserveAmount: 0.5,
        mode: 'paper',
      });
    expect(sweepRes.status).toBe(200);
    expect(sweepRes.body.result).toBeDefined();
    expect(sweepRes.body.result.status).toBe('SUCCESS');
    expect(sweepRes.body.result.sweptAmount).toBe(1.0);

    // 3. Verify vault balance increased
    const updatedVaultRes = await request(server)
      .get('/api/wallet/vault')
      .set('Authorization', `Bearer ${authToken}`);
    expect(updatedVaultRes.status).toBe(200);
    expect(updatedVaultRes.body.vaultBalances.evm).toBe(1.0);
  });
});
