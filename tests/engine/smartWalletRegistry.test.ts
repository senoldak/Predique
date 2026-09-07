import { describe, it, expect, beforeEach } from 'vitest';
import { SmartWalletRegistry, type SmartWallet } from '../../src/engine/smartWalletRegistry.js';

describe('SmartWalletRegistry', () => {
  let registry: SmartWalletRegistry;

  beforeEach(() => {
    registry = new SmartWalletRegistry();
  });

  it('seeds default smart wallets and identifies them', () => {
    const wallets = registry.getAllWallets();
    expect(wallets.length).toBeGreaterThanOrEqual(4);

    const first = wallets[0];
    expect(registry.isSmartWallet(first.address)).toBe(true);
  });

  it('registers and retrieves custom smart wallets with address normalization', () => {
    const customWallet: SmartWallet = {
      address: '0xDeAdbEef00000000000000000000000000000001',
      chain: 'EVM',
      label: 'Alpha Whale 1',
      tag: 'ALPHA_SNIPER',
      winRate30d: 84.5,
      totalPnlUsd: 152000,
    };

    registry.registerWallet(customWallet);

    // Look up with lowercase address
    expect(registry.isSmartWallet('0xdeadbeef00000000000000000000000000000001')).toBe(true);
    const retrieved = registry.getWallet('0xdeadbeef00000000000000000000000000000001');
    expect(retrieved?.label).toBe('Alpha Whale 1');
    expect(retrieved?.winRate30d).toBe(84.5);
  });

  it('filters wallets by chain and tag', () => {
    const solWallets = registry.getWalletsByChain('SOLANA');
    expect(solWallets.every((w) => w.chain === 'SOLANA')).toBe(true);

    const evmWallets = registry.getWalletsByChain('EVM');
    expect(evmWallets.every((w) => w.chain === 'EVM')).toBe(true);
  });

  it('exposes smart wallets via GET /api/smart-wallets with auth', async () => {
    const { createServerApp } = await import('../../src/server/app.js');
    const { WalletService } = await import('../../src/services/wallet.service.js');
    const { TradeService } = await import('../../src/services/trade.service.js');
    const { LiveMarketFeedService } = await import('../../src/services/marketFeed.service.js');
    const { SwarmDetector } = await import('../../src/engine/swarmDetector.js');
    const RedisMock = (await import('ioredis-mock')).default;
    const request = (await import('supertest')).default;
    const { signJwt } = await import('../../src/server/auth.js');

    const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const jwtSecret = 'test_jwt_secret_cyberhive_terminal_key_long_enough';
    const redis = new (RedisMock as any)();
    const ws = new WalletService(masterKey, redis);
    const ts = new TradeService(ws, redis);
    const detector = new SwarmDetector(redis, registry);
    const feed = new LiveMarketFeedService(15000, detector);

    const appInstance = createServerApp({
      walletService: ws,
      tradeService: ts,
      marketFeedService: feed,
      jwtSecret,
    });

    const jwt = signJwt('u_test_smart', jwtSecret);

    const res = await request(appInstance.app)
      .get('/api/smart-wallets')
      .set('Authorization', `Bearer ${jwt}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(4);
    expect(res.body.wallets[0].winRate30d).toBeGreaterThan(50);

    feed.stop();
    appInstance.wsManager.close();
  }, 10000);
});
