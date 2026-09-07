import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServerApp } from '../../src/server/app.js';
import { WalletService } from '../../src/services/wallet.service.js';
import { TradeService } from '../../src/services/trade.service.js';
import { signJwt } from '../../src/server/auth.js';
import type { Server } from 'node:http';

describe('Paper Trading Simulation Lifecycle', () => {
  let server: Server;
  let baseUrl: string;
  const jwtSecret = 'paper_test_jwt_secret_xyz';
  let token: string;
  const userId = 'trader_paper_suite';

  beforeAll(async () => {
    const walletService = new WalletService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    const tradeService = new TradeService(walletService);
    const appInstance = createServerApp({ walletService, tradeService, jwtSecret });

    await new Promise<void>((resolve) => {
      server = appInstance.server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });

    token = signJwt(userId, jwtSecret);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('provisions 10.0 SOL and 1.5 ETH initial paper balances', async () => {
    const res = await fetch(`${baseUrl}/api/wallet/list?mode=paper`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.wallets).toHaveLength(2);

    const sol = data.wallets.find((w: { chain: string }) => w.chain === 'SOLANA');
    const evm = data.wallets.find((w: { chain: string }) => w.chain === 'EVM');
    expect(sol.balance).toBe(10.0);
    expect(evm.balance).toBe(1.5);
  });

  it('deducts paper balance and records paper position on quick buy', async () => {
    const buyRes = await fetch(`${baseUrl}/api/trade/quick-buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
        tokenSymbol: 'BONK',
        chain: 'solana',
        amountIn: 2.0,
        slippagePercent: 5,
        enableMoonbagAutoTp: true,
        isPaper: true,
        entryPriceUsd: 0.000025,
      }),
    });
    expect(buyRes.status).toBe(200);
    const buyData = await buyRes.json();
    expect(buyData.status).toBe('SUCCESS');
    expect(buyData.positionId).toBeDefined();

    const wRes = await fetch(`${baseUrl}/api/wallet/list?mode=paper`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const wData = await wRes.json();
    const sol = wData.wallets.find((w: { chain: string }) => w.chain === 'SOLANA');
    expect(sol.balance).toBe(8.0);

    const posRes = await fetch(`${baseUrl}/api/positions?mode=paper`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const posData = await posRes.json();
    expect(posData.positions).toHaveLength(1);
    expect(posData.positions[0].tokenSymbol).toBe('BONK');
    expect(posData.positions[0].isPaper).toBe(true);
  });

  it('credits virtual balance on position exit with calculated PnL', async () => {

    const posRes = await fetch(`${baseUrl}/api/positions?mode=paper`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { positions } = await posRes.json();
    const targetPos = positions[0];

    const sellRes = await fetch(`${baseUrl}/api/trade/sell`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        positionId: targetPos.id,
        percentage: 100,
        isPaper: true,
        currentPriceUsd: 0.000030,
      }),
    });
    expect(sellRes.status).toBe(200);
    const sellData = await sellRes.json();
    expect(sellData.status).toBe('SUCCESS');
    expect(sellData.returnedAmount).toBe(2.4);

    const wRes = await fetch(`${baseUrl}/api/wallet/list?mode=paper`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const wData = await wRes.json();
    const sol = wData.wallets.find((w: { chain: string }) => w.chain === 'SOLANA');
    expect(sol.balance).toBe(10.4);
  });

  it('resets paper balance back to defaults on demand', async () => {
    const resetRes = await fetch(`${baseUrl}/api/wallet/reset-paper`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resetRes.status).toBe(200);
    const resetData = await resetRes.json();
    expect(resetData.status).toBe('SUCCESS');

    const sol = resetData.wallets.find((w: { chain: string }) => w.chain === 'SOLANA');
    const evm = resetData.wallets.find((w: { chain: string }) => w.chain === 'EVM');
    expect(sol.balance).toBe(10.0);
    expect(evm.balance).toBe(1.5);
  });
});
